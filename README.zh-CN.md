# Whale-Chan Companion（小鲸鱼娘）

**陪你工作、为你欢呼，也陪你好好打个盹的小鲸鱼娘。**

![六种状态：working、waiting、celebrating、error、resting、sleeping](docs/images/whale-chan-states.png)

*状态总览。角色素材由 AI 生成，详见[素材声明](#素材由-ai-生成)。*

一只住在 DSH（DeepSeek Harness）窗口里的小鲸鱼娘。陪你工作、等你决定，也陪你好好打个盹。

A little companion that lives inside your DeepSeek Harness (DSH) window—there while you work, wait, and rest.

**English documentation: [README.md](README.md).**

本仓库是 [dsh-plugin-whale-pet](https://github.com/Yifffan/dsh-plugin-whale-pet) 的 fork：**角色素材全部换成 AI 生成的插画（角色设定来自互联网公开开源、MIT 协议），并改用一套独立的插件标识**，因此它可以与上游插件同时安装、并存运行，而不是覆盖它。陪玩逻辑（状态机、Host 回合边界桥、思考气泡、设置面板）沿用上游代码，未做改动。

## 本 fork 改了什么

| | 上游 | 本 fork |
|---|---|---|
| 包名 | `dsh-plugin-whale-pet` | `dsh-plugin-whale-chan-pet` |
| Entry ID | `whale-pet` | `whale-chan-pet` |
| Host 服务 + 远程命名空间 | `whalePet` | `whaleChan` |
| `shell.overlay` 占位 id | `whale-pet` | `whale-chan-pet` |
| 偏好存储键 | `dsh-plugin-whale-pet:v1` | `dsh-plugin-whale-chan-pet:v1` |

1. **角色素材全部替换。** 六张状态图、插件管理器图标、文档总览图，都是依据维护者自有的角色设定稿、用 AI 图像模型新生成的插画；本仓库不再分发上游的鲸鱼贴纸。上游是扁平矢量贴纸，本 fork 是位图插画，同尺寸下观感不同，原因见[已知限制](#已知限制与待办)。
2. **标识完全独立。** 包名、entry ID、Host 服务名、Typert 命名空间、overlay id、偏好存储键全部与上游区分开，两个插件可以同时安装，不会抢服务名、抢 overlay 格子或串偏好。
3. **为位图素材调整渲染。** 默认尺寸改为 **125%**（竖构图的位图插画需要更多像素，才能和上游扁平矢量达到相同的视觉体量）；`working` 状态不再把画框锁定在计数层原本的 116×89 坐标系，插画因此宽了约 **12%**；"正在工作的会话数"数字按**实测**的笔电屏幕位置重新锚定；所有状态动效改为**整像素平移**——对图层做旋转或缩放会让浏览器重采样缓存栅格、把插画弄糊。默认位置与上游一致（同一个右下角）。
4. **素材管线。** `tools/build.mjs` 改为校验并内联 8-bit RGBA PNG（`data:image/png;base64`），不再校验 SVG；`tools/prepare-assets.mjs` 负责从生图原始输出还原出仓库内的素材；`tools/render-state-overview.ps1` 生成上面那张总览图。
5. **许可与文档。** `ASSETS-LICENSE.md` 改写为 AI 素材声明；素材段落、本地化元数据、测试都跟随新的标识与素材格式更新。`node --test tests/*.test.mjs` **187/187 通过**。

## 素材由 AI 生成

本仓库的角色素材——`assets/` 下的六张状态图、插件图标 `assets/icon.png`、以及 `docs/images/whale-chan-states.png`——均基于**互联网公开开源（MIT 协议）的角色设定**、使用 **AI 图像生成工具**创作；角色设定本身按其原许可（MIT）执行，而生成的插画**不适用**本项目的 MIT 代码许可。

从上游继承的一切仍按上游条款执行，完整声明见 [ASSETS-LICENSE.md](ASSETS-LICENSE.md)；气泡字体沿用上游，见 [FONT-LICENSES.md](FONT-LICENSES.md)。

## 功能

- 在 DSH 窗口内拖动、缩放、收起、唤回。
- 感知范围可选**全部会话**或**当前会话**；普通主会话会显示"正在工作的会话数"。
- 六种状态：resting（待机）、working（工作中）、waiting（等你确认）、celebrating（完成庆祝）、sleeping（打盹）、error（出错）。
- 插件管理器里显示自定义图标。
- 中英文文案、浅色/深色设置菜单、支持"减少动态效果"。
- 区分"正常完成"与"取消/失败"：仅凭工作数下降或绿色未读标记并不算成功完成。

这是窗口内插件，不是独立的系统级桌面浮层。

## 安装

### 1. 从 GitHub 安装

在 DSH 的插件安装界面里填入：

```text
github:space-spacee-clamation/dsh-plugin-whale-chan-pet
```

仓库内已提交构建产物，安装无需自行构建。

### 2. 安装本地目录

把包克隆/构建到运行 DSH 的机器上任意位置，然后安装该目录。维护者就是这么用的：profile 以链接方式指向工作副本，重建后无需重新安装即可生效。

**从上游插件迁移？** 两者的 entry ID 与服务名不同，上游的 overrides 不会作用于本 fork。`tools/entry-id-migration.mjs` 可以为 profile 的 patch 列表规划 ID 迁移（`whale-pet` → `whale-chan-pet`），结果需要你自己复核后应用。任务运行期间不要替换插件或重启 DSH。

## 使用

- **点击**宠物打招呼；**拖动**换位置。
- **右键**打开设置：感知范围、显示大小、动画、打盹时长。
- 用"唤回"按钮把收起的宠物叫回来。
- "全部会话"仅覆盖当前已连接 Host 上的普通主会话，不含多设备/多 Host。
- "等待你确认"的显示优先级最高；短暂完成提示不会排队重播。

## 兼容性与行为

- 行为逻辑继承上游：最初面向 **DSH Desktop 0.1.6-alpha.2 / macOS arm64** 开发。DSH 仍在演进，其他版本与平台组合未做全面认证。
- 本 fork 已在 **Windows 上的 DSH Web profile** 实测：overlay 占位与上游鲸鱼并排注册、六种状态可渲染、"工作时会话数"落在笔电屏幕上。这属于维护者观察到的渲染证据，不等同于完整测试矩阵。
- 完成事件使用真实的正常回合结束事件；中间助手/工具消息、取消、断连后的历史、工作数变化都不视为成功完成。
- 离线预览模拟完成事件，只验证渲染，不验证真实 DSH 事件投递。

## 开发

需要 Node.js 22 以上，以及项目 manifest 里锁定的 pnpm 版本。

```sh
node tools/build.mjs                  # 重新生成 lib/client.js 与 preview/index.html
node --test tests/*.test.mjs          # 187 项测试
```

素材相关（从生图输出重新生成素材）：

```sh
node tools/prepare-assets.mjs --src <生图输出目录> --long 560 --sharpen 0.7
node tools/prepare-assets.mjs --icon waiting          # 裁出插件管理器图标
node tools/prepare-assets.mjs --measure working       # 量测笔电屏幕位置，用于计数锚点
```

`prepare-assets.mjs` 会：去掉图像模型"画上去的棋盘格假透明背景"；通过判断被包围区域是否同时含两种棋盘格色阶，保住真正的白色美术（笔电屏幕、白板、卡片、围裙）；重新绘制均匀的白色贴纸描边；裁切到角色；用 **Lanczos-3** 重采样；做一次 **USM 锐化**；最后编码为 RGBA PNG。`--measure` 会报告最大的纯白实心区域，用来把"工作中会话数"锚定到插画上。

文档总览图由仓库内的素材渲染生成：

```powershell
pwsh -File tools/render-state-overview.ps1     # Windows，使用 System.Drawing
```

`pnpm run build` 会在打包客户端前额外重建桥接契约（esbuild + zod）；只改素材时不需要。构建产物已提交（便于 Git 安装），改源码后请重建并提交对应产物。

## 隐私与运行时边界

- 不修改 DSH 本身，不发送模型消息，不新增模型调用，不代你处理审批。
- 复用 DSH 已有的认证连接，不额外监听端口，无遥测，不运行时下载字体/CDN。
- 完成桥只投射必要的会话标识与回合边界元数据，不读取聊天内容。
- 偏好只存在客户端本地存储；本版本不含任何运行时诊断上报、诊断计数或诊断查询接口。
- 测试使用合成数据；仓库内不含用户 profile、会话记录或抽取自 DSH 的实现代码。

## 已知限制与待办

- **位图 vs 矢量。** 上游鲸鱼是扁平矢量贴纸，任意尺寸都锐利；本 fork 的插画带渐变与细线稿，缩小后会更软，需要约 125% 尺寸才能达到同样的视觉体量。把尺寸调大还能更清晰；要完全追平矢量锐度，只有把插画矢量描摹成 SVG 这一条路。
- **素材必须走工具重新生成。** 图像模型不会写出真正的 alpha 通道，而是把"棋盘格"画进图里；把生图原始输出直接丢进 `assets/` 会把棋盘格一起发出去。请始终使用 `tools/prepare-assets.mjs`。
- **上游的验证结论原样保留。** 并发会话、重连、取消、升级等边界由上游作者按 [COMPATIBILITY.md](COMPATIBILITY.md) 所述范围验证；本 fork 未重跑该矩阵。

## 致谢与许可

- **代码：** [MIT License](LICENSE)，fork 自 [Yifffan/dsh-plugin-whale-pet](https://github.com/Yifffan/dsh-plugin-whale-pet)，保留原始版权声明。
- **角色设定：** 互联网公开开源，MIT 协议；其原始声明适用于该设定本身。
- **角色素材：** 基于该设定用 AI 生成，不适用 MIT 代码许可，详见 [ASSETS-LICENSE.md](ASSETS-LICENSE.md)。
- **字体：** 沿用上游，[SIL OFL 1.1 及来源声明](FONT-LICENSES.md)。
- **Zod：** 其 MIT 版权与许可声明保留在生成的桥接文件中。

本项目为个人项目，不是 DeepSeek 官方产品，不代表 DeepSeek 官方立场或背书。
