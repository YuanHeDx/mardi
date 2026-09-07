import { getDocumentStats } from "../core/document";
import type { MediaKind } from "../core/workspace";

interface StatusBarProps {
  content: string;
  isSaving: boolean;
  kind: "markdown" | MediaKind | null;
}

export function StatusBar({ content, isSaving, kind }: StatusBarProps) {
  const stats = getDocumentStats(content);
  const label =
    kind === "markdown"
      ? "Markdown"
      : kind === "image"
        ? "Image"
        : kind === "video"
          ? "Video"
          : "mardi";

  return (
    <footer className="status-bar">
      <div>
        {kind === "markdown" || kind === null ? (
          <>
            <span>{stats.words} words</span>
            <span>{stats.lines} lines</span>
          </>
        ) : null}
      </div>
      <span>{isSaving ? "Saving…" : label}</span>
    </footer>
  );
}
