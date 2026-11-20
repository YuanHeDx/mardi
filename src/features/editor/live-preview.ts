import { defaultKeymap, cursorLineDown, cursorLineUp, cursorPageDown, cursorPageUp, selectLineDown, selectLineUp, selectPageDown, selectPageUp } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Facet, StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, type Command, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { BulletWidget, ImageWidget, TableWidget, TaskWidget, type ResourceContext } from "./live-preview-widgets";

export const resourceContext = Facet.define<ResourceContext, ResourceContext>({
  combine: (values) => values[0] ?? { generation: 0, documentPath: "", workspaceRoot: null },
});
export const updateResourceContext = StateEffect.define<ResourceContext>();
export const previewFocus = StateEffect.define<boolean>();
export const previewComposition = StateEffect.define<boolean>();
export const previewWindow = StateEffect.define<{ from: number; to: number }>();
export const revealPreviewRanges = StateEffect.define<{ from: number; to: number }[]>();

interface PreviewState {
  decorations: DecorationSet;
  from: number;
  to: number;
  focused: boolean;
  composing: boolean;
  context: ResourceContext;
  revealed: { from: number; to: number }[];
}

/** The complete source lines touched by all ranges, using CM's [from, to) convention. */
export function activeSourceRanges(state: EditorState, focused: boolean) {
  return state.selection.ranges.flatMap((range) => {
    if (range.empty && !focused) return [];
    const from = state.doc.lineAt(range.from).from;
    const last = range.empty ? range.to : Math.max(range.from, range.to - 1);
    return [{ from, to: state.doc.lineAt(last).to }];
  });
}

function children(node: SyntaxNode, name?: string): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!name || child.name === name) result.push(child);
  }
  return result;
}

function decorationsFor(state: EditorState, preview: Omit<PreviewState, "decorations">): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const active = [...activeSourceRanges(state, preview.focused), ...preview.revealed];
  const touches = (from: number, to: number) => active.some((range) => range.from <= to && range.to >= from);
  // A selection ending exactly at a block's first source character still has
  // its caret there. Keep that block editable even though [from,to) contains
  // no characters on the endpoint's new line.
  const entersBlock = (from: number, to: number) => touches(from, to) || state.selection.ranges.some((range) =>
    (preview.focused || !range.empty) && range.head >= from && range.head <= to,
  );
  const addLine = (from: number, className: string) => ranges.push(Decoration.line({ class: className }).range(from));
  const mark = (from: number, to: number, className: string, attributes?: Record<string, string>) => {
    if (from < to) ranges.push(Decoration.mark({ class: className, attributes }).range(from, to));
  };
  const hide = (from: number, to: number) => {
    if (from < to && state.doc.lineAt(from).number === state.doc.lineAt(to).number) {
      ranges.push(Decoration.replace({}).range(from, to));
    }
  };
  const decorateLines = (node: SyntaxNode, className: string) => {
    const first = state.doc.lineAt(Math.max(node.from, preview.from)).number;
    const last = state.doc.lineAt(Math.min(node.to, preview.to)).number;
    for (let number = first; number <= last; number++) addLine(state.doc.line(number).from, className);
  };

  syntaxTree(state).iterate({
    from: preview.from,
    to: preview.to,
    enter(ref) {
      const node = ref.node;
      const name = node.name;
      const source = () => state.sliceDoc(node.from, node.to);
      if (name === "HTMLBlock" || name === "HTMLTag" || name === "CommentBlock" || name === "ProcessingInstructionBlock") return false;
      if (/^ATXHeading[1-6]$/.test(name)) addLine(state.doc.lineAt(node.from).from, `cm-heading cm-heading-${name.slice(-1)}`);
      if (name.startsWith("SetextHeading")) {
        // A lone dash below prose also parses as a Setext underline until
        // the first list-item character arrives. Keep the typing line stable.
        const underline = node.getChild("HeaderMark");
        const line = underline && state.doc.lineAt(underline.from);
        const typingBullet = preview.focused && name === "SetextHeading2" && underline && line &&
          underline.to - underline.from === 1 && state.selection.ranges.some(
            (range) => range.empty && range.head >= underline.from && range.head <= line.to,
          );
        if (typingBullet) {
          addLine(line.from, "cm-list-line");
        } else {
          decorateLines(node, `cm-heading cm-heading-${name.slice(-1)}`);
          return false; // Keep the Setext underline editable.
        }
      }
      if (name === "FencedCode" || name === "CodeBlock") {
        decorateLines(node, "cm-code-line");
        if (name === "FencedCode") {
          const blockActive = entersBlock(node.from, node.to);
          for (const child of children(node)) {
            if (child.name === "CodeMark" || child.name === "CodeInfo") {
              const line = state.doc.lineAt(child.from);
              addLine(line.from, blockActive ? "cm-code-fence" : "cm-code-fence cm-code-fence-quiet");
              mark(child.from, child.to, "cm-markdown-marker");
            }
          }
        }
        return false; // Markdown-looking code is never interpreted as prose.
      }
      if (name === "Table") {
        // Extremely large tables keep editable source instead of expanding a
        // whole HTML table beyond the virtualized viewport budget.
        if (entersBlock(node.from, node.to) || node.to - node.from > 24000) decorateLines(node, "cm-table-source");
        else {
          const rows = children(node).filter((row) => row.name === "TableHeader" || row.name === "TableRow").map((row) => ({
            from: row.from,
            cells: children(row, "TableCell").map((cell) => cell.from),
          }));
          ranges.push(Decoration.replace({ block: true, widget: new TableWidget(source(), rows) }).range(node.from, node.to));
        }
        return false;
      }
      if (name === "Image") {
        const line = state.doc.lineAt(node.from);
        if (state.sliceDoc(line.from, node.from).trim() || state.sliceDoc(node.to, line.to).trim()) return false;
        const url = children(node, "URL")[0];
        const marks = children(node, "LinkMark");
        if (!url || marks.length < 2) return false;
        const alt = state.sliceDoc(marks[0].to, marks[1].from);
        mark(node.from, node.to, "cm-image-source");
        // A persistent preview below a one-line source/alt keeps the image DOM
        // and its measured height stable when the caret enters the source.
        if (!entersBlock(node.from, node.to)) {
          hide(node.from, marks[0].to);
          hide(marks[1].from, node.to);
          if (!alt) mark(node.from, node.to, "cm-markdown-marker");
        }
        ranges.push(Decoration.widget({ block: true, side: 1, widget: new ImageWidget(state.sliceDoc(url.from, url.to), alt, preview.context) }).range(line.to));
        return false;
      }
      if (name === "Blockquote") decorateLines(node, "cm-quote-line");
      if (name === "ListItem") {
        const line = state.doc.lineAt(node.from);
        addLine(line.from, "cm-list-line");
      }
      const className = ({ StrongEmphasis: "cm-strong", Emphasis: "cm-emphasis", Strikethrough: "cm-strike", InlineCode: "cm-inline-code", Link: "cm-preview-link", Autolink: "cm-preview-link", URL: "cm-url" } as Record<string, string>)[name];
      if (className) {
        if (name === "Link" || name === "Autolink") {
          const target = children(node, "URL")[0];
          mark(node.from, node.to, className, target ? { "data-link-target": state.sliceDoc(target.from, target.to), title: `${state.sliceDoc(target.from, target.to)} · ⌘ / Ctrl 点击打开` } : undefined);
        } else mark(node.from, node.to, className);
      }
      if (name === "Link") {
        if (!touches(node.from, node.to)) {
          const marks = children(node, "LinkMark");
          if (marks.length >= 3) {
            hide(marks[0].from, marks[0].to);
            hide(marks[1].from, node.to);
          }
        }
      }
      if (name === "TaskMarker") {
        if (!touches(node.from, node.to)) ranges.push(Decoration.replace({ widget: new TaskWidget(/x/i.test(source())) }).range(node.from, node.to));
        else mark(node.from, node.to, "cm-markdown-marker");
        return false;
      }
      if (name === "ListMark") {
        const task = node.parent?.name === "ListItem" && node.parent.getChild("Task") !== null;
        if (!touches(node.from, node.to) && task) hide(node.from, node.to + (state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0));
        else if (!touches(node.from, node.to) && /^[*+-]$/.test(source())) ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
        else mark(node.from, node.to, "cm-markdown-marker");
        return false;
      }
      if (["HeaderMark", "EmphasisMark", "StrikethroughMark", "CodeMark", "QuoteMark"].includes(name)) {
        const parent = node.parent!;
        mark(node.from, node.to, "cm-markdown-marker");
        if (!touches(parent.from, parent.to)) {
          let end = node.to;
          if (name === "HeaderMark" || name === "QuoteMark") {
            if (state.sliceDoc(end, end + 1) === " ") end++;
          }
          hide(node.from, end);
        }
      }
    },
  });
  return Decoration.set(ranges, true);
}

// Block widgets and newline-spanning replacements must be direct state
// decorations. A viewport plugin cannot legally provide them after layout.
export const livePreviewField = StateField.define<PreviewState>({
  create(state) {
    const preview = { from: 0, to: Math.min(state.doc.length, 12000), focused: false, composing: false, context: state.facet(resourceContext), revealed: [] };
    return { ...preview, decorations: decorationsFor(state, preview) };
  },
  update(value, transaction) {
    let next = {
      ...value,
      from: transaction.changes.mapPos(value.from, -1),
      to: transaction.changes.mapPos(value.to, 1),
      // A reveal is a one-command bridge. The following selection transaction
      // makes the entered source active, or closes a block that was passed.
      revealed: transaction.selection ? [] : value.revealed.map((range) => ({ from: transaction.changes.mapPos(range.from, -1), to: transaction.changes.mapPos(range.to, 1) })),
    };
    let changed = transaction.docChanged || transaction.selection !== undefined || syntaxTree(transaction.startState) !== syntaxTree(transaction.state);
    for (const effect of transaction.effects) {
      if (effect.is(updateResourceContext)) { next.context = effect.value; changed = true; }
      if (effect.is(previewFocus)) { next.focused = effect.value; changed = true; }
      if (effect.is(previewComposition)) { next.composing = effect.value; changed = true; }
      if (effect.is(revealPreviewRanges)) { next.revealed = effect.value; changed = true; }
      if (effect.is(previewWindow)) { next.from = effect.value.from; next.to = effect.value.to; changed = true; }
    }
    if (next.composing) next.decorations = value.decorations.map(transaction.changes);
    else if (changed) next.decorations = decorationsFor(transaction.state, next);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const windowPlugin = ViewPlugin.fromClass(class {
  frame: number | null = null;
  constructor(readonly view: EditorView) { this.schedule(); }
  update(update: ViewUpdate) {
    if (update.viewportChanged || update.docChanged) this.schedule();
  }
  schedule() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const current = this.view.state.field(livePreviewField);
      const { from, to } = this.view.viewport;
      if (from >= current.from + 1500 && to <= current.to - 1500) return;
      const window = { from: Math.max(0, from - 5000), to: Math.min(this.view.state.doc.length, to + 5000) };
      if (current.from !== window.from || current.to !== window.to) this.view.dispatch({ effects: previewWindow.of(window) });
    });
  }
  destroy() { if (this.frame !== null) cancelAnimationFrame(this.frame); }
});

/** Reveal a folded block before CM measures and executes the same native
 * vertical command. No guessed row/column selection is dispatched here. */
function enterPreviewBeforeMoving(forward: boolean, extend: boolean, page: boolean, native: Command): Command {
  return (view) => {
    const preview = view.state.field(livePreviewField);
    if (view.composing || preview.composing) return false;
    let hasFoldedTable = false;
    preview.decorations.between(preview.from, preview.to, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof TableWidget) hasFoldedTable = true;
    });
    if (!hasFoldedTable) return false;
    const blocks: { from: number; to: number }[] = [];
    const distance = page ? view.scrollDOM.clientHeight || window.innerHeight : undefined;
    for (const range of view.state.selection.ranges) {
      if (!extend && !range.empty) continue;
      const moved = view.moveVertically(range, forward, distance);
      const from = Math.min(range.head, moved.head), to = Math.max(range.head, moved.head);
      view.state.field(livePreviewField).decorations.between(from, to, (start, end, decoration) => {
        if (decoration.spec.widget instanceof TableWidget && !blocks.some((block) => block.from === start)) blocks.push({ from: start, to: end });
      });
    }
    if (!blocks.length) return false;
    view.dispatch({ effects: revealPreviewRanges.of(blocks) });
    // The native command's coordsAtPos/readMeasured synchronizes the new DOM
    // before computing its position. This runs in a key handler, never update.
    native(view);
    if (view.state.field(livePreviewField).revealed.length) view.dispatch({ effects: revealPreviewRanges.of([]) });
    return true;
  };
}

/** Map a table's display cell into the source once, then let CM own the
 * continuous gesture, document listeners, focus, and edge autoscrolling. */
const tableMouseSelection = EditorView.mouseSelectionStyle.of((view, down) => {
  if (down.button !== 0 || view.composing || view.state.field(livePreviewField).composing) return null;
  const cell = down.target instanceof Element ? down.target.closest<HTMLElement>("[data-mardi-table-source]") : null;
  if (!cell || !view.contentDOM.contains(cell)) return null;
  let startPos = Number(cell.dataset.mardiTableSource);
  if (!Number.isInteger(startPos) || startPos < 0 || startPos > view.state.doc.length) return null;
  let startSelection = view.state.selection;
  const clickType = down.detail || 1;
  const rangeAt = (position: number) => {
    if (clickType === 2) return view.state.wordAt(position) ?? EditorSelection.cursor(position);
    if (clickType >= 3) {
      const line = view.state.doc.lineAt(position);
      return EditorSelection.range(line.from, Math.min(view.state.doc.length, line.to + 1));
    }
    return EditorSelection.cursor(position);
  };
  let startRange = rangeAt(startPos);
  return {
    get(event, extend, multiple) {
      const currentPos = event === down ? startPos : view.posAtCoords({ x: event.clientX, y: event.clientY }, false) ?? startPos;
      let range = rangeAt(currentPos);
      if (currentPos !== startPos && !extend) {
        const from = Math.min(startRange.from, range.from), to = Math.max(startRange.to, range.to);
        range = currentPos < startPos ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
      }
      if (extend) return startSelection.replaceRange(startSelection.main.extend(range.from, range.to));
      if (multiple) return startSelection.addRange(range);
      return EditorSelection.create([range]);
    },
    update(update) {
      if (update.docChanged) {
        startPos = update.changes.mapPos(startPos);
        startRange = startRange.map(update.changes);
        startSelection = startSelection.map(update.changes);
      }
    },
  };
});

// Wrap the original bindings by command identity so platform aliases (macOS
// Ctrl-p/n, Ctrl-ArrowUp/Down, Ctrl-v) share the exact same reveal bridge.
const verticalCommands = new Map<Command, [boolean, boolean, boolean]>([
  [cursorLineDown, [true, false, false]], [cursorLineUp, [false, false, false]],
  [selectLineDown, [true, true, false]], [selectLineUp, [false, true, false]],
  [cursorPageDown, [true, false, true]], [cursorPageUp, [false, false, true]],
  [selectPageDown, [true, true, true]], [selectPageUp, [false, true, true]],
]);
const wrapVerticalCommand = (command: Command | undefined) => {
  const movement = command && verticalCommands.get(command);
  return command && movement ? enterPreviewBeforeMoving(...movement, command) : command;
};
const previewNavigation = keymap.of(defaultKeymap.filter((binding) => binding.run && verticalCommands.has(binding.run)).map((binding) => ({
  ...binding,
  run: wrapVerticalCommand(binding.run),
  shift: wrapVerticalCommand(binding.shift),
})));

export const livePreview = [livePreviewField, windowPlugin, previewNavigation, tableMouseSelection];
