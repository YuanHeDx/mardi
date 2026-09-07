import { BookOpen, PanelLeft, PencilLine } from "lucide-react";
import type { DocumentMode } from "../core/document";

interface TitleBarProps {
  title: string;
  dirty: boolean;
  mode: DocumentMode;
  canEdit: boolean;
  sidebarVisible: boolean;
  onModeChange: (mode: DocumentMode) => void;
  onToggleSidebar: () => void;
}

export function TitleBar({
  title,
  dirty,
  mode,
  canEdit,
  sidebarVisible,
  onModeChange,
  onToggleSidebar,
}: TitleBarProps) {
  return (
    <header className="title-bar" data-tauri-drag-region="deep">
      <div className="title-bar-left" data-tauri-drag-region>
        <span className="traffic-light-spacer" data-tauri-drag-region />
        <button
          aria-label={sidebarVisible ? "隐藏文件树" : "显示文件树"}
          aria-pressed={sidebarVisible}
          className="icon-button"
          onClick={onToggleSidebar}
          title={sidebarVisible ? "隐藏文件树" : "显示文件树"}
          type="button"
        >
          <PanelLeft />
        </button>
      </div>

      <div className="window-title" data-tauri-drag-region>
        <span>{title}</span>
        {dirty && <span className="dirty-indicator" aria-label="尚未保存" />}
      </div>

      <div className="title-bar-actions" data-tauri-drag-region>
        <button
          aria-label={mode === "preview" ? "编辑 Markdown" : "阅读 Markdown"}
          aria-pressed={mode === "edit"}
          className="icon-button"
          disabled={!canEdit}
          onClick={() => onModeChange(mode === "preview" ? "edit" : "preview")}
          title={mode === "preview" ? "编辑 Markdown" : "返回阅读"}
          type="button"
        >
          {mode === "preview" ? <PencilLine /> : <BookOpen />}
        </button>
      </div>
    </header>
  );
}
