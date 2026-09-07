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

维护当前文档、已保存内容、阅读/编辑模式、保存状态与错误。未来的多标签页应增加 session manager，而不是扩大单个 session 的职责。

### DocumentGateway

负责受支持文件的选择、Markdown 读取保存和 Markdown 内嵌图片读取。外部修改检测、原子保存、文件版本或冲突处理应在这一端口之后增加。

### WorkspaceGateway

负责记录用户打开过的根目录及文件树展开状态，并按需枚举每个根目录。侧栏直接把这些根目录渲染为一级树节点；“项目”不拥有独立文件模型。新建、重命名和移入废纸篓通过受根目录边界保护的 WorkspaceGateway 命令完成。全文搜索或内容索引应作为新的 workspace service 接入，不改变根目录和文档组件。

### MediaGateway

负责把已授权的本地媒体路径转换为 WebView 可读取的流式地址。媒体预览不进入 `DocumentSession`，避免把二进制文件误建模成可编辑文档。

### MarkdownRenderer

当前实现基于 markdown-it，禁用原始 HTML，并经过 DOMPurify。Mermaid、公式或自定义语法应通过 renderer extension 增加。

### MarkdownEditor

CodeMirror 被封装在独立组件内，只暴露 `value` 和 `onChange`。未来可以替换为所见即所得内核，而不用修改文件系统层。

## 本地安全边界

- 文档仅接受 `.md` 和 `.markdown`，最大 8 MB。
- 文件夹递归最大 16 层，忽略隐藏目录、`node_modules`、`target` 和符号链接。
- 单个根目录最多展示 20,000 个可预览条目；根目录树按展开动作懒加载。
- 本地图片最大 16 MB，只支持常见位图格式。
- 单文件模式只读取文档同级图片；工作区模式只读取工作区内部图片。
- 图片和视频只通过文件选择器授权的文件，或用户记录后展开的根目录访问；视频由 Tauri asset protocol 按 Range 分段读取。
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
