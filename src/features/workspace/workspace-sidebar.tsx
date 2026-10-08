import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileImage,
  FilePlus2,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  RotateCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useRef, useState, type MouseEvent } from "react";
import {
  filterWorkspaceEntries,
  fileNameParts,
  type RootWorkspace,
  type WorkspaceEntry,
} from "../../core/workspace";
import { copyPlainText } from "../../infrastructure/clipboard";
import { ContextMenu, type ContextMenuItem } from "../../ui/context-menu";

interface WorkspaceSidebarProps {
  roots: RootWorkspace[];
  activePath: string | null;
  canManageFiles: boolean;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onRefreshFiles: () => void | Promise<void>;
  onRemoveRoot: (rootPath: string) => void;
  onRetryRoot: (rootPath: string) => void;
  onSelectEntry: (entry: WorkspaceEntry, rootPath: string) => void;
  onToggleRoot: (workspace: RootWorkspace) => void;
  onTogglePath: (rootPath: string, path: string) => void;
  onExpandPath: (rootPath: string, path: string) => void;
  onCreateFile: (
    rootPath: string,
    parentPath: string,
    name: string,
  ) => Promise<boolean>;
  onCreateDirectory: (
    rootPath: string,
    parentPath: string,
    name: string,
  ) => Promise<boolean>;
  onRenameFile: (
    entry: WorkspaceEntry,
    rootPath: string,
    newStem: string,
  ) => Promise<boolean>;
  onDeleteFile: (entry: WorkspaceEntry, rootPath: string) => Promise<boolean>;
}

type EditingState =
  | {
      mode: "create";
      rootPath: string;
      parentPath: string;
      kind: "markdown" | "directory";
    }
  | {
      mode: "rename";
      rootPath: string;
      entry: WorkspaceEntry;
    };

interface InlineNameEditorProps {
  entryKind: WorkspaceEntry["kind"];
  indentation: number;
  initialValue: string;
  extension: string;
  onCancel: () => void;
  onSubmit: (value: string) => Promise<boolean>;
}

function InlineNameEditor({
  entryKind,
  indentation,
  initialValue,
  extension,
  onCancel,
  onSubmit,
}: InlineNameEditorProps) {
  const [value, setValue] = useState(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const cancelled = useRef(false);
  const submitting = useRef(false);

  const commit = async () => {
    if (cancelled.current || submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    const didSubmit = await onSubmit(value);
    if (!didSubmit) {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="tree-row tree-inline-editor"
      style={{ paddingLeft: indentation }}
    >
      {entryKind === "directory" ? (
        <Folder className="tree-main-icon" />
      ) : (
        <FileText className="tree-main-icon" />
      )}
      <input
        aria-label="文件名"
        autoFocus
        disabled={isSubmitting}
        onBlur={() => void commit()}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            onCancel();
          } else if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
        }}
        value={value}
      />
      <span className="tree-file-extension">{extension}</span>
    </div>
  );
}

function FileIcon({ entry }: { entry: WorkspaceEntry }) {
  if (entry.kind === "image") return <FileImage className="tree-main-icon" />;
  if (entry.kind === "video") return <Film className="tree-main-icon" />;
  return <FileText className="tree-main-icon" />;
}

interface TreeEntryProps {
  entry: WorkspaceEntry;
  rootPath: string;
  activePath: string | null;
  level: number;
  collapsedPaths: Set<string>;
  editing: EditingState | null;
  onCancelEditing: () => void;
  onCreateFile: (
    rootPath: string,
    parentPath: string,
    name: string,
  ) => Promise<boolean>;
  onCreateDirectory: WorkspaceSidebarProps["onCreateDirectory"];
  onRenameFile: (
    entry: WorkspaceEntry,
    rootPath: string,
    newStem: string,
  ) => Promise<boolean>;
  onOpenContextMenu: (
    event: MouseEvent,
    entry: WorkspaceEntry,
    rootPath: string,
  ) => void;
  onToggle: (rootPath: string, path: string) => void;
  onSelectEntry: (entry: WorkspaceEntry, rootPath: string) => void;
  forceExpanded: boolean;
}

function TreeEntry({
  entry,
  rootPath,
  activePath,
  level,
  collapsedPaths,
  editing,
  onCancelEditing,
  onCreateFile,
  onCreateDirectory,
  onRenameFile,
  onOpenContextMenu,
  onToggle,
  onSelectEntry,
  forceExpanded,
}: TreeEntryProps) {
  const isCollapsed = !forceExpanded && collapsedPaths.has(entry.path);
  const indentation = 14 + level * 16;
  const createState =
    editing?.mode === "create" && editing.parentPath === entry.path
      ? editing
      : null;
  const isRenaming =
    editing?.mode === "rename" && editing.entry.path === entry.path;

  if (isRenaming) {
    const { stem, extension } =
      entry.kind === "directory"
        ? { stem: entry.name, extension: "" }
        : fileNameParts(entry.name);
    return (
      <li>
        <InlineNameEditor
          entryKind={entry.kind}
          extension={extension}
          indentation={indentation + 18}
          initialValue={stem}
          onCancel={onCancelEditing}
          onSubmit={(newStem) => onRenameFile(entry, rootPath, newStem)}
        />
      </li>
    );
  }

  if (entry.kind === "directory") {
    return (
      <li>
        <div className="tree-row-shell">
          <button
            aria-expanded={!isCollapsed}
            className="tree-row"
            style={{ paddingLeft: indentation }}
            onClick={() => onToggle(rootPath, entry.path)}
            onContextMenu={(event) =>
              onOpenContextMenu(event, entry, rootPath)
            }
            title={entry.path}
            type="button"
          >
            {isCollapsed ? <ChevronRight /> : <ChevronDown />}
            <Folder className="tree-main-icon" />
            <span>{entry.name}</span>
          </button>
        </div>
        {!isCollapsed ? (
          <ul>
            {createState ? (
              <li>
                <InlineNameEditor
                  extension={createState.kind === "markdown" ? ".md" : ""}
                  entryKind={createState.kind}
                  indentation={indentation + 34}
                  initialValue={
                    createState.kind === "markdown" ? "未命名" : "未命名文件夹"
                  }
                  onCancel={onCancelEditing}
                  onSubmit={(name) =>
                    createState.kind === "markdown"
                      ? onCreateFile(rootPath, entry.path, name)
                      : onCreateDirectory(rootPath, entry.path, name)
                  }
                />
              </li>
            ) : null}
            {entry.error ? (
              <li>
                <div
                  className="tree-subtree-error"
                  style={{ paddingLeft: indentation + 34 }}
                  title={entry.error}
                >
                  <span>无法读取此文件夹</span>
                </div>
              </li>
            ) : null}
            {entry.children.map((child) => (
              <TreeEntry
                activePath={activePath}
                collapsedPaths={collapsedPaths}
                editing={editing}
                entry={child}
                forceExpanded={forceExpanded}
                key={child.path}
                level={level + 1}
                onCancelEditing={onCancelEditing}
                onCreateFile={onCreateFile}
                onCreateDirectory={onCreateDirectory}
                onOpenContextMenu={onOpenContextMenu}
                onRenameFile={onRenameFile}
                onSelectEntry={onSelectEntry}
                onToggle={onToggle}
                rootPath={rootPath}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <li>
      <div className="tree-row-shell">
        <button
          className={`tree-row tree-file ${activePath === entry.path ? "is-active" : ""}`}
          style={{ paddingLeft: indentation + 18 }}
          onClick={() => onSelectEntry(entry, rootPath)}
          onContextMenu={(event) =>
            onOpenContextMenu(event, entry, rootPath)
          }
          title={entry.path}
          type="button"
        >
          <FileIcon entry={entry} />
          <span>{entry.name}</span>
        </button>
      </div>
    </li>
  );
}

interface RootEntryProps {
  workspace: RootWorkspace;
  activePath: string | null;
  editing: EditingState | null;
  onCancelEditing: () => void;
  onCreateFile: WorkspaceSidebarProps["onCreateFile"];
  onCreateDirectory: WorkspaceSidebarProps["onCreateDirectory"];
  onRenameFile: WorkspaceSidebarProps["onRenameFile"];
  onOpenRootContextMenu: (event: MouseEvent, workspace: RootWorkspace) => void;
  onOpenEntryContextMenu: (
    event: MouseEvent,
    entry: WorkspaceEntry,
    rootPath: string,
  ) => void;
  onRetryRoot: (rootPath: string) => void;
  onSelectEntry: (entry: WorkspaceEntry, rootPath: string) => void;
  onTogglePath: (rootPath: string, path: string) => void;
  onToggleRoot: (workspace: RootWorkspace) => void;
  filterQuery: string;
}

function RootEntry({
  workspace,
  activePath,
  editing,
  onCancelEditing,
  onCreateFile,
  onCreateDirectory,
  onRenameFile,
  onOpenRootContextMenu,
  onOpenEntryContextMenu,
  onRetryRoot,
  onSelectEntry,
  onTogglePath,
  onToggleRoot,
  filterQuery,
}: RootEntryProps) {
  const { root } = workspace;
  const isFiltering = Boolean(filterQuery.trim());
  const isExpanded = workspace.isExpanded || isFiltering;
  const collapsedPaths = new Set(
    isFiltering ? [] : workspace.collapsedPaths,
  );
  const visibleEntries = filterWorkspaceEntries(
    workspace.entries ?? [],
    filterQuery,
  );
  const createState =
    editing?.mode === "create" && editing.parentPath === root.rootPath
      ? editing
      : null;

  if (
    isFiltering &&
    !workspace.isLoading &&
    !workspace.error &&
    visibleEntries.length === 0
  ) {
    return null;
  }

  return (
    <li className="root-entry">
      <div className="root-row">
        <button
          aria-expanded={isExpanded}
          className="root-main"
          onClick={() => onToggleRoot(workspace)}
          onContextMenu={(event) => onOpenRootContextMenu(event, workspace)}
          title={root.rootPath}
          type="button"
        >
          {isExpanded ? <ChevronDown /> : <ChevronRight />}
          {isExpanded ? (
            <FolderOpen className="tree-main-icon" />
          ) : (
            <Folder className="tree-main-icon" />
          )}
          <span>{root.name}</span>
        </button>
      </div>

      {isExpanded ? (
        <div className="root-contents">
          {workspace.isLoading ? (
            <div className="root-message">正在读取…</div>
          ) : workspace.error ? (
            <button
              className="root-message root-error"
              onClick={() => onRetryRoot(root.rootPath)}
              title={workspace.error}
              type="button"
            >
              <RotateCw />
              <span>无法读取，点击重试</span>
            </button>
          ) : visibleEntries.length || createState ? (
            <ul>
              {createState ? (
                <li>
                  <InlineNameEditor
                    extension={createState.kind === "markdown" ? ".md" : ""}
                    entryKind={createState.kind}
                    indentation={32}
                    initialValue={
                      createState.kind === "markdown" ? "未命名" : "未命名文件夹"
                    }
                    onCancel={onCancelEditing}
                    onSubmit={(name) =>
                      createState.kind === "markdown"
                        ? onCreateFile(root.rootPath, root.rootPath, name)
                        : onCreateDirectory(root.rootPath, root.rootPath, name)
                    }
                  />
                </li>
              ) : null}
              {visibleEntries.map((entry) => (
                <TreeEntry
                  activePath={activePath}
                  collapsedPaths={collapsedPaths}
                  editing={editing}
                  entry={entry}
                  forceExpanded={isFiltering}
                  key={entry.path}
                  level={0}
                  onCancelEditing={onCancelEditing}
                  onCreateFile={onCreateFile}
                  onCreateDirectory={onCreateDirectory}
                  onOpenContextMenu={onOpenEntryContextMenu}
                  onRenameFile={onRenameFile}
                  onSelectEntry={onSelectEntry}
                  onToggle={onTogglePath}
                  rootPath={root.rootPath}
                />
              ))}
            </ul>
          ) : (
            <div className="root-message">
              {isFiltering
                ? "没有匹配的文件或文件夹"
                : "没有可显示的文件或文件夹"}
            </div>
          )}
          {workspace.isTruncated ? (
            <div className="root-message">文件较多，仅显示前 20,000 项</div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function WorkspaceSidebar({
  roots,
  activePath,
  canManageFiles,
  onOpenFile,
  onOpenFolder,
  onRefreshFiles,
  onRemoveRoot,
  onRetryRoot,
  onSelectEntry,
  onToggleRoot,
  onTogglePath,
  onExpandPath,
  onCreateFile,
  onCreateDirectory,
  onRenameFile,
  onDeleteFile,
}: WorkspaceSidebarProps) {
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [contextMenu, setContextMenu] = useState<
    | {
        position: { x: number; y: number };
        target:
          | { type: "root"; workspace: RootWorkspace }
          | { type: "entry"; entry: WorkspaceEntry; rootPath: string };
      }
    | null
  >(null);
  const isFiltering = Boolean(filterQuery.trim());
  const hasFilterMatches = roots.some(
    (workspace) =>
      filterWorkspaceEntries(workspace.entries ?? [], filterQuery).length > 0,
  );
  const isFilterLoading = roots.some((workspace) => workspace.isLoading);
  const hasFilterError = roots.some((workspace) => workspace.error);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const refreshFiles = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefreshFiles();
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, onRefreshFiles]);

  const openRootContextMenu = (
    event: MouseEvent,
    workspace: RootWorkspace,
  ) => {
    event.preventDefault();
    setContextMenu({
      position: { x: event.clientX, y: event.clientY },
      target: { type: "root", workspace },
    });
  };

  const openEntryContextMenu = (
    event: MouseEvent,
    entry: WorkspaceEntry,
    rootPath: string,
  ) => {
    event.preventDefault();
    setContextMenu({
      position: { x: event.clientX, y: event.clientY },
      target: { type: "entry", entry, rootPath },
    });
  };

  const startCreate = (
    rootPath: string,
    parentPath: string,
    kind: "markdown" | "directory",
  ) => {
    setFilterQuery("");
    const workspace = roots.find((item) => item.root.rootPath === rootPath);
    if (workspace && !workspace.isExpanded) onToggleRoot(workspace);
    if (parentPath !== rootPath) onExpandPath(rootPath, parentPath);
    setEditing({ mode: "create", rootPath, parentPath, kind });
  };

  const submitCreate = async (
    rootPath: string,
    parentPath: string,
    name: string,
    kind: "markdown" | "directory",
  ) => {
    const nextName =
      kind === "markdown" ? name.replace(/\.(?:md|markdown)$/i, "") : name;
    const didCreate =
      kind === "markdown"
        ? await onCreateFile(rootPath, parentPath, nextName)
        : await onCreateDirectory(rootPath, parentPath, nextName);
    if (didCreate) setEditing(null);
    return didCreate;
  };

  const submitRename = async (
    entry: WorkspaceEntry,
    rootPath: string,
    newStem: string,
  ) => {
    const didRename = await onRenameFile(entry, rootPath, newStem);
    if (didRename) setEditing(null);
    return didRename;
  };

  return (
    <aside className="workspace-sidebar" aria-label="文件根目录">
      <div className="sidebar-actions">
        <button
          aria-label="打开文件"
          className="icon-button"
          onClick={onOpenFile}
          title="打开 Markdown、图片或视频"
          type="button"
        >
          <FilePlus2 />
        </button>
        <button
          aria-label="打开文件夹"
          className="icon-button"
          onClick={onOpenFolder}
          title="打开文件夹"
          type="button"
        >
          <FolderOpen />
        </button>
        <button
          aria-label="刷新文件树"
          className="icon-button"
          disabled={!canManageFiles || roots.length === 0 || isRefreshing}
          onClick={() => void refreshFiles()}
          title="刷新文件树"
          type="button"
        >
          <RotateCw className={isRefreshing ? "is-spinning" : undefined} />
        </button>
      </div>

      {roots.length > 0 ? (
        <div className="sidebar-filter">
          <Search aria-hidden="true" />
          <input
            aria-label="筛选文件树"
            onChange={(event) => {
              const nextQuery = event.target.value;
              if (!filterQuery.trim() && nextQuery.trim() && canManageFiles) {
                void refreshFiles();
              }
              setFilterQuery(nextQuery);
            }}
            placeholder="筛选文件名"
            type="search"
            value={filterQuery}
          />
          {filterQuery ? (
            <button
              aria-label="清除筛选"
              onClick={() => setFilterQuery("")}
              title="清除筛选"
              type="button"
            >
              <X />
            </button>
          ) : null}
        </div>
      ) : null}

      {roots.length > 0 ? (
        <nav className="workspace-tree" aria-label="已打开的根目录">
          <ul className="root-list">
            {roots.map((workspace) => (
              <RootEntry
                activePath={activePath}
                editing={
                  editing?.rootPath === workspace.root.rootPath ? editing : null
                }
                filterQuery={filterQuery}
                key={workspace.root.rootPath}
                onCancelEditing={() => setEditing(null)}
                onCreateFile={(rootPath, parentPath, name) =>
                  submitCreate(rootPath, parentPath, name, "markdown")
                }
                onCreateDirectory={(rootPath, parentPath, name) =>
                  submitCreate(rootPath, parentPath, name, "directory")}
                onOpenEntryContextMenu={openEntryContextMenu}
                onOpenRootContextMenu={openRootContextMenu}
                onRenameFile={submitRename}
                onRetryRoot={onRetryRoot}
                onSelectEntry={onSelectEntry}
                onTogglePath={onTogglePath}
                onToggleRoot={onToggleRoot}
                workspace={workspace}
              />
            ))}
          </ul>
          {isFiltering &&
          !hasFilterMatches &&
          !isFilterLoading &&
          !hasFilterError ? (
            <div className="root-message sidebar-filter-empty">
              没有匹配的文件或文件夹
            </div>
          ) : null}
        </nav>
      ) : (
        <div className="sidebar-empty">
          <p>选择一个文件或文件夹</p>
          <span>打开过的文件夹会保留在这里</span>
        </div>
      )}

      {contextMenu ? (
        <ContextMenu
          items={(() => {
            const target = contextMenu.target;
            if (target.type === "root") {
              const items: ContextMenuItem[] = [];
              if (canManageFiles) {
                items.push({
                  icon: <FilePlus2 />,
                  label: "新建 Markdown",
                  onSelect: () =>
                    startCreate(
                      target.workspace.root.rootPath,
                      target.workspace.root.rootPath,
                      "markdown",
                    ),
                });
                items.push({
                  icon: <FolderPlus />,
                  label: "新建文件夹",
                  onSelect: () =>
                    startCreate(
                      target.workspace.root.rootPath,
                      target.workspace.root.rootPath,
                      "directory",
                    ),
                });
              }
              items.push({
                icon: <Copy />,
                label: "复制路径",
                onSelect: () => copyPlainText(target.workspace.root.rootPath),
              });
              if (canManageFiles) {
                items.push({
                  icon: <X />,
                  label: "从列表移除",
                  onSelect: () => onRemoveRoot(target.workspace.root.rootPath),
                  separatorBefore: true,
                });
              }
              return items;
            }

            const { entry, rootPath } = target;
            const items: ContextMenuItem[] = [];
            if (canManageFiles && entry.kind === "directory") {
              items.push({
                icon: <FilePlus2 />,
                label: "新建 Markdown",
                onSelect: () => startCreate(rootPath, entry.path, "markdown"),
              });
              items.push({
                icon: <FolderPlus />,
                label: "新建文件夹",
                onSelect: () => startCreate(rootPath, entry.path, "directory"),
              });
            }
            if (canManageFiles) {
              items.push({
                icon: <Pencil />,
                label: "重命名",
                onSelect: () =>
                  setEditing({ mode: "rename", rootPath, entry }),
              });
            }
            items.push({
              icon: <Copy />,
              label: "复制路径",
              onSelect: () => copyPlainText(entry.path),
            });
            if (canManageFiles) {
              items.push({
                danger: true,
                icon: <Trash2 />,
                label: "移到废纸篓",
                onSelect: async () => {
                  await onDeleteFile(entry, rootPath);
                },
                separatorBefore: true,
              });
            }
            return items;
          })()}
          label="文件操作"
          onClose={closeContextMenu}
          position={contextMenu.position}
        />
      ) : null}
    </aside>
  );
}
