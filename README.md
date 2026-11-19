# mardi

mardi 是一款 macOS 本地 Markdown 编辑器。打开已有的 `.md` 或 `.markdown` 文件就能写，修改会自动保存到原文件。点击段落可编辑 Markdown 标记，移开光标后，标题、列表和引用恢复排版。

## 在 Mac 上安装

**[下载 macOS 安装包（DMG，v0.3.0）](https://github.com/dragooncjw/mardi/releases/download/v0.3.0/mardi-macos-universal.dmg)**

此安装包由 `dragooncjw/mardi` fork 提供，基于上游 0.3.0 源码构建。

支持 macOS 13 及以上版本，适用于 Apple 芯片和 Intel 芯片。打开 DMG，把 **mardi.app** 拖到「应用程序」，再打开 mardi 并选择本地 Markdown 文件或文件夹。替换旧版前，请先退出 mardi。

安装包使用临时签名，未经 Apple 公证。若 macOS 提示无法验证开发者，可按 Apple 指引在「系统设置 → 隐私与安全性」中允许打开 mardi。[Apple 安装指引](https://support.apple.com/zh-cn/102445)

也可以[从源码构建](#从源码构建)，或在 [GitHub Releases](https://github.com/YuanHeDx/mardi/releases) 查看项目的正式发布。

## 阅读与编辑

- **原地编辑**。点击表格可编辑整块 Markdown，点击任务框可勾选或撤销。复制选区会保留 Markdown 标记。输入中文时，自动保存会等待输入法提交候选词。
- **文件夹和最近文件**。侧栏可同时展开多个文件夹，支持新建、重命名和移到废纸篓。重启后会恢复文件夹的展开状态，并保留最近打开的 100 个文件。
- **本地媒体**。在正文里预览相对路径图片，从文件树打开图片或播放视频。应用只读取获得授权的本地文件，远程图片显示为占位符。
- **保存与导航**。停止输入后自动保存，按 `⌘S` 可立即保存。普通点击编辑链接，按住 `⌘` 点击可打开 HTTP(S) 链接或跳到文内锚点。

## 从源码构建

需要 macOS 13 或更新版本、Xcode Command Line Tools、Node.js 24.15 或更新的 24.x 版本（含 npm），以及 Rust stable。用 `xcode-select --install` 安装 Apple 命令行工具。[Node.js 下载](https://nodejs.org/en/download) · [Rust 安装](https://rustup.rs/)

```sh
git clone https://github.com/YuanHeDx/mardi.git
cd mardi
npm ci
APPLE_SIGNING_IDENTITY=- npm run tauri build -- --bundles dmg -- --locked
open src-tauri/target/release/bundle/dmg
```

在打开的 Finder 窗口中双击 DMG，再将 **mardi.app** 拖到「应用程序」。

## 开发和测试

桌面端使用 Tauri 2 和 Rust，编辑器使用 React、TypeScript 和 CodeMirror 6。在仓库根目录执行 `npm ci` 后，可使用以下命令。

| 命令 | 用途 |
| --- | --- |
| `npm run tauri dev` | 启动桌面应用，使用真实文件系统 |
| `npm run dev` | 在浏览器中预览示例工作区 |
| `npm test` | 运行前端和交互测试 |
| `npm run build` | 类型检查并构建前端 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 运行原生文件与工作区测试 |

欢迎通过 GitHub Issues 提交问题。报告编辑或保存异常时，请附 macOS 版本、复现步骤和一小段可公开的 Markdown 示例。[架构说明](docs/architecture.md)

## 发布 macOS 安装包

将包含[发布工作流](.github/workflows/release-macos.yml)和对应版本的提交推送到 GitHub，再为该提交推送与 `src-tauri/tauri.conf.json` 中 `version` 一致的标签，例如 `v0.3.0`。GitHub Actions 会构建通用 DMG，并将 `mardi-macos-universal.dmg` 上传到 GitHub Release。上游首次发布后，可将 README 下载入口更新为对应的上游下载链接。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
