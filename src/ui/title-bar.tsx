import { PanelLeft } from "lucide-react";

interface TitleBarProps {
  title: string;
  dirty: boolean;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
}

export function TitleBar({
  title,
  dirty,
  sidebarVisible,
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

      <div className="title-bar-actions" data-tauri-drag-region />
    </header>
  );
}
