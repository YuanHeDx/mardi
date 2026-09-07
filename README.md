# mardi

`mardi` 是一个轻量、local-first 的 Markdown 阅览编辑器。它保留 Typora 式的安静阅读体验，但 MVP 不包含知识库、索引或插件系统。

## 当前能力

- 打开 `.md` / `.markdown`、常见位图和视频文件
- 把打开过的文件夹记录为根目录，并在同一棵侧栏文件树中纵向展示
- 在文件树中新建 Markdown、原位重命名文件，或将文件移到系统废纸篓
- 自动恢复上次打开的项目以及项目、子目录的展开状态
- 阅读视图与源码编辑模式切换
- `⌘S` / `Ctrl+S` 保存及未保存状态提示
- 标题、列表、任务列表、表格、引用、代码块和链接
- 当前文档或工作区内的相对路径图片
- PNG / JPEG / GIF / WebP / BMP / AVIF 图片预览
- MP4 / MOV / M4V / WebM 视频播放与时间轴拖动
- 跟随系统的浅色/深色主题
- 原始 HTML 默认禁用，文档与图片均有限制明确的本地读取边界

## MVP 暂不包含

- 行内所见即所得编辑
- 多标签页、全文搜索、内容索引和双链
- Mermaid、数学公式和图片资源管理
- 外部文件变化及冲突合并
- 云同步和插件系统

## 技术栈

- Tauri 2
- React 19 + TypeScript + Vite
- CodeMirror 6
- markdown-it + DOMPurify
- Vitest

## 本地开发

需要 Node.js、npm、Rust stable，以及对应平台的 Tauri 系统依赖。

```bash
npm install
npm run tauri dev
```

只预览界面：

```bash
npm run dev
```

## 验证

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles app
```

## 目录

```text
src/core/                 纯模型和端口
src/features/             文档、编辑器和多根目录工作区功能
src/infrastructure/       Tauri 平台适配
src/services/             Markdown 渲染等领域服务
src/ui/                   应用外壳和视觉系统
src-tauri/src/            文件系统、根目录记录与本地资源安全边界
docs/design/              视觉概念及验收截图
```

更完整的扩展边界见 [`docs/architecture.md`](docs/architecture.md)。
