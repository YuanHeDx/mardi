import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { bracketMatching, indentOnInput, LanguageDescription, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, highlightSpecialChars, keymap, placeholder } from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLayoutEffect, useRef } from "react";
import { isTauriRuntime } from "../../infrastructure/tauri/runtime";
import type { TextSelection } from "../../ui/selection-toolbar";
import type { MarkdownEditorController } from "./editor-controller";
import { mardiEditorTheme, mardiHighlightStyle } from "./editor-theme";
import { livePreview, previewComposition, previewFocus, resourceContext, updateResourceContext } from "./live-preview";

interface MarkdownEditorProps {
  value: string;
  loadGeneration: number;
  externalRevision: number;
  documentPath: string;
  workspaceRoot: string | null;
  onChange: (value: string, generation: number) => void;
  onCompositionChange: (composing: boolean, generation: number) => void;
  onController: (controller: MarkdownEditorController | null) => void;
  onTextSelection?: (selection: TextSelection | null) => void;
}

const codeLanguages = [
  LanguageDescription.of({ name: "JavaScript", alias: ["js", "jsx"], load: () => import("@codemirror/lang-javascript").then((module) => module.javascript({ jsx: true })) }),
  LanguageDescription.of({ name: "TypeScript", alias: ["ts", "tsx"], load: () => import("@codemirror/lang-javascript").then((module) => module.javascript({ typescript: true, jsx: true })) }),
  LanguageDescription.of({ name: "JSON", alias: ["jsonc"], load: () => import("@codemirror/lang-javascript").then((module) => module.javascript()) }),
  LanguageDescription.of({ name: "CSS", load: () => import("@codemirror/lang-css").then((module) => module.css()) }),
  LanguageDescription.of({ name: "HTML", alias: ["xml"], load: () => import("@codemirror/lang-html").then((module) => module.html()) }),
];

export function sourceLineSeparator(source: string) {
  return source.match(/\r\n|\r|\n/)?.[0] ?? "\n";
}

function targetAt(view: EditorView, x: number, y: number, target: EventTarget | null) {
  const marked = target instanceof Element ? target.closest<HTMLElement>("[data-link-target]")?.dataset.linkTarget : undefined;
  if (marked) return marked;
  const pos = view.posAtCoords({ x, y });
  if (pos === null) return null;
  for (let node = syntaxTree(view.state).resolveInner(pos, -1); node.parent; node = node.parent) {
    if (node.name === "Image") return null;
    if (node.name === "Link" || node.name === "Autolink") {
      const url = node.getChild("URL");
      return url ? view.state.sliceDoc(url.from, url.to) : null;
    }
    if (node.name === "URL") return view.state.sliceDoc(node.from, node.to);
  }
  return null;
}

function openLink(view: EditorView, target: string) {
  if (/^https?:\/\//i.test(target)) {
    if (isTauriRuntime()) void openUrl(target).catch(() => undefined);
    else window.open(target, "_blank", "noopener,noreferrer");
  } else if (target.startsWith("#")) {
    let requested: string;
    try { requested = decodeURIComponent(target.slice(1)).toLowerCase(); } catch { return; }
    syntaxTree(view.state).iterate({ enter(node) {
      if (!/^ATXHeading[1-6]$/.test(node.name)) return;
      const slug = view.state.sliceDoc(node.from, node.to).replace(/^#{1,6}\s+|\s+#+$/g, "").replace(/[\p{P}\p{S}]/gu, "").trim().toLowerCase().replace(/\s+/g, "-");
      if (slug === requested) {
        view.dispatch({ selection: { anchor: node.from }, effects: EditorView.scrollIntoView(node.from, { y: "start" }) });
        view.focus();
        return false;
      }
    } });
  }
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  const identityRef = useRef({ generation: props.loadGeneration, revision: props.externalRevision });
  const makeStateRef = useRef<(value: string, generation: number, selection?: EditorSelection) => EditorState>(() => { throw new Error("Editor not mounted"); });
  useLayoutEffect(() => { propsRef.current = props; });

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    let alive = true;
    let composing = false;
    let compositionToken = 0;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    let selectionTimer: ReturnType<typeof setTimeout> | undefined;
    let dragging = false;
    let pendingLink: { target: string; x: number; y: number } | null = null;
    let focusIntentVersion = 0;
    const compositionWaiters = new Set<(finished: boolean) => void>();
    const currentGeneration = () => identityRef.current.generation;
    const clearSelectionReport = () => {
      clearTimeout(selectionTimer);
      propsRef.current.onTextSelection?.(null);
    };
    const reportSelection = () => {
      clearTimeout(selectionTimer);
      if (dragging || composing) return;
      selectionTimer = setTimeout(() => {
        const view = viewRef.current;
        if (!view || !alive || dragging || composing || document.activeElement?.closest(".selection-toolbar")) return;
        const range = view.state.selection.main;
        const coords = range.empty ? null : view.coordsAtPos(range.from);
        if (!coords) { propsRef.current.onTextSelection?.(null); return; }
        const bounds = view.scrollDOM.getBoundingClientRect();
        if (coords.bottom < bounds.top || coords.top > bounds.bottom) { propsRef.current.onTextSelection?.(null); return; }
        propsRef.current.onTextSelection?.({
          text: view.state.sliceDoc(range.from, range.to),
          anchor: { x: coords.left, top: coords.top, bottom: coords.bottom },
          restoreFocus: () => { if (alive) view.focus(); },
        });
      }, 100);
    };
    const finishNativeComposition = (view: EditorView) => {
      const token = ++compositionToken;
      clearTimeout(completionTimer);
      // CM flushes MutationObserver records after compositionend and may clear
      // its composition view after 50ms. Settle after that documented event path.
      completionTimer = setTimeout(() => {
        if (!alive || token !== compositionToken || view.composing) return;
        propsRef.current.onChange(view.state.sliceDoc(), currentGeneration());
        composing = false;
        view.dispatch({ effects: previewComposition.of(false) });
        propsRef.current.onCompositionChange(false, currentGeneration());
        compositionWaiters.forEach((resolve) => resolve(true));
        compositionWaiters.clear();
        reportSelection();
      }, 60);
    };
    const events = EditorView.domEventHandlers({
      compositionstart(_event, view) {
        composing = true;
        ++compositionToken;
        clearTimeout(completionTimer);
        clearSelectionReport();
        propsRef.current.onCompositionChange(true, currentGeneration());
        view.dispatch({ effects: previewComposition.of(true) });
        return false;
      },
      compositionend(_event, view) { finishNativeComposition(view); return false; },
      focus(_event, view) {
        setTimeout(() => { if (alive) view.dispatch({ effects: previewFocus.of(true) }); }, 0);
        return false;
      },
      blur(_event, view) {
        setTimeout(() => {
          if (alive && !document.activeElement?.closest(".selection-toolbar")) view.dispatch({ effects: previewFocus.of(false) });
        }, 0);
        return false;
      },
      mousedown(event, view) {
        clearSelectionReport();
        if (event.button === 0 && (event.metaKey || event.ctrlKey)) {
          const target = targetAt(view, event.clientX, event.clientY, event.target);
          if (target) { pendingLink = { target, x: event.clientX, y: event.clientY }; event.preventDefault(); return true; }
        }
        dragging = true;
        return false;
      },
      keydown(event) {
        if (composing && (event.key === "Enter" || event.key === "Tab")) return false;
        if (event.key === "Escape") clearSelectionReport();
        return false;
      },
      scroll() { clearSelectionReport(); return false; },
    });
    const makeState = (value: string, generation: number, selection?: EditorSelection) => EditorState.create({
      doc: value,
      selection,
      extensions: [
        EditorState.lineSeparator.of(sourceLineSeparator(value)),
        // Native paste and text drop can use a different newline convention
        // than the file. Normalize only inserted text before CM's toText split.
        EditorView.clipboardInputFilter.of((text, state) => text.replace(/\r\n|\r|\n/g, state.lineBreak)),
        highlightSpecialChars(), history(), drawSelection(), dropCursor(), indentOnInput(), bracketMatching(),
        syntaxHighlighting(mardiHighlightStyle, { fallback: true }),
        markdown({ base: markdownLanguage, completeHTMLTags: false, pasteURLAsLink: false, codeLanguages }),
        EditorView.lineWrapping, mardiEditorTheme, placeholder("开始书写…"),
        EditorView.contentAttributes.of({ "aria-label": "Markdown 编辑器", "aria-multiline": "true", spellcheck: "false" }),
        resourceContext.of({ generation, documentPath: propsRef.current.documentPath, workspaceRoot: propsRef.current.workspaceRoot }),
        livePreview, events,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) propsRef.current.onChange(update.state.sliceDoc(), generation);
          if (update.selectionSet || update.docChanged) reportSelection();
        }),
      ],
    });
    makeStateRef.current = makeState;
    const view = new EditorView({ parent: containerRef.current, state: makeState(propsRef.current.value, propsRef.current.loadGeneration) });
    viewRef.current = view;
    const pointerUp = (event: MouseEvent) => {
      if (pendingLink) {
        if (Math.hypot(event.clientX - pendingLink.x, event.clientY - pendingLink.y) < 4) openLink(view, pendingLink.target);
        pendingLink = null;
      }
      dragging = false;
      reportSelection();
    };
    const trackFocusIntent = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node) || view.contentDOM.contains(target)) return;
      // Programmatic contentDOM.blur() naturally leaves body active. Only a
      // real outside focus target or subsequent outside pointer cancels return.
      if (event.type === "focusin" && (target === document.body || target === document.documentElement)) return;
      ++focusIntentVersion;
    };
    const loseWindowFocus = () => { ++focusIntentVersion; };
    document.addEventListener("focusin", trackFocusIntent, true);
    document.addEventListener("mousedown", trackFocusIntent, true);
    window.addEventListener("blur", loseWindowFocus);
    window.addEventListener("mouseup", pointerUp);
    propsRef.current.onController({
      focus: () => view.focus(),
      finishComposition: (options) => {
        // A leave request invalidates a manual save that was already waiting,
        // including a system-open action without an outside pointer event.
        if (!options?.restoreFocusIf) ++focusIntentVersion;
        if (!composing) return Promise.resolve(true);
        const hadFocus = view.hasFocus;
        const generation = currentGeneration();
        const revision = identityRef.current.revision;
        const intent = focusIntentVersion;
        return new Promise<boolean>((resolve) => {
          let resolved = false;
          const done = (result: boolean) => {
            if (resolved) return;
            resolved = true;
            compositionWaiters.delete(done);
            const active = document.activeElement;
            if (result && alive && hadFocus && generation === currentGeneration() && revision === identityRef.current.revision &&
              intent === focusIntentVersion && options?.restoreFocusIf?.() &&
              (active === document.body || active === document.documentElement || active === view.contentDOM)) {
              view.focus();
            }
            resolve(result);
          };
          compositionWaiters.add(done);
          view.contentDOM.blur();
          setTimeout(() => done(false), 250);
        });
      },
    });
    return () => {
      alive = false;
      clearTimeout(completionTimer);
      clearTimeout(selectionTimer);
      compositionWaiters.forEach((resolve) => resolve(false));
      document.removeEventListener("focusin", trackFocusIntent, true);
      document.removeEventListener("mousedown", trackFocusIntent, true);
      window.removeEventListener("blur", loseWindowFocus);
      window.removeEventListener("mouseup", pointerUp);
      propsRef.current.onController(null);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const previous = identityRef.current;
    if (previous.generation !== props.loadGeneration || previous.revision !== props.externalRevision) {
      const sameDocument = previous.generation === props.loadGeneration;
      const scrollTop = sameDocument ? view.scrollDOM.scrollTop : 0;
      const length = EditorState.create({ doc: props.value }).doc.length;
      const selection = sameDocument ? EditorSelection.create(view.state.selection.ranges.map((range) => EditorSelection.range(Math.min(range.anchor, length), Math.min(range.head, length))), view.state.selection.mainIndex) : undefined;
      identityRef.current = { generation: props.loadGeneration, revision: props.externalRevision };
      view.setState(makeStateRef.current(props.value, props.loadGeneration, selection));
      view.dispatch({ effects: previewFocus.of(view.hasFocus) });
      view.scrollDOM.scrollTop = scrollTop;
      props.onTextSelection?.(null);
    }
    view.dispatch({ effects: updateResourceContext.of({ generation: props.loadGeneration, documentPath: props.documentPath, workspaceRoot: props.workspaceRoot }) });
  }, [props.loadGeneration, props.externalRevision, props.documentPath, props.workspaceRoot]);

  return <div className="markdown-editor" ref={containerRef} />;
}
