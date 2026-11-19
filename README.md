# mardi

mardi 是一款 macOS 本地 Markdown 编辑器。打开已有的 `.md` 或 `.markdown` 文件就能写，修改会自动保存到原文件。点击段落可编辑 Markdown 标记，移开光标后，标题、列表和引用恢复排版。

## Quickstart · 在 Mac 上安装

**交给 coding agent 安装**，复制下面这句话即可。

> 请从 https://github.com/YuanHeDx/mardi 克隆 mardi，按照 README 检查 macOS 构建依赖，从源码构建应用。若已有旧版，请先退出并备份，再安装到 /Applications/mardi.app，验证签名并启动。

**手动安装**需要 macOS 13 或更新版本、Xcode Command Line Tools、Node.js 24.15 或更新的 24.x 版本（含 npm），以及 Rust stable。用 `xcode-select --install` 安装 Apple 命令行工具，Node.js 和 Rust 可从各自官网安装。[Node.js 下载](https://nodejs.org/en/download) · [Rust 安装](https://rustup.rs/)

```sh
git clone https://github.com/YuanHeDx/mardi.git
cd mardi
npm ci
npm run tauri build -- --bundles app
codesign --force --sign - src-tauri/target/release/bundle/macos/mardi.app
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/mardi.app
open src-tauri/target/release/bundle/macos
```

在打开的 Finder 窗口里，把 **mardi.app** 拖到「应用程序」。若已有旧版，先退出并将旧版移到备份位置。打开 mardi，选择一个本地 Markdown 文件；也可以打开文件夹，从侧栏切换文档。

## 阅读与编辑

- **原地编辑**。点击表格可编辑整块 Markdown，点击任务框可勾选或撤销。复制选区会保留 Markdown 标记。输入中文时，自动保存会等待输入法提交候选词。
- **文件夹和最近文件**。侧栏可同时展开多个文件夹，支持新建、重命名和移到废纸篓。重启后会恢复文件夹的展开状态，并保留最近打开的 100 个文件。
- **本地媒体**。在正文里预览相对路径图片，从文件树打开图片或播放视频。应用只读取获得授权的本地文件，远程图片显示为占位符。
- **保存与导航**。停止输入后自动保存，按 `⌘S` 可立即保存。普通点击编辑链接，按住 `⌘` 点击可打开 HTTP(S) 链接或跳到文内锚点。

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

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
