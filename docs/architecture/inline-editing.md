# mardi 原地编辑架构

日期：2026-11-03。状态：实施契约。产品交互见 [原地编辑设计](../design/inline-editing.md)。

## 结论与审查边界

保留 React / feature controller / pure core / Tauri gateway 的现有依赖方向，以 **一个长期存活的 CodeMirror 6 EditorView + Markdown Live Preview decorations** 替代文档的阅读/编辑双视图。Markdown 纯文本始终是唯一持久内容；排版 DOM、语法树、光标、撤销栈都不是第二份文档。

不需要重写文件系统、工作区、媒体或整个应用。需要重新定义的是 editor 的生命周期与 transaction 契约：从“可替换的源码输入框”提升为“拥有交互状态的唯一可编辑文档表面”。移除业务模型中的 `mode`，而不是隐藏切换按钮但继续维护两个输入世界。

本次以工作树为审查版本：基于 `c6c1500`，包含任务开始时未提交的 `App.tsx`、`App.css`、Rust 文件打开事件、Tauri 文件关联、`open-file-dialog.tsx` 及其测试。以下行号记录实施前证据；后续实现改变行号不改变其审查基线。实际覆盖 `core/document`、session hook、App 组装、Editor / Preview、renderer、selection toolbar、gateway、Rust 读写/图片安全边界；不是全仓安全审计。本文的运行行为由静态调用链推导，未把单元检查声称为真实中文输入法或原生客户端验收。

## 当前架构的可核验证据

| 事实与证据 | 影响与处理 |
| --- | --- |
| [core/document.ts:10](../../src/core/document.ts#L10) 的 session 同时持有 document、savedContent、mode、isSaving、isMissing；`loaded` 把 mode 重置为 preview（原 46–53 行）。[App.tsx:320](../../src/App.tsx#L320) 按 mode 在 Editor 与 Preview 之间条件渲染。[title-bar.tsx:44](../../src/ui/title-bar.tsx#L44) 暴露切换按钮。 | 明确存在全局模式门槛。移除 mode、mode action、setMode、TitleBar 模式 props；有文档即渲染唯一编辑器，无文档欢迎页仍可只读。 |
| [markdown-editor.tsx:69](../../src/features/editor/markdown-editor.tsx#L69) 在 mount 创建 EditorState/history；cleanup 销毁 view（原 117–121 行）。 | 在上述条件渲染路径中，切回阅读会卸载 editor，重新编辑会重建选区、滚动与 undo history。没有发现外部 history/session manager 能补偿。新能力必须以同文档 view 稳定为契约。 |
| [markdown-editor.tsx:123](../../src/features/editor/markdown-editor.tsx#L123) 对外部 value 用全量 replace + `addToHistory(false)`，组件原 props 没有文档身份。 | 该机制能避免普通 React echo 的相同字符串重复写回，但不能独自区分同文档 echo、磁盘刷新、另一个文件和同路径重新打开。原模式卸载掩盖部分生命周期问题；移除模式后必须补身份，不能直接复用 value-only 适配器。 |
| [use-document-session.ts:42](../../src/features/document/use-document-session.ts#L42) 的 transition 同步更新 sessionRef 和 dirtyRef；`setContent` 使用它（原 229–233 行）。[core/document.ts:115](../../src/core/document.ts#L115) 通过 source 与 savedContent 比较计算 dirty。 | 可继续复用。每个 CM 文本 transaction 同步通知 session；不用 React commit 的时机判定是否有未保存内容。selection / decorations transaction 不通知内容变化。 |
| [use-document-session.ts:57](../../src/features/document/use-document-session.ts#L57) 用队列串行保存并循环读取最新内容；saveCompleted 只接受实际写入的 content。[document.test.ts:30](../../src/core/document.test.ts#L30) 检查保存期间新编辑仍保持 dirty。[hook:235](../../src/features/document/use-document-session.ts#L235) 在 400ms 后自动保存。 | 保留“精确快照 + 串行队列 + 后续补写”的业务契约。禁止 renderer、widgets 或 editor 自行写磁盘。额外补 composition 与文档代际检查，不能让旧保存完成污染新 session。 |
| [hook:98](../../src/features/document/use-document-session.ts#L98) 的 prepareToLeave 在打开 / 关闭前保存；`refreshFromDisk` 在读前和读后都检查 path、dirty、isSaving（原 141–166 行）；删除时保留 dirty 文本（原 196–201 行）。 | 这是现有数据保护，必须保留。原地编辑不能绕过 openPath / closeDocument，尤其不能直接根据侧栏 path 替换 editor value。 |
| [markdown-renderer.ts:68](../../src/services/markdown-renderer.ts#L68) 禁用 raw HTML，支持任务列表并 DOMPurify sanitize（原 121–130 行）；[markdown-preview.tsx:45](../../src/ui/markdown-preview.tsx#L45) 对整篇内容渲染 HTML，并单独处理 DOM selection（原 88–249 行）。 | renderer 可继续服务欢迎页和受控块 widget，但不承担编辑数据模型。不要每次按键把整篇 HTML 放到 contenteditable，或把现有 Preview 自定义 DOM 选区算法移植进 CM。 |
| [document-gateway.ts:64](../../src/infrastructure/tauri/document-gateway.ts#L64) 封装本地图片读取；[lib.rs:665](../../src-tauri/src/lib.rs#L665) canonicalize 路径、拒绝绝对路径、检查工作区范围与 16MB 上限；[tauri.conf.json:26](../../src-tauri/tauri.conf.json#L26) 维持 CSP。 | image widget 必须复用此通路；不使用 file://，不扩大 asset scope 或放宽 CSP。图片 promise 需带文档 / widget 生命周期检查。 |
| [App.tsx:142](../../src/App.tsx#L142) 的 openFileAtPath 复用 openEntry；原 157–185 行的系统打开事件、[open-file-dialog.tsx:28](../../src/ui/open-file-dialog.tsx#L28) 的路径对话框也经同一入口。 | 保留任务开始前已有未提交能力。多个入口最终必须遵守同一个 prepareToLeave 与最新打开请求规则；不能为新编辑器另建直接加载路径。 |

这些证据证明局部编辑边界调整足以承载需求，不证明当前存储层已经具备外部冲突合并、崩溃恢复或原子保存；本次不把这些未实施能力写成既有保证。

## 方案决策

| 方案 | 收益 | 代价 / 决策 |
| --- | --- | --- |
| CM6 Live Preview（采用） | 复用现有文本、键盘、IME、选区、搜索、undo、文件管道；排版只是 source positions 上的投影；未知语法不丢失。 | 需要精确处理 decoration 范围、活动区域与 widget 点击映射。源码标记在活动行出现，是明确的产品行为。 |
| ProseMirror / TipTap 等富文本模型 | 对复杂结构编辑、表格单元格操作可更自然。 | 引入 Markdown ↔ 结构化文档序列化；任意原文的空白、引用形式、自定义语法与未完成语法必须额外保证。当前需求不要求结构化存储，替换文本模型会扩大迁移和兼容成本。若未来明确需要多人结构化协作，再单独评估。 |
| 给现有 markdown-it HTML 直接加 contenteditable | 表面改动少。 | 无 source-offset 模型，不能可靠保留 Markdown、跨块 selection、IME 与 undo；HTML 反序列化将成为另一套编辑内核。不采用。 |
| 点击块后临时挂载一个 editor | 非活动块能直接复用 HTML。 | 跨块选区、方向键、composition、undo、滚动会跨编辑器边界，违背连续原地编辑。不采用。 |

保留 `MarkdownRenderer` 的服务接口；它是安全的单向展示转换器，绝不能从渲染 HTML 生成持久内容。Editor 的 CM/Lezer 依赖仍只在 feature 层，core 不依赖 React、CM、markdown-it 或 Tauri。

## 数据与生命周期契约

### 文档、交互与保存各自归属

- `DocumentSession.document.content` 是应用可以保存的完整 Markdown 快照；`savedContent` 是实际完成写入的快照。dirty 必须继续比较二者。
- CM `EditorState.doc` 是活动编辑 transaction 的来源。每次真正 `docChanged` 同步向 session 发布全量文本，使 sessionRef 在事件返回前可见；应用绝不能在 selection 更新时重发内容。
- CM 独占 selection、history、viewport、composition 与 decoration 状态。React 仅提供文档生命周期 / 内容快照 / 上下文及回调，不以 state 模拟光标。
- 非活动 widget 只有 source range、只读展示 DOM 和发出 CM transaction 的命令。它不能拥有可编辑 HTML、独立 undo stack、持久数据或自行保存。
- 全量字符串发布暂保留现有 hook 契约；其 O(n) 复制以及 StatusBar 全文统计是已知大文档成本，不声称完全消除。先测量再决定是否以增量 change / 延迟 stats 优化，不为了本次需求在 core 引入 CM Text。

### 身份必须独立于文件路径

添加一个 opaque `loadGeneration`（或等义值），在每次成功 `loaded` 和 `cleared` 时变化，包含相同路径重新打开；`relocated` 与 `refreshed` 不改变这份文档身份。不能用 `key={path}`，因为 rename / move 应保留 undo、selection、scroll。不能只看 fileId，因为同一个文件重新打开也应建立全新的撤销边界。

| 事件 | EditorView / 文档状态 | history / selection / scroll |
| --- | --- | --- |
| CM user transaction → React echo，同 generation 且 value 相等 | 不 dispatch，不 setState，不 remount | 全保留。 |
| 焦点移动、sidebar 显隐、文档 rename、workspaceRoot 更新 | 原 view；仅更新 callbacks / context compartment | 全保留。 |
| 新 `loaded`（即使同路径同内容） | 新文档 EditorState；可复用 view 并 setState，或仅在 generation 变化时 remount | 清空旧 history；新 selection 从文档开始，scroll 从顶部；不自动抢走侧栏/打开对话框焦点。 |
| 干净文档真实 `refreshed`，同 generation、source 不同 | 这是磁盘替换，不是 echo；更新 source。应有显式 external revision / reset cause，不能靠普通 value 效果盲猜 | 保留并 clamp selection、保存 scroll；清除旧版本 undo，避免把已失效的磁盘版本经 undo 写回。可在同一个 view 上构造全新 EditorState；仅此有意重置，不当作正常按键路径。 |
| 切至图片/视频/欢迎页或 cleared | 正常离开保护完成后才销毁 editor | 不让旧 callbacks / 图片 promise 回写新文档。多文档历史缓存不在本期范围。 |

### 事务规则

1. 所有内容操作统一 `view.dispatch({ changes, selection?, annotations? })`；不写 `contentDOM.innerHTML`、不改 React value 后等 effect 覆盖 editor。任务框与格式快捷键也遵守此规则。
2. 用户操作进同一 history。任务框切换一个标记（`[ ]` ↔ `[x]`）是一个 undo 单元；必要时以官方 `isolateHistory` 隔离，不能把前一段输入一并撤销。装饰/活动区域/图片完成更新不进文本历史。
3. 每个 save operation 记录 generation、目标 path、实际 written source。完成时仅更新仍属该 generation 的 session；较新的 content 不被旧 source 覆盖。缺失文件仍保留草稿、阻止写回旧路径。
4. `openPath` / close / media 都先 prepareToLeave，保存成功才换文档；失败则停留并保留原文。默认使用 `openOperationRef`：在每次打开 / 关闭 / discard 开始时递增，保存门闩完成后和 readDocument 返回后都比较捕获的 operation，只有最新请求可 `loaded` / `cleared`。快速 A→B 即使 A 读完更晚也不能重新显示 A；旧请求失败也不覆盖新文档 error。异步并发打开若改为串行化，必须证明最终意图仍是最后一次请求。旧 save completion 另外由 generation 校验隔离，不能只依赖 open token。
5. 本次不增加新 autosave 实现，延用现有 400ms debounce、显式 Cmd/Ctrl+S、离开前 flush 和窗口关闭保护。

### IME 合成

`compositionstart` 到 `compositionend` 期间，保留同一 view / content DOM，所有文档变更照常进入 CM 并同步 session；活动块显隐冻结，只 map 既有 decorations 和活动范围经过 changes，避免重建用户正在合成的 DOM。结束后在 CM 已消费最终 DOM change 的下一次可控更新重新计算装饰，不能以合成事件中的过早旧 state 覆盖最终文本。

将 composing 作为临时编辑状态通知 session controller，自动保存等待合成结束再从最新 sessionRef 取快照。显式保存 / 离开请求必须先让 editor 完成当前合成（转移焦点并等待 composition end 和 CM flush）；尚未结束时保留原文并延迟离开，不能先卸载。窗口关闭保护同时考虑 dirty 与 composing。

可直接实现的门闩：hook 用 `setComposing(boolean)` 更新同步 ref；editor 注册 `commitComposition(): Promise<boolean>`。自动保存只在 composing=false 时排程，排程已开始但尚未写入时再检查一次。手动保存 / prepareToLeave 调用 commit：未合成立即成功；合成中让正文 blur，等 compositionend 后及两个 animation frame，最终一次 `onChange(view.state.doc.toString())` **先于**释放 composing。最长等待约 250ms；仍处于合成态返回 false，显示“请先确认输入法候选后重试”，保留文档、不清 dirty、不继续打开新文件。不得伪造 Enter、调用私有 CM DOMObserver、把未确认 marked text 当作最终内容，或留下永不结束的 promise。下一次实际 compositionend 正常恢复自动保存。窗口关闭遇到 dirty 或 composing 必须 preventDefault 后走同一门闩。

如果采用等义 controller 接口，可调整命名，但必须保留以上顺序、同步 ref、有限等待和失败不离开的语义。真实 macOS 输入法是验收依据，jsdom 合成事件只能验证应用门闩。

### 建议的 Editor 接口

```ts
interface MarkdownEditorProps {
  value: string;
  documentIdentity: number; // loaded / cleared 代际，relocated / refreshed 不变
  externalRevision: number; // 真实磁盘刷新边界，React echo 不变
  documentPath: string;
  workspaceRoot: string | null;
  onChange: (markdown: string) => void;
  onCompositionChange: (composing: boolean) => void;
  onCommitCompositionReady: (commit: (() => Promise<boolean>) | null) => void;
  onTextSelection?: (selection: TextSelection | null) => void;
}
```

`onCommitCompositionReady` 在 mount 注册、cleanup 注销；hook 保存该 handler 的 ref，不将函数放进 core model。context 改变不创建新 documentIdentity。所有回调使用最新 ref，不能让旧闭包指向上一个文档；异步 commit 返回后也核验 generation。

## 编辑展示规则与模块划分

建议模块如下；相邻的小 helper 可合并，禁止为了文件数量拆空壳。

| 模块 | 职责 | 禁止事项 |
| --- | --- | --- |
| `features/editor/markdown-editor.tsx` | 持有唯一 view；props / callback bridge；generation 与 external refresh；selection callback；composition；销毁清理 | 不包含文件访问 / 保存策略，不维护第二份富文本内容。 |
| `features/editor/live-preview.ts` | 使用 Lezer syntax tree 与 CM positions；活动行 / 活动整块范围；mark / line / replace decorations；上下文 effect | 不以全文 regex 假装 Markdown parser，不访问 DOM geometry。 |
| `features/editor/live-preview-widgets.ts` | 只读 table / image / task 等 widget；source-position 点击转换；widget eq / 生命周期；复用安全 renderer | 不嵌套 contenteditable；不异步 mutate session。 |
| `features/editor/editor-theme.ts` 或独立 stylesheet | 文档字体、行高、heading、列表、代码、活动标记的统一样式 | 不复用 Preview 的 DOM 选区 hack。 |
| 轻量资源 loader/helper（有共享需要再抽） | 图片授权 gateway、按 document path + workspaceRoot + source 缓存、失败与取消 | 不扩大 Native 权限。 |

语法配置必须显式覆盖 GFM：`markdown({ base: markdownLanguage, completeHTMLTags: false })`，或 `commonmarkLanguage + GFM`；不能把默认 `markdown()` 当作支持 task/table/strike 的完整语法。未知 / 未完成语法保留普通可编辑文本，绝不“修正”或丢弃。

### 活动范围

- 默认非活动行隐藏 Markdown 标记，保留标题、粗体、斜体、删除线、inline code、链接、列表、引用的文字排版。光标所在源码行显示该行完整标记，文字排版保持一致；不切另一套字体和宽度。
- 非空 selection 覆盖的所有行回显源码；多光标以所有 ranges 的并集计算，不能只检查 main range。边界按 CM `[from,to)` 处理，光标恰在标记边缘也要可进入，不能把正文装饰为不可编辑 atomic 大块。
- 代码围栏、表格是整块：任一 selection 与块相交即显示整块源码。代码内容始终用等宽字体，离开时仅收起围栏并保留代码排版，避免把大代码块反复替换为另一份 HTML。
- 表格非活动时可用安全 HTML widget，点击对应 row 定位该源码行；能可靠映射列时才定位到对应 cell，否则定位该行可编辑内容起点。首次不做独立 cell editor。widget 的整块源码必须可通过点击、方向键和 Shift 扩选进入；不能提供让键盘永远跳过表格的 blanket atomicRanges。
- 图片采用“一个 source/alt 行 + 下方稳定预览”，点击图片使该 source 行活动，预览仍保留；失败保留 alt 和轻量占位，仍可编辑原文。如果实现源码/预览互换，必须保留已测量高度和块上沿锚点，不能让大图突然缩成一行。可先支持独立图片行，复杂内联图片保留源文本，不能擅自拆断段落。
- 空文件、文末空白与最后一个 widget 下方必须有可达 caret / 可点击继续输入区域；不使用覆盖内容的透明层捕获所有点击。

### 点击与选区

- 普通链接单击用于放置光标、展开当前行；仅 Cmd/Ctrl+click 打开明确允许的 HTTP(S)。锚点只有在能安全映射为本文档 position 时跳转；其余不交给 WebView 导航。不接受 `javascript:`、`file:`、`data:` 或任意自定义 scheme。
- 任务框 click 只 dispatch 最小 source edit；不把键盘焦点抢走，也不改用 DOM checkbox 状态当作真相。点击当前 checkbox 时检查目标 range 的最新 source，避免使用过期 widget offset。
- 跨块选择、双击选词、Shift+方向键、复制/粘贴、搜索、undo 交给 CM。复制是原始 Markdown；现有“引用 / 批注”也用 CM source selection，不混用渲染文字和 DOM Range。
- selection toolbar 只在选区稳定后展示；拖动中不跟随每一帧抢焦点。滚动 / 文档切换 / composition 开始应隐藏或重新测量位置。selection 清空必须清掉 toolbar，坐标不可见返回 null。

## CM 官方约束与增量渲染

核验了本机安装的 `@codemirror/view 6.43.11`、`state 6.7.3`、`lang-markdown 6.5.2` 类型和实现，并对照官方主仓库。官网 reference 访问返回 403，因此使用官方 GitHub 原始源码；不是依赖第三方博客。

1. **结构性 decorations 用直接 StateField。** `EditorView.decorations` 的 view callback 在 viewport 计算之后运行，禁止 block widgets 或覆盖换行的 replace。表格 / 多行块必须 `StateField<DecorationSet>` 通过 `EditorView.decorations.from(field)` 直接供给。行内 mark / 不跨行 replace 可以由 viewport ViewPlugin 供给。[官方 view 源码](https://github.com/codemirror/view/blob/main/src/editorview.ts)。
2. **不在 plugin update 读 layout。** 更新阶段只计算状态和写 DOM；需要测量使用 `requestMeasure`，图片 / widget 高度异步改变后也请求测量。block widget 用内部 padding，不用外部垂直 margin。[官方 extension 源码](https://github.com/codemirror/view/blob/main/src/extension.ts)、[官方 decoration 源码](https://github.com/codemirror/view/blob/main/src/decoration.ts)。
3. **解析按预算进行。** Lezer syntaxTree 可能只覆盖已解析部分；不要每次按键 `ensureSyntaxTree(...doc.length, 大 timeout)` 强制同步全文完成。未知区域显示源文本，后台树推进后刷新 decorations。[官方 language 源码](https://github.com/codemirror/language/blob/main/src/language.ts)。
4. **不要每次 value 更新 setState。** `setState` 会重画整篇并重新初始化 plugins，仅用于新文档或明确的磁盘版本替换；普通编辑用 transactions。[官方 EditorView 源码](https://github.com/codemirror/view/blob/main/src/editorview.ts)。
5. **GFM 必须显式启用。** 默认 markdown 配置以 commonmarkLanguage 为 base，GFM 的 table/task/strike 在 extended language 中。[官方 Markdown 源码](https://github.com/codemirror/lang-markdown/blob/main/src/markdown.ts)。

性能实施要求：

- 行内装饰仅处理 `visibleRanges` 及必要边界；每次 selection 变化不扫描或渲染整篇 Markdown。
- 保存可复用语法位置 / 块索引，`docChanged` 时 map 未变化 ranges，并只重算受影响的语法块；光标变化仅更新前后活动区域。直接 StateField 中的结构性装饰不能依赖 viewport 才成立；如需 viewport 加载，由显式 state effect 提供有界窗口，窗口未准备时保持 source fallback。
- widget `eq` 依据 source / 必要 context，避免每个光标事件重造 DOM；image loader 对同一文档/根目录/source 去重。promise 结束时核验 generation、widget 是否存活与请求 token，销毁不触碰新文档。不要将旧图片错误反馈为新文档错误。
- 语法有歧义、解析暂未完成或超出预算时，保留可编辑 Markdown；不要冻结输入等待完整渲染。大文档可自动降低复杂块预览密度，用户仍在同一个编辑表面，无新增模式开关。
- 验收用约 100KB、含长代码块/表格/图片的混合文档观察连续输入与长滚动；另用 1MB 文档确认不阻塞 / 不出现全 DOM 渲染。记录设备与实测，不把预算当作已达到的性能结论。8MB 是现有读写上限，不能据此声称所有 8MB 文档具有相同流畅度。

## 安全与已知范围

- raw HTML 只作为 source 显示，不执行。widget 如必须插 HTML，只接受既有 SafeMarkdownRenderer sanitize 的结果；属性 / URL 仍走白名单，不能直接插 source。
- 本地图片通过现有 `DocumentGateway.readLocalImage(documentPath, source, workspaceRoot)`。独立文档仅其同级范围，工作区按现有 canonical root 检查；路径变化需更新 resource context，不重置编辑历史。
- 保持 Native 图片格式、16MB、文档 8MB、CSP 与媒体授权边界。当前 CSP 不允许任意远程图片，不为 Live Preview 放开；远程图片显示占位并保留可编辑 URL。
- 本期支持 CommonMark + 现有 GFM 的日常阅读排版和 source editing；table 整块编辑、代码块围栏显隐、图片预览。复杂嵌套或未实现装饰应保留源码，不能制造保存损失。
- Mermaid、公式、协同编辑、多标签历史、富文本剪贴板转换、表格结构操作、图片拖入、外部冲突合并、原子写/崩溃恢复不在本期。不要为这些假设引入插件总线或新数据库。

## 执行顺序与交付门槛

1. **建立生命周期与纯文本契约。** 移除 core/hook/TitleBar mode；添加 loadGeneration 和外部刷新原因；App 文档始终渲染唯一 MarkdownEditor，保留欢迎页 / 媒体 / 打开路径与系统打开事件。先验证输入、autosave、跨文件历史隔离、rename 历史保留。
2. **落地基础 Live Preview。** 显式 GFM，活动行 / 跨行 selection，heading / emphasis / strike / link / code / quote / list 的增量装饰与统一版式；未知语法保持 source。CM 原生 selection 取代旧 Preview 的自定义选择逻辑。
3. **完成任务 / 块 / 资源交互。** 最小事务 checkbox，代码围栏；直接 StateField 的 table widget 和点击 source row；授权图片与异步生命周期；末尾继续输入。接入现有引用/批注，不添加第二个格式工具栏。
4. **补 composition、leave、外部刷新与竞态。** 合成期间冻结显隐并延迟保存/离开；React echo 不重置 state；旧 read/save/image 结果隔离。保证 save failure 保留当前草稿。
5. **独立 reviewer 与 QA 后发布。** reviewer 验证 source range、隐藏区光标、循环 updates、跨文档/history、composition、图片权限；修复后重新跑相关检查。按 AGENTS.md 构建安装 `/Applications/mardi.app`，先把旧 bundle 移到 `/private/tmp` 唯一备份；验证新安装签名与启动。安装和原生验证不可作为用户手动后续。

最低自动验证：现有测试与 production build；新增测试覆盖 decorations 不更改 source、selection 相交恢复、table/task/code 语法隔离、checkbox 精确修改且可 undo、同文档 echo 不重建 view、同路径 reopen 隔离 history、rename 不丢 history、磁盘刷新边界、旧 image promise 不串文档、保存中继续输入、composition 的保存门闩。测试优先验证可失败的契约，不对每条 CSS 写镜像断言。

必须 computer use 验证：无切换控件、点击文字直接输入、活动标记显隐、长段落折行、跨块拖选与键盘选区、引用/批注、任务框/链接、表格回源码/修改/离开预览、代码围栏、图片成功/失败、末尾新增、undo/redo、切文档/rename/媒体、保存后重开、原生启动与焦点、真实中文输入法和滚动。真实输入法不可用时明确记为未覆盖，并做可执行的组合事件验证；不得写“已验证中文输入法”。

## 待核实项

- 隐藏标记后 WebKit 点击与方向键进入表格/图片边缘，必须在原生 WKWebView 实测；浏览器/jdom 检查不能取代。
- 性能验收需要本机实测；本文给定架构限制和样本，不声称已获得延迟指标。
- 现存存储使用 `fs::write`；本次保留既有行为。若发布前测试暴露外部写冲突或原子性问题，作为独立存储问题解决，不能归因于 decoration 本身。

## 实现闭环（0.2.0）

对照最终核心实现只读复核，现有分层保留，未发现需要扩大重构范围的契约偏离。原地编辑核心阶段为 78 项前端测试；后续补齐既有系统打开、独立媒体路径和手动保存保焦问题，0.2.1 发布代码验证为 **98 项前端测试、22 项 Rust 测试及 production build 通过**。本轮架构复核未重复执行整套检查。

| 契约 | 最终实现 |
| --- | --- |
| 文档身份与外部版本 | [core/document.ts:45](../../src/core/document.ts#L45)：`loaded` 增加 loadGeneration，`cleared` 同样建立新代际；`relocated` 不变。`refreshed` 只增加 externalRevision。[markdown-editor.tsx:264](../../src/features/editor/markdown-editor.tsx#L264) 只在 generation / revision 边界 setState；新文档清 history，真实刷新保留并 clamp 选区、保留 scroll 并重同步当前 focus。普通 React echo 无文本重写路径，rename 仅更新 resource context。 |
| 保存与加载归属 | [use-document-session.ts:92](../../src/features/document/use-document-session.ts#L92) 在 await 前绑定 requestedGeneration，队列和写入完成均核验代际；中途新编辑继续补写。[hook:153](../../src/features/document/use-document-session.ts#L153) 用 openOperation 隔离迟到 read / error；读取期间继续输入会先补存再重读，close / discard 也递增 operation。 |
| IME 有界 controller | 实际接口为 `onController(MarkdownEditorController)`；`finishComposition({ restoreFocusIf? })` / `focus` 与内容、composing 回调留在 feature controller。compositionend 后等待 60ms settle，先发布最新源码、解除装饰与 session composing gate，再完成 waiters；250ms 未完成返回 false，不写 marked text、不继续离开。全局保存快捷键先忽略 `KeyboardEvent.isComposing` 或 legacy `keyCode=229` 的 IME 处理键，不 preventDefault、不将候选处理误当成保存请求；只判断当前事件的 IME 标志，不用 session composing 状态屏蔽 compositionend 后 settle 窗口中的正常快捷键。显式 API 保存及离开请求仍走 controller 门闩。保存分为 manual / auto / leave：auto 只在非合成态排程，leave 不请求回焦；manual 因结束合成而 blur 后，只在提交成功且原先正文聚焦时恢复同一 view 的焦点与选区。session guard 同时核验 generation、externalRevision、controller 和 openOperation，editor 再核验存活、同 generation/revision、无新的外部 focus / pointer / window-blur 意图、当前仍是 body 或本编辑器；用户已转移焦点或发起打开请求时不回焦。 |
| 视口与结构性 decorations | [live-preview.ts:179](../../src/features/editor/live-preview.ts#L179) 的 StateField 直接向 EditorView.decorations 提供所有展示范围；ViewPlugin 仅以 animation frame 发送 previewWindow effect，含视口前后各约 5,000 CM positions 的缓冲。合成期间只 map 既有 decorations，不重建显隐。未解析区保持源码；没有按键强制全文解析路径。 |
| 表格展示与键盘进入 | [live-preview.ts:97](../../src/features/editor/live-preview.ts#L97) 对活动表格或 **source 超过 24,000 CM characters** 的表格保留等宽源码，其余使用安全 renderer 的只读 TableWidget。[同文件:228](../../src/features/editor/live-preview.ts#L228) 先预测垂直移动是否跨越 widget，以纯 effect 显露源码，再执行官方 cursorLine / selectLine / Page 命令。按 command identity 包装 defaultKeymap，保留 macOS / Emacs 既有别名及 Shift 变体；临时 revealed ranges 随下一 selection transaction 或未移动时清理，不写正文、不进入 history。 |
| 表格 cell 首次鼠标 anchor | [live-preview-widgets.ts:59](../../src/features/editor/live-preview-widgets.ts#L59) 仅把 Lezer cell source positions 放到只读展示属性，并允许原生事件进入 CM。[live-preview.ts:261](../../src/features/editor/live-preview.ts#L261) 通过公开 mouseSelectionStyle 映射首次 anchor，后续用官方 posAtCoords 取终点，并在 transaction 后 map anchor / range / 原 selection；MouseSelection 的 move/up、取消及边缘滚动生命周期仍由 CM 持有。没有引入第二套全局拖选引擎。 |
| 图片常驻与权限 | [live-preview.ts:110](../../src/features/editor/live-preview.ts#L110) 保留 source/alt 行与下方常驻 ImageWidget。[live-preview-widgets.ts:83](../../src/features/editor/live-preview-widgets.ts#L83) 用 generation、documentPath、workspaceRoot、source 隔离最多 64 项请求缓存，远程 / 未允许 scheme 保留占位；本地读取继续经原 gateway。alt 变化 updateDOM 复用 img；destroy 标记与连接状态阻止迟到回调操作失效 widget；加载后 requestMeasure。 |
| CRLF 与输入边界 | [markdown-editor.tsx:176](../../src/features/editor/markdown-editor.tsx#L176) 沿用源文件 lineSeparator，并以公开 clipboardInputFilter 将粘贴 / 文本拖入的 CRLF、CR、LF 统一为当前 separator；未编辑原文不执行全文规范化。用户修改仍由 CM 原生 transaction / undo 承担。 |
| 系统打开请求 | [App.tsx:161](../../src/App.tsx#L161) 用 layout ref 提供最新打开回调，稳定监听只随 runtime 建立/清理；单飞 drain 完成接收批次后再处理后续通知，避免 roots 初始化取消已从 Native 弹出的请求或并发批次乱序。 |
| 独立媒体路径 | [media-gateway.ts:8](../../src/infrastructure/tauri/media-gateway.ts#L8) 等待 Native [prepare_media_source](../../src-tauri/src/lib.rs#L666) 校验绝对路径、受支持的请求与 canonical 目标类型、可读常规文件后，仅授权该 canonical 单文件并转换 asset 地址。CSP 和父目录权限保持原边界。[media-preview.tsx:11](../../src/ui/media-preview.tsx#L11) 以每次打开代际隔离异步结果与媒体 DOM，同路径重开也可重试；离开视频会暂停播放。 |

代码与应用事件验证不等于完整原生覆盖：CR-03 已在候选 2 通过 WKWebView 的 ArrowUp / ArrowDown / Shift 扩选复验，CRLF 粘贴也通过；CR-04 经独立事件生命周期对照后，又于 2026-11-04/05 获得用户授权，以有效 held-button 状态的原生鼠标事件完成普通正反向、段落/列表两向和表格/尾段两向共六例连续拖选，原生 AX、刷新截图及 fixture 字节一致性有证据。未删除 CM 的标准失按钮保护；六个样例不代表完整坐标/字素/语法矩阵覆盖。真实系统 Pinyin 候选 / marked-text 已有原生覆盖；0.2.1 已验证 IME 处理 Cmd+S 不强制提交、用户确认后的保存及 A→B→A 读取回验，仍不以 Unicode 注入或模拟 composition 事件代替原生输入法证据。约 1.1MB / 10,001 行样本已完成原生编辑、保存和撤销校验，未声称获得量化延迟指标。最终系统打开、未加入根目录的独立媒体和安装验证结果以 QA 执行记录为准。
