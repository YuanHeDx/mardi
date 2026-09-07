import {
  ChevronDown,
  ChevronRight,
  FileImage,
  FilePlus2,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Pencil,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  fileNameParts,
  type RootWorkspace,
  type WorkspaceEntry,
} from "../../core/workspace";

interface WorkspaceSidebarProps {
  roots: RootWorkspace[];
  activePath: string | null;
  canManageFiles: boolean;
  onOpenFile: () => void;
  onOpenFolder: () => void;
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
    }
  | {
      mode: "rename";
      rootPath: string;
      entry: WorkspaceEntry;
    };

interface InlineNameEditorProps {
  indentation: number;
  initialValue: string;
  extension: string;
  onCancel: () => void;
  onSubmit: (value: string) => Promise<boolean>;
}

function InlineNameEditor({
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
      <FileText className="tree-main-icon" />
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
  canManageFiles: boolean;
  onCancelEditing: () => void;
  onStartCreate: (rootPath: string, parentPath: string) => void;
  onStartRename: (rootPath: string, entry: WorkspaceEntry) => void;
  onCreateFile: (
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
  onToggle: (rootPath: string, path: string) => void;
  onSelectEntry: (entry: WorkspaceEntry, rootPath: string) => void;
}

function TreeEntry({
  entry,
  rootPath,
  activePath,
  level,
  collapsedPaths,
  editing,
  canManageFiles,
  onCancelEditing,
  onStartCreate,
  onStartRename,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
  onToggle,
  onSelectEntry,
}: TreeEntryProps) {
  const isCollapsed = collapsedPaths.has(entry.path);
  const indentation = 14 + level * 16;
  const isCreatingHere =
    editing?.mode === "create" && editing.parentPath === entry.path;
  const isRenaming =
    editing?.mode === "rename" && editing.entry.path === entry.path;

  if (entry.kind === "directory") {
    return (
      <li>
        <div className="tree-row-shell">
          <button
            aria-expanded={!isCollapsed}
            className="tree-row"
            style={{ paddingLeft: indentation }}
            onClick={() => onToggle(rootPath, entry.path)}
            title={entry.path}
            type="button"
          >
            {isCollapsed ? <ChevronRight /> : <ChevronDown />}
            <Folder className="tree-main-icon" />
            <span>{entry.name}</span>
          </button>
          {canManageFiles ? (
            <div className="tree-row-actions">
              <button
                aria-label={`在 ${entry.name} 中新建 Markdown`}
                onClick={() => onStartCreate(rootPath, entry.path)}
                title="新建 Markdown"
                type="button"
              >
                <FilePlus2 />
              </button>
            </div>
          ) : null}
        </div>
        {!isCollapsed ? (
          <ul>
            {isCreatingHere ? (
              <li>
                <InlineNameEditor
                  extension=".md"
                  indentation={indentation + 34}
                  initialValue="未命名"
                  onCancel={onCancelEditing}
                  onSubmit={(name) =>
                    onCreateFile(rootPath, entry.path, name)
                  }
                />
              </li>
            ) : null}
            {entry.children.map((child) => (
              <TreeEntry
                activePath={activePath}
                canManageFiles={canManageFiles}
                collapsedPaths={collapsedPaths}
                editing={editing}
                entry={child}
                key={child.path}
                level={level + 1}
                onCancelEditing={onCancelEditing}
                onCreateFile={onCreateFile}
                onDeleteFile={onDeleteFile}
                onRenameFile={onRenameFile}
                onSelectEntry={onSelectEntry}
                onStartCreate={onStartCreate}
                onStartRename={onStartRename}
                onToggle={onToggle}
                rootPath={rootPath}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  if (isRenaming) {
    const { stem, extension } = fileNameParts(entry.name);
    return (
      <li>
        <InlineNameEditor
          extension={extension}
          indentation={indentation + 18}
          initialValue={stem}
          onCancel={onCancelEditing}
          onSubmit={(newStem) => onRenameFile(entry, rootPath, newStem)}
        />
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
          title={entry.path}
          type="button"
        >
          <FileIcon entry={entry} />
          <span>{entry.name}</span>
        </button>
        {canManageFiles ? (
          <div className="tree-row-actions">
            <button
              aria-label={`重命名 ${entry.name}`}
              onClick={() => onStartRename(rootPath, entry)}
              title="重命名"
              type="button"
            >
              <Pencil />
            </button>
            <button
              aria-label={`删除 ${entry.name}`}
              onClick={() => void onDeleteFile(entry, rootPath)}
              title="移到废纸篓"
              type="button"
            >
              <Trash2 />
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

interface RootEntryProps {
  workspace: RootWorkspace;
  activePath: string | null;
  editing: EditingState | null;
  canManageFiles: boolean;
  onCancelEditing: () => void;
  onStartCreate: (rootPath: string, parentPath: string) => void;
  onStartRename: (rootPath: string, entry: WorkspaceEntry) => void;
  onCreateFile: WorkspaceSidebarProps["onCreateFile"];
  onRenameFile: WorkspaceSidebarProps["onRenameFile"];
  onDeleteFile: WorkspaceSidebarProps["onDeleteFile"];
  onRemoveRoot: (rootPath: string) => void;
  onRetryRoot: (rootPath: string) => void;
  onSelectEntry: (entry: WorkspaceEntry, rootPath: string) => void;
  onTogglePath: (rootPath: string, path: string) => void;
  onToggleRoot: (workspace: RootWorkspace) => void;
}

function RootEntry({
  workspace,
  activePath,
  editing,
  canManageFiles,
  onCancelEditing,
  onStartCreate,
  onStartRename,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
  onRemoveRoot,
  onRetryRoot,
  onSelectEntry,
  onTogglePath,
  onToggleRoot,
}: RootEntryProps) {
  const { root } = workspace;
  const collapsedPaths = new Set(workspace.collapsedPaths);
  const isCreatingAtRoot =
    editing?.mode === "create" && editing.parentPath === root.rootPath;

  return (
    <li className="root-entry">
      <div className="root-row">
        <button
          aria-expanded={workspace.isExpanded}
          className="root-main"
          onClick={() => onToggleRoot(workspace)}
          title={root.rootPath}
          type="button"
        >
          {workspace.isExpanded ? <ChevronDown /> : <ChevronRight />}
          {workspace.isExpanded ? (
            <FolderOpen className="tree-main-icon" />
          ) : (
            <Folder className="tree-main-icon" />
          )}
          <span>{root.name}</span>
        </button>
        {canManageFiles ? (
          <button
            aria-label={`在 ${root.name} 中新建 Markdown`}
            className="root-action"
            onClick={() => onStartCreate(root.rootPath, root.rootPath)}
            title="新建 Markdown"
            type="button"
          >
            <FilePlus2 />
          </button>
        ) : null}
        <button
          aria-label={`从列表移除 ${root.name}`}
          className="root-action"
          onClick={() => onRemoveRoot(root.rootPath)}
          title="仅从列表移除，不会删除文件"
          type="button"
        >
          <X />
        </button>
      </div>

      {workspace.isExpanded ? (
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
          ) : workspace.entries?.length || isCreatingAtRoot ? (
            <ul>
              {isCreatingAtRoot ? (
                <li>
                  <InlineNameEditor
                    extension=".md"
                    indentation={32}
                    initialValue="未命名"
                    onCancel={onCancelEditing}
                    onSubmit={(name) =>
                      onCreateFile(root.rootPath, root.rootPath, name)
                    }
                  />
                </li>
              ) : null}
              {workspace.entries?.map((entry) => (
                <TreeEntry
                  activePath={activePath}
                  canManageFiles={canManageFiles}
                  collapsedPaths={collapsedPaths}
                  editing={editing}
                  entry={entry}
                  key={entry.path}
                  level={0}
                  onCancelEditing={onCancelEditing}
                  onCreateFile={onCreateFile}
                  onDeleteFile={onDeleteFile}
                  onRenameFile={onRenameFile}
                  onSelectEntry={onSelectEntry}
                  onStartCreate={onStartCreate}
                  onStartRename={onStartRename}
                  onToggle={onTogglePath}
                  rootPath={root.rootPath}
                />
              ))}
            </ul>
          ) : (
            <div className="root-message">没有可预览的文件</div>
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
  onRemoveRoot,
  onRetryRoot,
  onSelectEntry,
  onToggleRoot,
  onTogglePath,
  onExpandPath,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
}: WorkspaceSidebarProps) {
  const [editing, setEditing] = useState<EditingState | null>(null);

  const startCreate = (rootPath: string, parentPath: string) => {
    const workspace = roots.find((item) => item.root.rootPath === rootPath);
    if (workspace && !workspace.isExpanded) onToggleRoot(workspace);
    if (parentPath !== rootPath) onExpandPath(rootPath, parentPath);
    setEditing({ mode: "create", rootPath, parentPath });
  };

  const submitCreate = async (
    rootPath: string,
    parentPath: string,
    name: string,
  ) => {
    const stem = name.replace(/\.(?:md|markdown)$/i, "");
    const didCreate = await onCreateFile(rootPath, parentPath, stem);
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
      </div>

      {roots.length > 0 ? (
        <nav className="workspace-tree" aria-label="已打开的根目录">
          <ul className="root-list">
            {roots.map((workspace) => (
              <RootEntry
                activePath={activePath}
                canManageFiles={canManageFiles}
                editing={
                  editing?.rootPath === workspace.root.rootPath ? editing : null
                }
                key={workspace.root.rootPath}
                onCancelEditing={() => setEditing(null)}
                onCreateFile={submitCreate}
                onDeleteFile={onDeleteFile}
                onRemoveRoot={onRemoveRoot}
                onRenameFile={submitRename}
                onRetryRoot={onRetryRoot}
                onSelectEntry={onSelectEntry}
                onStartCreate={startCreate}
                onStartRename={(rootPath, entry) =>
                  setEditing({ mode: "rename", rootPath, entry })
                }
                onTogglePath={onTogglePath}
                onToggleRoot={onToggleRoot}
                workspace={workspace}
              />
            ))}
          </ul>
        </nav>
      ) : (
        <div className="sidebar-empty">
          <p>选择一个文件或文件夹</p>
          <span>打开过的文件夹会保留在这里</span>
        </div>
      )}
    </aside>
  );
}
