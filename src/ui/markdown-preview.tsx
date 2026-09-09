import { openUrl } from "@tauri-apps/plugin-opener";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
} from "react";
import type { DocumentSnapshot } from "../core/document";
import { documentGateway } from "../infrastructure/tauri/document-gateway";
import { isTauriRuntime } from "../infrastructure/tauri/runtime";
import { markdownRenderer } from "../services/markdown-renderer";
import {
  rangeBetweenBoundaries,
  selectionBoundaryFromPoint,
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

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  document,
  workspaceRoot,
  onTextSelection,
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionGestureRef = useRef<{
    start: SelectionBoundary;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const selectionUpdateFrameRef = useRef<number | null>(null);
  const selectionReportFrameRef = useRef<number | null>(null);
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
    if (selectionGestureRef.current) return;
    if (selectionReportFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionReportFrameRef.current);
    }
    selectionReportFrameRef.current = window.requestAnimationFrame(() => {
      selectionReportFrameRef.current = null;
      if (selectionGestureRef.current) return;
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
    if (
      event.button !== 0 ||
      event.detail !== 1 ||
      (event.target as Element).closest("a[href]")
    ) {
      return;
    }
    const root = containerRef.current;
    if (!root) return;
    const start = selectionBoundaryFromPoint(
      window.document,
      root,
      window.document.elementFromPoint(event.clientX, event.clientY) ??
        event.target,
      event.clientX,
      event.clientY,
    );
    if (!start) return;

    event.preventDefault();
    if (selectionReportFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionReportFrameRef.current);
      selectionReportFrameRef.current = null;
    }
    window.getSelection()?.removeAllRanges();
    selectionGestureRef.current = {
      start,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    onTextSelection?.(null);
  };

  const updateMouseSelection = useCallback((x: number, y: number) => {
    const gesture = selectionGestureRef.current;
    const root = containerRef.current;
    if (!gesture || !root) return;
    const target = window.document.elementFromPoint(x, y);
    const end = selectionBoundaryFromPoint(
      window.document,
      root,
      target,
      x,
      y,
    );
    if (!end) return;
    const range = rangeBetweenBoundaries(window.document, gesture.start, end);
    const selection = window.getSelection();
    if (!range || !selection || range.collapsed) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const gesture = selectionGestureRef.current;
      if (!gesture) return;
      event.preventDefault();
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      if (
        Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) <=
        3
      ) {
        return;
      }
      if (selectionUpdateFrameRef.current !== null) return;
      selectionUpdateFrameRef.current = window.requestAnimationFrame(() => {
        selectionUpdateFrameRef.current = null;
        const current = selectionGestureRef.current;
        if (current) updateMouseSelection(current.lastX, current.lastY);
      });
    };

    const finishMouseSelection = (event?: globalThis.MouseEvent) => {
      const gesture = selectionGestureRef.current;
      if (!gesture) return;
      if (event) {
        event.preventDefault();
        gesture.lastX = event.clientX;
        gesture.lastY = event.clientY;
      }
      if (selectionUpdateFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionUpdateFrameRef.current);
        selectionUpdateFrameRef.current = null;
      }
      if (
        Math.hypot(gesture.lastX - gesture.startX, gesture.lastY - gesture.startY) >
        3
      ) {
        updateMouseSelection(gesture.lastX, gesture.lastY);
      }
      selectionGestureRef.current = null;
      reportSelection();
    };
    const handleBlur = () => finishMouseSelection();

    window.document.addEventListener("selectionchange", reportSelection);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", finishMouseSelection);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.document.removeEventListener("selectionchange", reportSelection);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finishMouseSelection);
      window.removeEventListener("blur", handleBlur);
      if (selectionUpdateFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionUpdateFrameRef.current);
      }
      if (selectionReportFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionReportFrameRef.current);
      }
    };
  }, [reportSelection, updateMouseSelection]);

  return (
    <div
      className="preview-scroll"
      onClick={handleClick}
      onKeyUp={reportSelection}
      onMouseDown={handleMouseDown}
      onScroll={() => onTextSelection?.(null)}
    >
      <article
        className="markdown-body"
        ref={containerRef}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    </div>
  );
});
