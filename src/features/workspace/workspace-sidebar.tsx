import {
  ChevronDown,
  ChevronRight,
  FileImage,
  FilePlus2,
  FileText,
  Film,
  Folder,
  FolderOpen,
  RotateCw,
  X,
} from "lucide-react";
import { useState } from "react";
import type { RootWorkspace, WorkspaceEntry } from "../../core/workspace";

interface WorkspaceSidebarProps {
  roots: RootWorkspace[];
  activePath: string | null;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onRemoveRoot: (rootPath: string) => void;
  onRetryRoot: (rootPath: string) => void;
  onSelectEntry: (entry: WorkspaceEntry, rootPath: string) => void;
  onToggleRoot: (workspace: RootWorkspace) => void;
}

interface TreeEntryProps {
  entry: WorkspaceEntry;
  rootPath: string;
  activePath: string | null;
  level: number;
  collapsedPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelectEntry: (entry: WorkspaceEntry, rootPath: string) => void;
}

function FileIcon({ entry }: { entry: WorkspaceEntry }) {
  if (entry.kind === "image") return <FileImage className="tree-main-icon" />;
  if (entry.kind === "video") return <Film className="tree-main-icon" />;
  return <FileText className="tree-main-icon" />;
}

function TreeEntry({
  entry,
  rootPath,
  activePath,
  level,
  collapsedPaths,
  onToggle,
  onSelectEntry,
}: TreeEntryProps) {
  const isCollapsed = collapsedPaths.has(entry.path);
  const indentation = 14 + level * 16;

  if (entry.kind === "directory") {
    return (
      <li>
        <button
          className="tree-row"
          style={{ paddingLeft: indentation }}
          onClick={() => onToggle(entry.path)}
          title={entry.path}
          type="button"
        >
          {isCollapsed ? <ChevronRight /> : <ChevronDown />}
          <Folder className="tree-main-icon" />
          <span>{entry.name}</span>
        </button>
        {!isCollapsed ? (
          <ul>
            {entry.children.map((child) => (
              <TreeEntry
                activePath={activePath}
                collapsedPaths={collapsedPaths}
                entry={child}
                key={child.path}
                level={level + 1}
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
    </li>
  );
}

interface RootEntryProps {
  workspace: RootWorkspace;
  activePath: string | null;
  collapsedPaths: Set<string>;
  onRemoveRoot: (rootPath: string) => void;
  onRetryRoot: (rootPath: string) => void;
  onSelectEntry: (entry: WorkspaceEntry, rootPath: string) => void;
  onTogglePath: (path: string) => void;
  onToggleRoot: (workspace: RootWorkspace) => void;
}

function RootEntry({
  workspace,
  activePath,
  collapsedPaths,
  onRemoveRoot,
  onRetryRoot,
  onSelectEntry,
  onTogglePath,
  onToggleRoot,
}: RootEntryProps) {
  const { root } = workspace;

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
        <button
          aria-label={`从列表移除 ${root.name}`}
          className="root-remove"
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
          ) : workspace.entries?.length ? (
            <ul>
              {workspace.entries.map((entry) => (
                <TreeEntry
                  activePath={activePath}
                  collapsedPaths={collapsedPaths}
                  entry={entry}
                  key={entry.path}
                  level={0}
                  onSelectEntry={onSelectEntry}
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
  onOpenFile,
  onOpenFolder,
  onRemoveRoot,
  onRetryRoot,
  onSelectEntry,
  onToggleRoot,
}: WorkspaceSidebarProps) {
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());

  const togglePath = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
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
                collapsedPaths={collapsedPaths}
                key={workspace.root.rootPath}
                onRemoveRoot={onRemoveRoot}
                onRetryRoot={onRetryRoot}
                onSelectEntry={onSelectEntry}
                onTogglePath={togglePath}
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
