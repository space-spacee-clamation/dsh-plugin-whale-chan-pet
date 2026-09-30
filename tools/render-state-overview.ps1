# Render docs/images/whale-chan-states.png from the shipped state assets.
# Windows-only helper: uses System.Drawing for image scaling and label text.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$states = @(
  @{ Label = 'Working';     File = 'working' },
  @{ Label = 'Waiting';     File = 'waiting' },
  @{ Label = 'Celebrating'; File = 'celebrate' },
  @{ Label = 'Error';       File = 'error' },
  @{ Label = 'Resting';     File = 'resting' },
  @{ Label = 'Sleeping';    File = 'sleeping' }
)

$cellWidth = 560; $cellHeight = 560; $columns = 3; $padding = 32; $labelHeight = 76
$width = $columns * $cellWidth
$height = 2 * ($cellHeight + $labelHeight)

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = 'AntiAlias'
$graphics.InterpolationMode = 'HighQualityBicubic'
$graphics.TextRenderingHint = 'AntiAliasGridFit'
$graphics.Clear([System.Drawing.Color]::FromArgb(245, 247, 251))

$font = New-Object System.Drawing.Font('Segoe UI', 30, [System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(43, 58, 143))
$format = New-Object System.Drawing.StringFormat
$format.Alignment = 'Center'

for ($index = 0; $index -lt $states.Count; $index++) {
  $column = $index % $columns
  $row = [math]::Floor($index / $columns)
  $originX = $column * $cellWidth
  $originY = $row * ($cellHeight + $labelHeight)
  $image = [System.Drawing.Image]::FromFile((Join-Path $root "assets/$($states[$index].File).png"))
  $scale = [math]::Min(($cellWidth - 2 * $padding) / $image.Width, ($cellHeight - 2 * $padding) / $image.Height)
  $drawWidth = [int]($image.Width * $scale)
  $drawHeight = [int]($image.Height * $scale)
  $graphics.DrawImage($image,
    $originX + [int](($cellWidth - $drawWidth) / 2),
    $originY + $padding + [int](($cellHeight - 2 * $padding - $drawHeight) / 2),
    $drawWidth, $drawHeight)
  $image.Dispose()
  $rect = New-Object System.Drawing.RectangleF($originX, ($originY + $cellHeight), $cellWidth, $labelHeight)
  $graphics.DrawString($states[$index].Label, $font, $brush, $rect, $format)
}

$graphics.Dispose()
$output = Join-Path $root 'docs/images/whale-chan-states.png'
New-Item -ItemType Directory -Force -Path (Split-Path $output) | Out-Null
$bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
"wrote $output"
