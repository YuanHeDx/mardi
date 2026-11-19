import { history, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { activeSourceRanges, livePreviewField, previewComposition, previewFocus, resourceContext } from "./live-preview";
import { ImageWidget, TableWidget, TaskWidget, toggleTask } from "./live-preview-widgets";

function stateFor(doc: string) {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), livePreviewField, resourceContext.of({ generation: 1, documentPath: "/notes/a.md", workspaceRoot: "/notes" })] });
}
function entries(state: EditorState) {
  const result: { from: number; to: number; widget: unknown; className: unknown }[] = [];
  state.field(livePreviewField).decorations.between(0, state.doc.length, (from, to, decoration) => {
    result.push({ from, to, widget: decoration.spec.widget, className: decoration.spec.class });
  });
  return result;
}

describe("Markdown Live Preview source projections", () => {
  it("never changes Markdown source while hiding inactive markers", () => {
    const doc = "# Heading\n\n**bold** and [link](https://example.com)\n";
    const initial = stateFor(doc);
    expect(initial.sliceDoc()).toBe(doc);
    expect(entries(initial).some((entry) => entry.from === 0 && entry.to === 2)).toBe(true);
    const active = initial.update({ selection: { anchor: 4 }, effects: previewFocus.of(true) }).state;
    expect(active.sliceDoc()).toBe(doc);
    expect(entries(active).some((entry) => entry.from === 0 && entry.to === 2)).toBe(false);
    expect(entries(active).some((entry) => entry.className === "cm-heading cm-heading-1")).toBe(true);
  });

  it("reveals all selected lines without including a following line at [from,to) boundary", () => {
    let state = stateFor("# one\n**two**\n*three*");
    state = state.update({ selection: EditorSelection.single(0, state.doc.line(3).from) }).state;
    expect(activeSourceRanges(state, false)).toEqual([{ from: 0, to: state.doc.line(2).to }]);
    expect(entries(state).some((entry) => entry.from === 0 && entry.to === 2)).toBe(false);
    const multi = EditorState.create({ doc: "a\nb\nc", selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(4)]), extensions: EditorState.allowMultipleSelections.of(true) });
    expect(activeSourceRanges(multi, true)).toEqual([{ from: 0, to: 1 }, { from: 4, to: 5 }]);
  });

  it("uses GFM tables and reveals their entire source from keyboard positions", () => {
    let state = stateFor("before\n\n| a | b |\n| - | - |\n| c | d |\n\nafter");
    expect(entries(state).filter((entry) => entry.widget instanceof TableWidget)).toHaveLength(1);
    state = state.update({ selection: { anchor: state.doc.line(5).from + 2 }, effects: previewFocus.of(true) }).state;
    expect(entries(state).filter((entry) => entry.widget instanceof TableWidget)).toHaveLength(0);
    expect(entries(state).filter((entry) => entry.className === "cm-table-source")).toHaveLength(3);
  });

  it("does not interpret Markdown-looking code or raw HTML as task/table widgets", () => {
    const state = stateFor('```md\n- [ ] code\n| a | b |\n| - | - |\n```\n\n<div>**literal**</div>');
    expect(entries(state).some((entry) => entry.widget instanceof TaskWidget || entry.widget instanceof TableWidget)).toBe(false);
    expect(entries(state).some((entry) => entry.className === "cm-strong")).toBe(false);
  });

  it("keeps a standalone image preview below its source as activity changes", () => {
    let state = stateFor("![猫咪](cat.png)\n\ntext ![inline](a.png)");
    expect(entries(state).filter((entry) => entry.widget instanceof ImageWidget)).toHaveLength(1);
    state = state.update({ selection: { anchor: 5 }, effects: previewFocus.of(true) }).state;
    expect(entries(state).filter((entry) => entry.widget instanceof ImageWidget)).toHaveLength(1);
  });

  it("freezes display decisions during composition and maps them through source edits", () => {
    let state = stateFor("# title\n\n**text**");
    state = state.update({ effects: previewComposition.of(true) }).state;
    const before = entries(state).filter((entry) => entry.from === 0 && entry.to === 2);
    state = state.update({ selection: { anchor: 4 }, changes: { from: 4, insert: "中" }, effects: previewFocus.of(true) }).state;
    expect(before).toHaveLength(1);
    expect(entries(state).filter((entry) => entry.from === 0 && entry.to === 2)).toHaveLength(1);
    state = state.update({ effects: previewComposition.of(false) }).state;
    expect(entries(state).filter((entry) => entry.from === 0 && entry.to === 2)).toHaveLength(0);
    expect(state.sliceDoc()).toBe("# ti中tle\n\n**text**");
  });

  it("toggles one source character as an isolated undo unit without changing selection", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: "- [ ] task\ntext", extensions: [history()] }) });
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" }, selection: { anchor: 14 } });
    const selection = view.state.selection;
    expect(toggleTask(view, 2)).toBe(true);
    expect(view.state.doc.toString()).toBe("- [x] task\ntext!");
    expect(view.state.selection.eq(selection)).toBe(true);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- [ ] task\ntext!");
    expect(toggleTask(view, 0)).toBe(false);
    view.destroy(); host.remove();
  });
});
