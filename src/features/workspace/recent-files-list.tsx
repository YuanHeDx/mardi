import { Clock3, FileImage, FileText, Film, RotateCw, X } from "lucide-react";
import type { RecentFile } from "../../core/recent-files";

interface RecentFilesListProps {
  files: RecentFile[];
  activePath: string | null;
  loading: boolean;
  error: string | null;
  onOpen: (file: RecentFile) => void;
  onRemove: (path: string) => void;
  onRetry: () => void;
}

function parentLabel(path: string) {
  const parts = path.replace(/[\\/][^\\/]*$/, "").split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return "/";
  return `${parts.length > 2 ? "…/" : ""}${parts.slice(-2).join("/")}`;
}

export function RecentFilesList({ files, activePath, loading, error, onOpen, onRemove, onRetry }: RecentFilesListProps) {
  return (
    <>
      <h2 className="sidebar-section-heading"><Clock3 aria-hidden="true" />最近</h2>
      {error ? (
        <div className="recent-files-error" role="status">
          <span title={error}>最近记录暂时无法更新</span>
          <button aria-label="重试读取最近记录" className="icon-button" onClick={onRetry} title={error} type="button"><RotateCw /></button>
        </div>
      ) : null}
      <nav aria-label="最近打开的文件" aria-busy={loading} className="recent-files-scroll">
        {files.length > 0 ? (
          <ul className="recent-files-list">
            {files.map((file) => {
              const Icon = file.kind === "image" ? FileImage : file.kind === "video" ? Film : FileText;
              return (
                <li className={`recent-file-row${activePath === file.path ? " is-active" : ""}`} key={file.path}>
                  <button
                    aria-current={activePath === file.path ? "page" : undefined}
                    className="recent-file-open"
                    onClick={() => onOpen(file)}
                    title={file.path}
                    type="button"
                  >
                    <Icon aria-hidden="true" className="tree-main-icon" />
                    <span className="recent-file-label"><span className="recent-file-name">{file.name}</span><span className="recent-file-parent">{parentLabel(file.path)}</span></span>
                  </button>
                  <button aria-label={`从最近移除 ${file.name}`} className="recent-file-remove" onClick={() => onRemove(file.path)} title="从最近移除" type="button"><X /></button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="recent-files-empty">{loading ? "正在读取最近记录…" : "打开过的文件会显示在这里"}</div>
        )}
      </nav>
    </>
  );
}
