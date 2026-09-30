// Prepare character assets for the pet plugin.
//
// The image model renders "transparent" backgrounds as a painted checkerboard,
// so this tool removes that pattern instead of trusting an alpha channel:
//   1. decode the source PNG (8-bit RGB/RGBA, non-interlaced);
//   2. flood-fill background-like pixels inward from every border pixel
//      (this also consumes the painted white sticker ring, which is redrawn);
//   3. drop enclosed regions that match the checkerboard pattern, so letter
//      interiors are cleaned while genuinely white artwork (laptop screen,
//      whiteboard, cracked card, apron) survives;
//   4. redraw a uniform white sticker ring by dilating the remaining silhouette;
//   5. crop to the artwork, downscale with premultiplied alpha, encode RGBA.
//
// Usage:
//   node tools/prepare-assets.mjs --src <dir> [--out <dir>] [--long 420] [--check]
//   node tools/prepare-assets.mjs --src <dir> --icon <state> --out <dir>

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const STATES = ['resting', 'working', 'waiting', 'celebrate', 'sleeping', 'error'];

/** Minimal PNG reader for 8-bit RGB/RGBA non-interlaced files. */
function readPng(file) {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error(`Not a PNG: ${file}`);
  let offset = 8, header = null;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8],
        color: data[9], interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header) throw new Error('Missing IHDR');
  if (header.depth !== 8 || header.interlace !== 0 || (header.color !== 2 && header.color !== 6)) {
    throw new Error(`Unsupported PNG (${JSON.stringify(header)})`);
  }
  const channels = header.color === 6 ? 4 : 3;
  const stride = header.width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * header.height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const current = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? current[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      const x = line[i];
      let value;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`Unsupported filter ${filter}`);
      }
      current[i] = value & 0xff;
    }
    previous = current;
  }
  return { width: header.width, height: header.height, channels, data: out };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([body, data])), 0);
  return Buffer.concat([length, body, data, crc]);
}

/** Per-row adaptive filtering keeps the encoded assets small. */
function writePng(file, width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const previous = Buffer.alloc(stride);
  const candidates = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const line = rgba.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const x = line[i];
      const a = i >= 4 ? line[i - 4] : 0;
      const b = previous[i];
      const c = i >= 4 ? previous[i - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      candidates[0][i] = x;
      candidates[1][i] = (x - a) & 0xff;
      candidates[2][i] = (x - b) & 0xff;
      candidates[3][i] = (x - ((a + b) >> 1)) & 0xff;
      candidates[4][i] = (x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      const candidate = candidates[f];
      for (let i = 0; i < stride; i++) score += candidate[i] < 128 ? candidate[i] : 256 - candidate[i];
      if (score < bestScore) { bestScore = score; best = f; }
    }
    raw[y * (stride + 1)] = best;
    candidates[best].copy(raw, y * (stride + 1) + 1);
    line.copy(previous);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  fs.writeFileSync(file, Buffer.concat([
    PNG_SIG, chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const isNeutral = (r, g, b, tolerance = 12) =>
  Math.max(r, g, b) - Math.min(r, g, b) <= tolerance;

/** Pixels the model painted as background: near-neutral and bright. */
const isBackgroundLike = (r, g, b) => isNeutral(r, g, b) && Math.min(r, g, b) >= 190;

/**
 * The model paints the checkerboard with one light and one slightly darker
 * near-neutral tone. Real white artwork (laptop screen, whiteboard, card,
 * apron) carries a single tone, so a component mixing both tones is background.
 */
function isCheckerboardTone(r, g, b) {
  if (!isNeutral(r, g, b, 10)) return false;
  const min = Math.min(r, g, b);
  return min >= 195 && min <= 246;
}

function isBrightTone(r, g, b) {
  return isNeutral(r, g, b, 10) && Math.min(r, g, b) > 246;
}

/** Flood-fill background-like pixels inward from every border pixel. */
function floodBackground(image) {
  const { width, height, channels, data } = image;
  const background = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  const push = (x, y) => {
    const index = y * width + x;
    if (background[index]) return;
    const i = index * channels;
    if (!isBackgroundLike(data[i], data[i + 1], data[i + 2])) return;
    background[index] = 1;
    stack[top++] = index;
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (top > 0) {
    const index = stack[--top];
    const x = index % width, y = (index - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  return background;
}

/** Remove enclosed regions that carry the painted checkerboard (letter interiors). */
function clearEnclosedCheckerboard(image, background) {
  const { width, height, channels, data } = image;
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let removed = 0, components = 0;
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || background[start]) continue;
    const si = start * channels;
    if (!isBackgroundLike(data[si], data[si + 1], data[si + 2])) { seen[start] = 1; continue; }
    let top = 0;
    stack[top++] = start; seen[start] = 1;
    const members = [];
    let gray = 0, bright = 0;
    while (top > 0) {
      const index = stack[--top];
      const x = index % width, y = (index - x) / width;
      const i = index * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      members.push(index);
      if (isCheckerboardTone(r, g, b)) gray++;
      else if (isBrightTone(r, g, b)) bright++;
      const visit = (nx, ny) => {
        const n = ny * width + nx;
        if (seen[n] || background[n]) return;
        const ni = n * channels;
        if (!isBackgroundLike(data[ni], data[ni + 1], data[ni + 2])) return;
        seen[n] = 1; stack[top++] = n;
      };
      if (x > 0) visit(x - 1, y);
      if (x < width - 1) visit(x + 1, y);
      if (y > 0) visit(x, y - 1);
      if (y < height - 1) visit(x, y + 1);
    }
    const size = members.length;
    if (size >= 24 && gray / size >= 0.15 && bright / size >= 0.15) {
      for (const index of members) background[index] = 1;
      removed += size; components++;
    }
  }
  return { removed, components };
}

/** Separable window maximum: pixels within `radius` of the silhouette. */
function dilate(mask, width, height, radius) {
  const horizontal = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let hit = 0;
      const from = Math.max(0, x - radius), to = Math.min(width - 1, x + radius);
      for (let k = from; k <= to; k++) if (mask[row + k]) { hit = 1; break; }
      horizontal[row + x] = hit;
    }
  }
  const grown = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let hit = 0;
      const from = Math.max(0, y - radius), to = Math.min(height - 1, y + radius);
      for (let k = from; k <= to; k++) if (horizontal[k * width + x]) { hit = 1; break; }
      grown[y * width + x] = hit;
    }
  }
  return grown;
}

/** Lanczos-3 resampling in premultiplied alpha: keeps line art crisp and edges clean. */
function lanczos(x, support = 3) {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= support) return 0;
  const px = Math.PI * x;
  return (support * Math.sin(px) * Math.sin(px / support)) / (px * px);
}

function resizeRgba(rgba, width, height, targetWidth, targetHeight) {
  const source = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const alpha = rgba[i * 4 + 3] / 255;
    source[i * 4] = rgba[i * 4] * alpha;
    source[i * 4 + 1] = rgba[i * 4 + 1] * alpha;
    source[i * 4 + 2] = rgba[i * 4 + 2] * alpha;
    source[i * 4 + 3] = rgba[i * 4 + 3];
  }
  const scaleX = targetWidth / width, scaleY = targetHeight / height;
  const supportX = Math.max(1, 1 / scaleX) * 3, supportY = Math.max(1, 1 / scaleY) * 3;
  const horizontal = new Float32Array(targetWidth * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const centre = (x + 0.5) / scaleX - 0.5;
      const from = Math.max(0, Math.ceil(centre - supportX));
      const to = Math.min(width - 1, Math.floor(centre + supportX));
      let r = 0, g = 0, b = 0, a = 0, weight = 0;
      for (let k = from; k <= to; k++) {
        const w = lanczos((k - centre) * Math.min(1, scaleX));
        if (w === 0) continue;
        const i = (y * width + k) * 4;
        r += source[i] * w; g += source[i + 1] * w; b += source[i + 2] * w; a += source[i + 3] * w;
        weight += w;
      }
      const o = (y * targetWidth + x) * 4;
      horizontal[o] = r / weight; horizontal[o + 1] = g / weight;
      horizontal[o + 2] = b / weight; horizontal[o + 3] = a / weight;
    }
  }
  const out = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y++) {
    const centre = (y + 0.5) / scaleY - 0.5;
    const from = Math.max(0, Math.ceil(centre - supportY));
    const to = Math.min(height - 1, Math.floor(centre + supportY));
    for (let x = 0; x < targetWidth; x++) {
      let r = 0, g = 0, b = 0, a = 0, weight = 0;
      for (let k = from; k <= to; k++) {
        const w = lanczos((k - centre) * Math.min(1, scaleY));
        if (w === 0) continue;
        const i = (k * targetWidth + x) * 4;
        r += horizontal[i] * w; g += horizontal[i + 1] * w; b += horizontal[i + 2] * w; a += horizontal[i + 3] * w;
        weight += w;
      }
      const alpha = a / weight;
      const scale = alpha > 0.02 ? 255 / alpha : 0;
      const o = (y * targetWidth + x) * 4;
      out[o] = Math.max(0, Math.min(255, Math.round(r * scale / weight)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(g * scale / weight)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(b * scale / weight)));
      out[o + 3] = Math.max(0, Math.min(255, Math.round(alpha)));
    }
  }
  return out;
}

/** Unsharp mask: raster line art loses edge contrast when it is scaled down. */
function sharpenRgba(rgba, width, height, amount) {
  if (!amount) return rgba;
  const source = Buffer.from(rgba);
  const sample = (x, y, c) => source[(y * width + x) * 4 + c];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (source[i + 3] < 8) continue;
      for (let c = 0; c < 3; c++) {
        const centre = sample(x, y, c);
        const left = x > 0 ? sample(x - 1, y, c) : centre;
        const right = x < width - 1 ? sample(x + 1, y, c) : centre;
        const up = y > 0 ? sample(x, y - 1, c) : centre;
        const down = y < height - 1 ? sample(x, y + 1, c) : centre;
        const blur = (left + right + up + down + centre * 4) / 8;
        rgba[i + c] = Math.max(0, Math.min(255, Math.round(centre + amount * (centre - blur))));
      }
    }
  }
  return rgba;
}

function processState(source, destination, options) {
  const image = readPng(source);
  const { width, height, channels, data } = image;
  const background = floodBackground(image);
  const enclosed = clearEnclosedCheckerboard(image, background);

  const mask = new Uint8Array(width * height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let i = 0; i < width * height; i++) {
    if (background[i]) continue;
    mask[i] = 1;
    const x = i % width, y = (i - x) / width;
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  if (maxX < 0) throw new Error(`Background removal consumed everything: ${source}`);

  const radius = Math.max(4, Math.round(options.outlineRatio * Math.min(width, height)));
  const ring = dilate(mask, width, height, radius);
  const pad = radius + 2;
  const left = Math.max(0, minX - pad), top = Math.max(0, minY - pad);
  const right = Math.min(width - 1, maxX + pad), bottom = Math.min(height - 1, maxY + pad);
  const cropWidth = right - left + 1, cropHeight = bottom - top + 1;
  const full = Buffer.alloc(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const sx = left + x, sy = top + y;
      const sourceIndex = (sy * width + sx) * channels;
      const maskIndex = sy * width + sx;
      const target = (y * cropWidth + x) * 4;
      if (mask[maskIndex]) {
        full[target] = data[sourceIndex];
        full[target + 1] = data[sourceIndex + 1];
        full[target + 2] = data[sourceIndex + 2];
        full[target + 3] = 255;
      } else if (ring[maskIndex]) {
        full[target] = 255; full[target + 1] = 255; full[target + 2] = 255; full[target + 3] = 255;
      }
    }
  }

  const long = Math.max(cropWidth, cropHeight);
  const targetLong = Math.min(options.long, long);
  const targetWidth = Math.max(1, Math.round(cropWidth * targetLong / long));
  const targetHeight = Math.max(1, Math.round(cropHeight * targetLong / long));
  const scaled = targetLong === long ? full : resizeRgba(full, cropWidth, cropHeight, targetWidth, targetHeight);
  sharpenRgba(scaled, targetWidth, targetHeight, Number(option('sharpen', 0.7)));
  writePng(destination, targetWidth, targetHeight, scaled);

  const backgroundShare = background.reduce((sum, value) => sum + value, 0) / (width * height);
  return {
    source: path.basename(source), target: path.basename(destination),
    sourceSize: `${width}x${height}`,
    outputSize: `${targetWidth}x${targetHeight}`,
    ratio: (targetWidth / targetHeight).toFixed(3),
    background: `${(backgroundShare * 100).toFixed(1)}%`,
    enclosedRemoved: enclosed.removed,
    enclosedRegions: enclosed.components,
    outline: radius,
    bytes: fs.statSync(destination).size,
  };
}

function cropIcon(source, destination, side = 256) {
  const image = readPng(source);
  const { width, height, channels, data } = image;
  const size = Math.round(Math.min(width * 0.86, height * 0.62));
  const left = Math.round((width - size) / 2);
  const top = Math.round(height * 0.03);
  const cropWidth = size, cropHeight = size;
  const full = Buffer.alloc(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const sx = Math.min(width - 1, left + x), sy = Math.min(height - 1, top + y);
      const si = (sy * width + sx) * channels;
      const ti = (y * cropWidth + x) * 4;
      full[ti] = data[si]; full[ti + 1] = data[si + 1]; full[ti + 2] = data[si + 2];
      full[ti + 3] = channels === 4 ? data[si + 3] : 255;
    }
  }
  const inner = 232;
  const scaledInner = resizeRgba(full, cropWidth, cropHeight, inner, inner);
  const padded = Buffer.alloc(side * side * 4);
  const offset = Math.round((side - inner) / 2);
  for (let y = 0; y < inner; y++) {
    scaledInner.copy(padded, ((y + offset) * side + offset) * 4, y * inner * 4, (y + 1) * inner * 4);
  }
  writePng(destination, side, side, padded);
  return { target: path.basename(destination), outputSize: `${side}x${side}`, bytes: fs.statSync(destination).size };
}

/** Locate the largest flat bright region: the laptop screen the count is drawn on. */
function measureBrightRegions(file) {
  const image = readPng(file);
  const { width, height, channels, data } = image;
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const regions = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start]) continue;
    const si = start * channels;
    if (data[si + 3] < 250 || !isBrightTone(data[si], data[si + 1], data[si + 2])) { seen[start] = 1; continue; }
    let top = 0; stack[top++] = start; seen[start] = 1;
    let minX = width, minY = height, maxX = -1, maxY = -1, count = 0;
    while (top > 0) {
      const index = stack[--top];
      const x = index % width, y = (index - x) / width;
      count++;
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      const visit = (nx, ny) => {
        const n = ny * width + nx;
        if (seen[n]) return;
        const ni = n * channels;
        if (data[ni + 3] < 250 || !isBrightTone(data[ni], data[ni + 1], data[ni + 2])) return;
        seen[n] = 1; stack[top++] = n;
      };
      if (x > 0) visit(x - 1, y);
      if (x < width - 1) visit(x + 1, y);
      if (y > 0) visit(x, y - 1);
      if (y < height - 1) visit(x, y + 1);
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    regions.push({ minX, minY, maxX, maxY, w, h, count, fill: Number((count / (w * h)).toFixed(3)) });
  }
  return { width, height, regions: regions.sort((a, b) => b.count - a.count).slice(0, 6) };
}

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const source = option('src', 'D:\\大白鲸小剧场\\chan');
const outDir = option('out', path.join(root, 'assets'));
const options = { long: Number(option('long', 420)), outlineRatio: Number(option('outlineRatio', 0.011)) };
fs.mkdirSync(outDir, { recursive: true });

const iconState = option('icon', null);
const measureState = option('measure', null);
if (measureState) {
  const target = path.join(outDir, `${measureState}.png`);
  const measured = measureBrightRegions(target);
  console.log(`${measureState}: ${measured.width}x${measured.height}`);
  for (const region of measured.regions) {
    const centreX = (region.minX + region.maxX) / 2, centreY = (region.minY + region.maxY) / 2;
    console.log(`  bbox ${region.minX},${region.minY}-${region.maxX},${region.maxY} ${region.w}x${region.h} fill=${region.fill} px=${region.count} centre=${centreX.toFixed(1)},${centreY.toFixed(1)} fraction=${(centreX / measured.width).toFixed(3)},${(centreY / measured.height).toFixed(3)}`);
  }
} else if (iconState) {
  const sourceFile = path.join(outDir, `${iconState}.png`);
  const result = cropIcon(sourceFile, path.join(outDir, 'icon.png'));
  console.log(JSON.stringify(result));
} else if (args.includes('--check')) {
  for (const state of STATES) {
    const file = path.join(source, `${state}.png`);
    if (!fs.existsSync(file)) { console.log(`${state}: MISSING`); continue; }
    const image = readPng(file);
    const background = floodBackground(image);
    const enclosed = clearEnclosedCheckerboard(image, background);
    const share = background.reduce((sum, value) => sum + value, 0) / (image.width * image.height);
    console.log(`${state}: ${image.width}x${image.height} background=${(share * 100).toFixed(1)}% enclosedRemoved=${enclosed.removed}px in ${enclosed.components} regions`);
  }
} else {
  const summary = [];
  for (const state of STATES) {
    const file = path.join(source, `${state}.png`);
    if (!fs.existsSync(file)) { console.log(`skip ${state}: missing`); continue; }
    summary.push(processState(file, path.join(outDir, `${state}.png`), options));
  }
  for (const row of summary) console.log(JSON.stringify(row));
  console.log(`total ${(summary.reduce((sum, row) => sum + row.bytes, 0) / 1024).toFixed(0)} KiB`);
}
