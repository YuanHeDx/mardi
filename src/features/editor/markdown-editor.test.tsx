import { undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkdownEditorController } from "./editor-controller";
import { MarkdownEditor } from "./markdown-editor";
import { livePreviewField } from "./live-preview";
import { TableWidget } from "./live-preview-widgets";

let root: Root;
let host: HTMLDivElement;
let controller: MarkdownEditorController | null;
const change = vi.fn();
const composition = vi.fn();
function render(value = "# hello\n\nbody", generation = 1, revision = 0, path = "/notes/a.md") {
  flushSync(() => root.render(<MarkdownEditor value={value} loadGeneration={generation} externalRevision={revision} documentPath={path} workspaceRoot="/notes" onChange={change} onCompositionChange={composition} onController={(value) => { controller = value; }} />));
  return EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!;
}

beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  change.mockClear(); composition.mockClear(); controller = null;
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("single EditorView lifecycle", () => {
  it("does not autofocus or report a document change when opening", () => {
    const view = render();
    expect(view.hasFocus).toBe(false);
    expect(change).not.toHaveBeenCalled();
    expect(view.contentDOM.getAttribute("aria-label")).toBe("Markdown 编辑器");
  });
  it("keeps view, selection and undo history across echoes and rename", () => {
    const view = render();
    flushSync(() => view.dispatch({ changes: { from: 13, insert: "!" }, selection: { anchor: 14 } }));
    expect(change).toHaveBeenLastCalledWith("# hello\n\nbody!", 1);
    expect(render("# hello\n\nbody!", 1, 0, "/notes/renamed.md")).toBe(view);
    expect(view.state.selection.main.head).toBe(14);
    expect(undo(view)).toBe(true);
    expect(view.state.sliceDoc()).toBe("# hello\n\nbody");
  });
  it("clears history when the same path is explicitly reopened", () => {
    const view = render();
    flushSync(() => view.dispatch({ changes: { from: 13, insert: "!" } }));
    expect(render("# hello\n\nbody!", 2)).toBe(view);
    expect(undo(view)).toBe(false);
    expect(view.state.selection.main.head).toBe(0);
  });
  it("refreshes a disk revision with clamped selection and fresh history", () => {
    const view = render();
    flushSync(() => view.dispatch({ changes: { from: 13, insert: "!" }, selection: { anchor: 14 } }));
    render("new", 1, 1);
    expect(view.state.sliceDoc()).toBe("new");
    expect(view.state.selection.main.head).toBe(3);
    expect(undo(view)).toBe(false);
  });
  it("preserves active-line syntax when a focused editor receives a disk revision", async () => {
    const view = render();
    view.focus();
    await vi.waitFor(() => expect(view.state.field(livePreviewField).focused).toBe(true));
    render("# refreshed", 1, 1);
    expect(view.hasFocus).toBe(true);
    expect(view.state.field(livePreviewField).focused).toBe(true);
    const hidden: number[] = [];
    view.state.field(livePreviewField).decorations.between(0, 2, (from, to) => { if (from === 0 && to === 2) hidden.push(from); });
    expect(hidden).toHaveLength(0);
  });
  it("preserves CRLF when publishing a single edit", () => {
    const view = render("one\r\ntwo\r\n");
    flushSync(() => view.dispatch({ changes: { from: 1, insert: "!" } }));
    expect(change).toHaveBeenLastCalledWith("o!ne\r\ntwo\r\n", 1);
  });
  it("parses native LF paste as real lines inside a CRLF document", () => {
    const view = render("one\r\ntwo\r\n");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? "alpha\nbeta\n" : "" } });
    flushSync(() => view.contentDOM.dispatchEvent(event));
    expect(view.state.doc.lines).toBe(5);
    expect(view.state.sliceDoc()).toBe("one\r\ntwo\r\nalpha\r\nbeta\r\n");
    expect(undo(view)).toBe(true);
    expect(view.state.sliceDoc()).toBe("one\r\ntwo\r\n");
  });
  it("keeps heading text free of the default syntax underline and tasks free of bullets", () => {
    render("# Heading\n\n## Second\n\n### ~~old~~ and [link](https://example.com)\n\n- [ ] task\n- ordinary");
    const headings = host.querySelectorAll(".cm-heading-1 span, .cm-heading-2 span");
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) expect(getComputedStyle(heading).textDecoration).not.toContain("underline");
    expect(getComputedStyle(host.querySelector(".cm-heading .cm-strike")!).textDecoration).toBe("line-through");
    expect(getComputedStyle(host.querySelector(".cm-heading .cm-preview-link")!).textDecoration).toBe("underline");
    expect(host.querySelectorAll(".cm-task-checkbox")).toHaveLength(1);
    expect(host.querySelectorAll(".cm-list-bullet")).toHaveLength(1);
  });

  it.each([
    ["ArrowDown", false], ["ArrowUp", false], ["ArrowDown", true], ["ArrowUp", true],
  ] as const)("reveals a table before the native %s command (shift=%s) measures its target", async (key, shiftKey) => {
    const doc = "before\n\n| a | b |\n| - | - |\n| c | d |\n\nafter";
    const view = render(doc);
    view.focus();
    await vi.waitFor(() => expect(view.state.field(livePreviewField).focused).toBe(true));
    const start = key === "ArrowDown" ? view.state.doc.line(2).from : view.state.doc.line(6).from;
    const entered = key === "ArrowDown" ? view.state.doc.line(3).from : view.state.doc.line(5).from;
    const skipped = key === "ArrowDown" ? view.state.doc.line(6).from : view.state.doc.line(2).from;
    view.dispatch({ selection: { anchor: start } });
    const folded = () => {
      let found = false;
      view.state.field(livePreviewField).decorations.between(0, view.state.doc.length, (_from, _to, decoration) => { if (decoration.spec.widget instanceof TableWidget) found = true; });
      return found;
    };
    expect(folded()).toBe(true);
    // jsdom has no text geometry. This stand-in returns the same skipped
    // position observed in WKWebView while folded, then a source-row position
    // only after the decoration transaction has actually revealed the table.
    const movement = vi.spyOn(view, "moveVertically").mockImplementation(() => EditorSelection.cursor(folded() ? skipped : entered));
    const event = new KeyboardEvent("keydown", { key, code: key, shiftKey, bubbles: true, cancelable: true });
    flushSync(() => view.contentDOM.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(movement).toHaveBeenCalledTimes(2);
    expect(view.state.selection.main.head).toBe(entered);
    expect(view.state.selection.main.anchor).toBe(shiftKey ? start : entered);
    expect(folded()).toBe(false);
    expect(view.state.sliceDoc()).toBe(doc);
    expect(change).not.toHaveBeenCalled();
  });
  it.each([false, true])("lets a table cell start CM's continuous mouse gesture (shift=%s)", async (shiftKey) => {
    const doc = "before\n\n| a | b |\n| - | - |\n| c | d |\n\nafter";
    const view = render(doc);
    view.focus();
    await vi.waitFor(() => expect(view.state.field(livePreviewField).focused).toBe(true));
    const cell = host.querySelector<HTMLElement>("td")!;
    const position = Number(cell.dataset.mardiTableSource);
    const listen = vi.spyOn(document, "addEventListener");
    const unlisten = vi.spyOn(document, "removeEventListener");
    const move = vi.spyOn(view, "posAtCoords").mockImplementation(() => view.state.doc.length);
    flushSync(() => cell.dispatchEvent(new MouseEvent("mousedown", { button: 0, buttons: 1, detail: 1, shiftKey, clientX: 100, clientY: 100, bubbles: true, cancelable: true })));
    expect(listen.mock.calls.some(([type]) => type === "mousemove")).toBe(true);
    expect(view.state.selection.main.head).toBe(position);
    expect(view.state.selection.main.anchor).toBe(shiftKey ? 0 : position);
    expect(host.querySelector(".cm-preview-table")).toBeNull();
    // The initial widget DOM is gone, but CM's document listener remains.
    flushSync(() => document.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientX: 180, clientY: 150, bubbles: true, cancelable: true })));
    expect(move).toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(view.state.selection.main.anchor).toBe(shiftKey ? 0 : position);
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 180, clientY: 150, bubbles: true, cancelable: true }));
    expect(unlisten.mock.calls.some(([type]) => type === "mousemove")).toBe(true);
    expect(view.state.sliceDoc()).toBe(doc);
    expect(change).not.toHaveBeenCalled();
  });

  it("maps a table drag's source anchor through document changes", async () => {
    const view = render("before\n\n| a | b |\n| - | - |\n| c | d |\n\nafter");
    view.focus();
    await vi.waitFor(() => expect(view.state.field(livePreviewField).focused).toBe(true));
    const cell = host.querySelector<HTMLElement>("td")!;
    const position = Number(cell.dataset.mardiTableSource);
    vi.spyOn(view, "posAtCoords").mockImplementation(() => view.state.doc.length);
    flushSync(() => cell.dispatchEvent(new MouseEvent("mousedown", { button: 0, buttons: 1, detail: 1, clientX: 100, clientY: 100, bubbles: true, cancelable: true })));
    flushSync(() => view.dispatch({ changes: { from: 0, insert: "prefix" } }));
    flushSync(() => document.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientX: 180, clientY: 150, bubbles: true, cancelable: true })));
    expect(view.state.selection.main.anchor).toBe(position + 6);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  it("holds composition until CM has consumed the final document update", async () => {
    const view = render("hello");
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(composition).toHaveBeenLastCalledWith(true, 1);
    const finish = controller!.finishComposition();
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" }));
    // Simulate the native DOM observer's final transaction after the event.
    flushSync(() => view.dispatch({ changes: { from: 5, insert: "中文" } }));
    expect(composition).not.toHaveBeenLastCalledWith(false, 1);
    expect(await finish).toBe(true);
    expect(change).toHaveBeenLastCalledWith("hello中文", 1);
    expect(composition).toHaveBeenLastCalledWith(false, 1);
  });
  it("returns a bounded failure when a native composition never ends", async () => {
    const view = render("hello");
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(await controller!.finishComposition()).toBe(false);
    expect(composition).toHaveBeenLastCalledWith(true, 1);
  });
});
