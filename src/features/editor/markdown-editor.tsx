import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { TextSelection } from "../../ui/selection-toolbar";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onTextSelection?: (selection: TextSelection | null) => void;
}

const mardiEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--document-background)",
    color: "var(--text-primary)",
    fontSize: "16px",
  },
  ".cm-scroller": {
    fontFamily:
      'ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
    lineHeight: "1.75",
    padding: "72px max(32px, calc((100% - 760px) / 2)) 96px",
  },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-line": { padding: "0" },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "var(--editor-active-line)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--selection) !important",
  },
  "&.cm-focused": { outline: "none" },
});

export function MarkdownEditor({
  value,
  onChange,
  onTextSelection,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onTextSelectionRef = useRef(onTextSelection);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onTextSelectionRef.current = onTextSelection;
  }, [onTextSelection]);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          markdown(),
          EditorView.lineWrapping,
          mardiEditorTheme,
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (update.selectionSet) {
              const range = update.state.selection.main;
              if (range.empty) {
                onTextSelectionRef.current?.(null);
                return;
              }
              const start = update.view.coordsAtPos(range.from);
              if (!start) return;
              onTextSelectionRef.current?.({
                text: update.state.sliceDoc(range.from, range.to),
                anchor: {
                  x: start.left,
                  top: start.top,
                  bottom: start.bottom,
                },
              });
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return <div className="markdown-editor" ref={containerRef} />;
}
