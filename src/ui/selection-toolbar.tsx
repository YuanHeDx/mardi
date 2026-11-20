import { Check, MessageSquareText, Quote, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  buildAnnotationPrompt,
  buildReferencePrompt,
} from "../core/selection-prompt";
import { copyPlainText } from "../infrastructure/clipboard";

export interface TextSelection {
  text: string;
  restoreFocus?: () => void;
  anchor: {
    x: number;
    top: number;
    bottom: number;
  };
}

interface SelectionToolbarProps {
  filePath: string;
  selection: TextSelection;
  onDismiss: () => void;
  onCopyFeedback: (message: string) => void;
}

export function SelectionToolbar({
  filePath,
  selection,
  onDismiss,
  onCopyFeedback,
}: SelectionToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"actions" | "annotation">("actions");
  const [annotation, setAnnotation] = useState("");
  const width = mode === "annotation" ? 360 : 164;
  const estimatedHeight = mode === "annotation" ? 120 : 42;
  const left = Math.max(
    width / 2 + 8,
    Math.min(selection.anchor.x, window.innerWidth - width / 2 - 8),
  );
  const placeBelow = selection.anchor.top < estimatedHeight + 10;
  const top = placeBelow
    ? selection.anchor.bottom + 8
    : selection.anchor.top - 8;

  useEffect(() => {
    setMode("actions");
    setAnnotation("");
  }, [filePath, selection.text, selection.anchor.x, selection.anchor.top]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) onDismiss();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onDismiss(); selection.restoreFocus?.(); }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDismiss, selection]);

  const copyPrompt = async (action: "引用" | "批注", prompt: string) => {
    try {
      await copyPlainText(prompt);
      onCopyFeedback(`${action}已复制到剪贴板，可以粘贴给你的AI`);
      return true;
    } catch {
      onCopyFeedback("复制失败，请重试");
      return false;
    }
  };

  return (
    <div
      aria-label="文本选区操作"
      className={`selection-toolbar ${placeBelow ? "is-below" : ""}`}
      ref={toolbarRef}
      role="toolbar"
      style={{ left, top, width }}
    >
      {mode === "actions" ? (
        <>
          <button
            onClick={() =>
              void copyPrompt(
                "引用",
                buildReferencePrompt({
                  filePath,
                  selectedText: selection.text,
                }),
              )
            }
            type="button"
          >
            <Quote />
            引用
          </button>
          <button onClick={() => setMode("annotation")} type="button">
            <MessageSquareText />
            批注
          </button>
        </>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!annotation.trim()) return;
            const form = event.currentTarget;
            const copied = await copyPrompt(
              "批注",
              buildAnnotationPrompt({
                annotation: annotation.trim(),
                filePath,
                selectedText: selection.text,
              }),
            );
            if (copied && form.isConnected) {
              onDismiss();
              selection.restoreFocus?.();
            }
          }}
        >
          <div className="selection-annotation-header">
            <span>添加批注</span>
            <button aria-label="关闭批注" onClick={() => { onDismiss(); selection.restoreFocus?.(); }} type="button">
              <X />
            </button>
          </div>
          <div className="selection-annotation-input">
            <textarea
              aria-label="批注内容"
              autoFocus
              onChange={(event) => setAnnotation(event.target.value)}
              placeholder="输入要交给 AI 的要求…"
              rows={2}
              value={annotation}
            />
            <button
              aria-label="复制批注"
              disabled={!annotation.trim()}
              title="复制到剪贴板"
              type="submit"
            >
              <Check />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
