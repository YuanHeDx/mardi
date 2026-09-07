import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import type { DocumentSnapshot } from "../core/document";
import { documentGateway } from "../infrastructure/tauri/document-gateway";
import { isTauriRuntime } from "../infrastructure/tauri/runtime";
import { markdownRenderer } from "../services/markdown-renderer";

interface MarkdownPreviewProps {
  content: string;
  document: DocumentSnapshot | null;
  workspaceRoot: string | null;
}

export function MarkdownPreview({
  content,
  document,
  workspaceRoot,
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendered = useMemo(() => markdownRenderer.render(content), [content]);

  useEffect(() => {
    if (!document || !isTauriRuntime() || !containerRef.current) return;
    let cancelled = false;

    const images = containerRef.current.querySelectorAll<HTMLImageElement>(
      "img[data-local-image]",
    );
    images.forEach((image) => {
      const source = image.dataset.localImage;
      if (!source) return;

      void documentGateway
        .readLocalImage(document.path, source, workspaceRoot)
        .then((dataUrl) => {
          if (!cancelled) image.src = dataUrl;
        })
        .catch(() => {
          if (!cancelled) image.classList.add("local-image-error");
        });
    });

    return () => {
      cancelled = true;
    };
  }, [document, rendered.html, workspaceRoot]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link) return;

    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#")) return;

    event.preventDefault();
    if (/^https?:\/\//i.test(href)) {
      if (isTauriRuntime()) void openUrl(href);
      else window.open(href, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="preview-scroll" onClick={handleClick}>
      <article
        className="markdown-body"
        ref={containerRef}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    </div>
  );
}
