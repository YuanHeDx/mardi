# mardi architecture

## 目标

mardi 的 MVP 保持功能克制，但避免把文件访问、Markdown 渲染和 React 组件耦合在一起。后续能力应通过现有端口扩展，而不是把平台逻辑塞入 UI。

## 依赖方向

```text
UI components
    ↓
Feature hooks/controllers
    ↓
Core models and ports
    ↑
Tauri and rendering adapters
```

`src/core` 不允许依赖 React、Tauri、CodeMirror 或 markdown-it。

## 核心边界

### DocumentSession

维护当前文档、已保存 Markdown、文档代际、保存状态与错误。文档不再拥有阅读/编辑模式；光标、撤销和合成状态由唯一编辑器负责。未来的多标签页应增加 session manager，而不是扩大单个 session 的职责。原地编辑的完整契约见 [inline-editing.md](architecture/inline-editing.md)。

### DocumentGateway

负责受支持文件的选择、Markdown 读取保存和 Markdown 内嵌图片读取。外部修改检测、原子保存、文件版本或冲突处理应在这一端口之后增加。

### WorkspaceGateway

负责记录用户打开过的根目录及文件树展开状态，并按需枚举每个根目录。侧栏直接把这些根目录渲染为一级树节点；“项目”不拥有独立文件模型。新建、重命名和移入废纸篓通过受根目录边界保护的 WorkspaceGateway 命令完成。全文搜索或内容索引应作为新的 workspace service 接入，不改变根目录和文档组件。

### MediaGateway

负责异步准备用户明确打开的本地媒体地址：Native 校验受支持格式、绝对路径和可读常规文件，将路径 canonicalize 后只授权该单个文件，再发布 WebView 可读取的 asset 地址；不授权其父目录、不改变 CSP。媒体预览不进入 `DocumentSession`，每次打开使用独立代际，延迟结果不覆盖新媒体，同一路径可重开重试。

### RecentFilesGateway

独立维护最近打开文件的路径、类型和打开时间，不保存正文或授予文件权限。`App` 在共同打开成功边界触发记录，历史错误由独立 hook 和侧栏处理；原生仓库与根目录配置分开持久化。侧栏分隔比例属于 UI 状态。顺序与文件生命周期契约见 [recent-files.md](architecture/recent-files.md)。

### MarkdownRenderer

基于 markdown-it，禁用原始 HTML，并经过 DOMPurify，用于只读欢迎内容及受控的展示块；不负责将可编辑 HTML 序列化为 Markdown。Mermaid、公式或自定义展示语法应通过 renderer extension 增加，并独立评估编辑器语法扩展。

### MarkdownEditor

一个长期存活的 CodeMirror 6 EditorView 承载源文本、选区、历史和 Live Preview。Markdown 原文是唯一持久内容，排版由基于源码位置的 decorations / 只读 widgets 提供；修改统一经过 CM transaction。组件接口显式区分文档代际、真实外部刷新与普通 React 内容回传，并向 session controller 提供合成输入的保存门闩；文件访问仍通过现有端口。具体模块边界、官方 API 限制与验收见 [inline-editing.md](architecture/inline-editing.md)。

## 系统打开请求

系统文件关联使用一个稳定的前端监听器，最新打开回调通过 ref 更新；根目录初始化和 React 渲染不取消已经从 Native 队列取出的请求。每批文件及其后续通知按单飞 drain 顺序处理，避免旧 batch 的尾部文件覆盖并发打开的新 batch。

## 本地安全边界

- 文档仅接受 `.md` 和 `.markdown`，最大 8 MB。
- 文件夹递归最大 16 层，忽略隐藏目录、`node_modules`、`target` 和符号链接。
- 单个根目录最多展示 20,000 个可预览条目；根目录树按展开动作懒加载。
- Markdown 内嵌本地图片最大 16 MB，只支持常见位图格式。
- 单文件模式只读取文档同级图片；工作区模式只读取工作区内部图片。
- 独立图片和视频可通过文件选择器、文件树或明确输入绝对路径打开；所有媒体先通过 Native 的精确 canonical 单文件授权。已记录根目录仍按原有范围授权，单文件打开不扩大为目录权限；SVG 和不支持的格式被拒绝。视频由 Tauri asset protocol 按 Range 分段读取。
- 根目录历史及文件树展开状态以版本化 JSON 保存在应用配置目录，不建立内容索引或数据库。
- 原始 HTML 和脚本不执行，外部链接交给系统浏览器。

## 后续扩展落点

| 能力 | 扩展位置 |
| --- | --- |
| 多标签页 | `DocumentSessionManager` |
| 根目录排序/置顶 | `WorkspaceGateway` + project repository |
| 外部变更/冲突 | `DocumentGateway` + file watcher adapter |
| 全文搜索 | 新增 `WorkspaceSearch` port |
| Mermaid/公式 | `MarkdownRenderer` extension |
| 图片拖入 | 新增 `AssetGateway` |
| 插件命令 | 新增 `CommandRegistry` |
| 跨平台 | 复用 React/Core，更换或扩展 Tauri adapter |

## 视觉基准

- `docs/design/mardi-concept.png`：实现概念
- `docs/design/mardi-browser.png`：浏览器实现截图
- `docs/design/mardi-native.png`：macOS 原生运行截图
