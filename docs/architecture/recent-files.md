# mardi 最近打开文件

日期：2026-11-05。状态：实施契约；验证结果由本轮 QA 单独记录，本文不代表已完成运行验收。

## 范围与交互

侧栏上方保留文件夹树，下方增加“最近”。两区之间是一条可上下拖动的水平分隔条；文件夹树和最近列表各自滚动，分隔条、区域标题不随列表内容滚动。文件夹筛选只影响文件夹树，不筛选最近记录。没有根目录时仍显示最近列表。

最近记录覆盖所有明确打开的受支持文件，包括根目录外的独立 Markdown、图片和视频。文件选择器、绝对路径对话框、系统文件打开、文件树、创建后打开、打开文件夹时自动打开的首篇文档以及最近列表自身均复用 App 的共同打开入口。Markdown 内嵌图片、文件树扫描、磁盘刷新和仅展开文件夹不算打开。

- 最近列表最多保留 100 个不同的 canonical 路径，最新打开置顶；再次打开同一个文件更新原记录，不增加重复项。
- 每项显示文件名和父路径，文件名相同的文件可由父路径区分；完整路径可通过标题提示查看，当前活动文件高亮。
- 单击记录使用现有 `openFileAtPath` → `openEntry`，保留自动保存、IME、取消离开和加载代际保护。不得由最近组件直接读文件或替换编辑器内容。
- 提供“从最近移除”操作，只删除历史记录，不删除磁盘文件，不关闭活动文档。打开失败不自动删除旧记录，用户可以移除。
- 重启恢复历史列表；不自动打开列表首项，不恢复旧编辑器状态、媒体播放位置或权限授权。

分隔位置默认约为文件夹 60%、最近 40%。普通窗口下每区最小约 96px；可用高度不足两区最小值时按实际高度缩小约束，不能把分隔条或其中一区挤出窗口。窗口调整大小时重新 clamp，不持久化瞬时像素高度。将比例保存在独立 `localStorage` 设置中；缺失、损坏、越界值回退默认值，存储不可用仍可拖动。

分隔条使用 `role="separator"`、`aria-orientation="horizontal"`、可聚焦及当前值/上下限描述。指针拖动使用 pointer capture；抬起、取消、丢失 capture 和卸载均清理拖动状态。方向键上/下调整比例，Home/End 到上下允许边界；整个操作不改变文件打开状态。

## 现有架构与新增边界

现有 [App.tsx](../../src/App.tsx) 的 `openFileAtPath` 汇合路径打开和系统打开，再交给 `openEntry`。Markdown 通过 `documentSession.openPath` 判断打开是否成功；独立媒体在 `closeDocument` 成功后切换 `activeMedia`，资源授权与解码随后由 `MediaPreview` 异步完成。[workspace-sidebar.tsx](../../src/features/workspace/workspace-sidebar.tsx) 只接收数据和操作回调；根目录持久化位于 [project_repository.rs](../../src-tauri/src/project_repository.rs)。这些边界可以保留，无需改动编辑器、媒体资源管道或根目录 schema。

| 模块 | 职责 |
| --- | --- |
| `core/recent-files.ts` | `RecentFile` 纯数据模型，不依赖 React / Tauri。 |
| `core/ports/recent-files-gateway.ts` | 列表、记住、移除、迁移路径四个端口。 |
| `infrastructure/tauri/recent-files-gateway.ts` | Tauri 命令映射及浏览器演示适配；不向 UI 暴露原生配置路径。 |
| `features/recent-files/use-recent-files.ts` | 串行执行初始化/变更请求并发布完整快照，提供文件操作前的历史等待边界，维护列表与独立错误状态；不拥有活动文件。 |
| `App` | 连接共同打开成功边界、应用内重命名与删除结果，将数据/回调传给侧栏。 |
| `WorkspaceSidebar` | 文件夹树与最近记录展示；不直接调用 Native。 |
| `SidebarSplitPane` | 独立持有双区分隔比例和拖动状态，避免每次指针移动使整棵文件树随之重新渲染。 |
| `src-tauri/src/recent_files_repository.rs` | canonical 路径验证、MRU 规则、序列化和互斥写入。 |

Native 在应用配置目录使用独立 `recent-files-v1.json`：

```json
{
  "version": 1,
  "files": [
    {
      "path": "/Users/example/notes/today.md",
      "name": "today.md",
      "kind": "markdown",
      "lastOpenedAt": 1793836800000
    }
  ]
}
```

不得修改 `project-roots-v1.json` 的结构或把最近文件转换成项目根目录。最近记录不是内容索引，不持久化正文、file ID、asset URL 或权限 grant。

## 接口契约

```ts
interface RecentFile {
  path: string;
  name: string;
  kind: "markdown" | "image" | "video";
  lastOpenedAt: number; // 毫秒
}

interface RecentFilesGateway {
  list(): Promise<RecentFile[]>;
  remember(path: string): Promise<RecentFile[]>;
  forget(path: string): Promise<RecentFile[]>;
  relocate(previousPath: string, nextPath: string): Promise<RecentFile[]>;
}
```

| Native 命令及前端参数 | 成功语义 |
| --- | --- |
| `list_recent_files` | 返回完整、按最近顺序排列、去重且最多 100 项的快照；不枚举根目录或逐项探测磁盘，不因临时离线而删除历史。 |
| `remember_recent_file { path }` | 验证绝对路径、canonicalize、支持格式和可读常规文件后，以 canonical 路径去重并置顶，更新时间，持久化后返回完整列表。 |
| `forget_recent_file { path }` | 删除等于该路径及位于其下的记录；仅改历史，成功持久化后返回完整列表。单文件移除与目录删除共用这一操作。 |
| `relocate_recent_files { previousPath, nextPath }` | 原生重命名已成功后，将相等路径及子路径前缀替换为新位置，更新 name，保留时间和原顺序；碰撞按较新记录去重，持久化后返回完整列表。 |

`forget` 与 `relocate` 的旧路径在删除/重命名后可能已不存在，不能要求旧路径 canonicalize。两端要求绝对路径，并对旧路径做 lexical 规范化；前缀匹配按 `Path` 组件边界，`/notes/a` 不匹配 `/notes/ab`。`nextPath` 验证为现存 canonical 文件或目录，目录迁移不逐项要求其历史子文件仍存在。正常调用使用 Native 文件操作返回的新路径。

`remember` 使用 Native 当前毫秒时间；为抵抗同毫秒打开与系统时钟回拨，时间至少为已有最大时间，等值时保留最新插入优先的稳定顺序。重命名不是打开，不能把迁移记录提升到顶部。符号链接别名 canonicalize 后共享同一条历史；历史身份是路径，不承诺用 inode 跨任意外部移动追踪文件。

Gateway 四个方法保持返回完整 `RecentFile[]`。hook 对 App 暴露的 `remember(path)` 返回 `Promise<RecentFile | null>`：成功取此次快照首项，提供 Native 确认的 canonical identity；失败在 hook 内部处理并返回 `null`，不向打开流程抛出。

## 打开与持久化顺序

`openEntry` 仅在 Markdown 的 `openPath` 返回 `true`，或媒体关闭当前文档并切换成功后，触发 `remember`。该调用当下将操作加入历史队列，打开流程不等待历史响应。取消离开、文档读取失败、不支持的格式不记入历史。历史写入失败不得把已经打开的文件报告为打开失败。

媒体的历史语义是“明确打开了 Native 可读的受支持文件”。现有 `MediaPreview` 授权和解码链不迁移到历史 hook；Native `remember` 再次验证文件可读，因此不存在或不可读的媒体不会新增历史。文件可读但 WebView 不支持编码时保留记录，允许修复或重开。后台 widget 的图片资源加载不能触发历史记录。

媒体收到成功记录后，仅为仍然匹配该次 `openGeneration` 和请求 `path` 的活动媒体补充 `canonicalPath`；侧栏高亮优先比较该 canonical identity。`path`、预览 source 和 `openGeneration` 保持稳定，因此 `/tmp` 或 symlink 别名身份确认不会重载图片、重启视频或改变播放代际。切换媒体后迟到的 identity 响应被忽略。实际重命名仍按既有路径迁移流程更新资源路径。

hook 将 gateway 调用及完整快照发布一并放入 FIFO，包括初次 `list`、后续 reload 和全部变更。前一条请求完成并处理结果后，才调用下一条 gateway；迟到初始化不能覆盖后续快照，后发变更也不能先到 Native。操作在队列执行体中捕获同步异常与 Promise rejection，失败保留已有列表并让后续请求继续。实际卸载后不发布 React 状态。错误在历史区域可见并可恢复，不覆盖 `DocumentSession` 的错误与保存状态。

应用内重命名和移到废纸篓通过 hook 的 `runAfterPending(operation)` 调用实际文件操作。它读取当前 `queueRef.current` 并等待；等待完成后若引用已经变化，继续等待新队尾，直到所等的 pending 与当前队尾相同，然后在同一微任务续体中直接调用传入的 operation。不能先返回一个“已清空”结果，再由调用者另行提交文件操作。等待期间新增的已成功打开记录也会被 drain；历史读取/写入失败由队列吸收，不阻止文件操作。文件系统成功后，再将 `relocate` 或 `forget` 加入同一历史 FIFO。

这一边界覆盖文件操作发起前已经成功打开并加入历史队列的文件，避免排队中的 `remember` 因旧路径先被 rename/trash 而无法验证。仍在 `openPath` 中的请求、文件操作执行期间另起的打开继续遵守现有文档代际与保存门闩；本期不增加全局 App 打开/文件操作队列。`runAfterPending` 也不承担所有文件系统操作之间的互斥。本机 Tauri 的 `scripts/ipc-protocol.js` 在 macOS 默认通过独立 `fetch('ipc://…')` 请求传输，不能用 JS 提交先后来推断 Native 到达次序。因此顺序由等待已完成请求建立，Native 仓库 `Mutex` 仅保护历史读改写临界区。

Native 为此仓库单独加锁，读取、变更、临时文件写入和 rename 在同一临界区完成。`remember` 在 `File::open` 前拒绝 FIFO、设备等非普通文件，并保留打开后的句柄 metadata 复核，避免明确输入的特殊文件挂住仓库。写入失败返回错误，不发布未持久化的列表。缺失文件读取为空；损坏 JSON 或不支持的版本按现有根目录仓库策略回退空历史，下一次成功变更才写入 v1。读取权限等实际 I/O 失败继续返回错误。临时文件替换降低半写 JSON 风险，不声称提供断电持久性或跨进程事务。

## 文件生命周期与边界

| 事件 | 最近列表处理 |
| --- | --- |
| 再次打开相同文件 | 原记录置顶，更新时间；不会重复。 |
| 应用内重命名文件/文件夹 | 通过 `runAfterPending` 等待已加入队列的历史操作，再提交文件系统重命名；成功后将 `relocate` 入队，按组件前缀更新相关记录，失败不迁移。当前文档/媒体仍走既有 relocate 处理。 |
| 从文件夹列表移除根目录 | 保留最近记录；此操作不删除文件。 |
| 应用内移到废纸篓 | 确认与既有保存门闩通过后，用 `runAfterPending` 等待历史，再提交文件系统操作；成功后将 `forget` 入队，移除该路径及子路径记录，取消或失败不改历史。 |
| 外部删除、外部重命名已关闭文件 | 不扫描或猜测新位置。保留旧记录，点击时走既有打开错误反馈，用户可移除；重新打开新路径产生新记录。 |
| 活动文档 watcher 对外部移动的身份协调 | 现有 session 识别移动后，App 观察同一 `loadGeneration` 的活动文档路径变化，对已知旧/新路径提交 `relocate`，保持最近时间。该观察不扫描全部历史，不为已关闭文件定位，也不把移动当作新打开。 |
| 新文件创建成功但随后打开失败 | 文件创建结果和历史分别处理；未成功打开不新增记录。 |
| 旧历史记录暂时不可读 | `list` 不自动清理；打开失败不提升其顺序。 |

历史存储不授予文件读取或写入权限，不扩大 Tauri asset scope，不变更 CSP。最近列表再次打开媒体仍走现有 Native 单文件校验与授权；工作区文件操作继续要求已登记根目录。浏览器演示可提供内存历史以展示交互，但不将其声称为原生重启持久化。

## 交付核对

实现与 review 重点：全部打开来源归一、打开失败不新增、历史失败不阻塞打开、hydration 与快速连续打开顺序、延迟历史期间 rename/trash 前的稳定队尾等待、等待期间新增记录与失败后的文件操作、100 条与同路径去重、同毫秒/回拨顺序、目录前缀边界、重命名不改时间、根目录移除与磁盘删除语义分离、损坏配置恢复。

原生 QA 重点：根目录外文件可见、Markdown/图片/视频均记入、两区独立滚动、指针越出侧栏后的分隔拖动结束、键盘分隔调整、窗口缩小、重启恢复、失败记录可移除，以及已安装应用的签名和启动。按仓库 `AGENTS.md` 完成本轮新版本构建后的安装与可恢复备份；文档或单元测试结果不能替代这些运行证据。
