import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, type MouseEvent } from "react";
import type { DocumentSnapshot } from "../core/document";
import { documentGateway } from "../infrastructure/tauri/document-gateway";
import { isTauriRuntime } from "../infrastructure/tauri/runtime";
import { markdownRenderer } from "../services/markdown-renderer";
import {
  caretBoundaryFromPoint,
  rangeBetweenBoundaries,
  trimRangeWhitespace,
  type SelectionBoundary,
} from "./preview-selection";
import type { TextSelection } from "./selection-toolbar";

interface MarkdownPreviewProps {
  content: string;
  document: DocumentSnapshot | null;
  workspaceRoot: string | null;
  onTextSelection?: (selection: TextSelection | null) => void;
}

export function MarkdownPreview({
  content,
  document,
  workspaceRoot,
  onTextSelection,
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionGestureRef = useRef<{
    boundary: SelectionBoundary;
    x: number;
    y: number;
  } | null>(null);
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

  const reportSelection = useCallback(() => {
    window.requestAnimationFrame(() => {
      if (window.document.activeElement?.closest(".selection-toolbar")) return;
      const selection = window.getSelection();
      const anchorNode = selection?.anchorNode;
      const focusNode = selection?.focusNode;
      if (
        !selection ||
        selection.isCollapsed ||
        !anchorNode ||
        !focusNode ||
        !containerRef.current?.contains(anchorNode) ||
        !containerRef.current.contains(focusNode)
      ) {
        onTextSelection?.(null);
        return;
      }

      const originalRange = selection.getRangeAt(0);
      const range = trimRangeWhitespace(originalRange, containerRef.current);
      const text = range.toString();
      if (text !== originalRange.toString()) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      const rect = Array.from(range.getClientRects()).find(
        (item) => item.width > 0 && item.height > 0,
      );
      if (!text || !rect) {
        onTextSelection?.(null);
        return;
      }
      onTextSelection?.({
        text,
        anchor: {
          x: rect.left + rect.width / 2,
          top: rect.top,
          bottom: rect.bottom,
        },
      });
    });
  }, [onTextSelection]);

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.detail !== 1) {
      selectionGestureRef.current = null;
      return;
    }
    const boundary = caretBoundaryFromPoint(
      window.document,
      event.clientX,
      event.clientY,
    );
    if (!boundary || !containerRef.current?.contains(boundary.node)) {
      selectionGestureRef.current = null;
      return;
    }
    selectionGestureRef.current = {
      boundary,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    const gesture = selectionGestureRef.current;
    selectionGestureRef.current = null;
    if (
      gesture &&
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 3
    ) {
      const boundary = caretBoundaryFromPoint(
        window.document,
        event.clientX,
        event.clientY,
      );
      if (boundary && containerRef.current?.contains(boundary.node)) {
        const range = rangeBetweenBoundaries(
          window.document,
          gesture.boundary,
          boundary,
        );
        const selection = window.getSelection();
        if (range && selection && !range.collapsed) {
          const trimmed = trimRangeWhitespace(range, containerRef.current);
          selection.removeAllRanges();
          selection.addRange(trimmed);
        }
      }
    }
    reportSelection();
  };

  useEffect(() => {
    window.document.addEventListener("selectionchange", reportSelection);
    return () =>
      window.document.removeEventListener("selectionchange", reportSelection);
  }, [reportSelection]);

  return (
    <div
      className="preview-scroll"
      onClick={handleClick}
      onKeyUp={reportSelection}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onScroll={() => onTextSelection?.(null)}
    >
      <article
        className="markdown-body"
        ref={containerRef}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    </div>
  );
}
