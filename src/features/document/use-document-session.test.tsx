import { EditorView } from "@codemirror/view";
import { MarkdownEditor } from "../editor/markdown-editor";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentSnapshot } from "../../core/document";
import { documentGateway } from "../../infrastructure/tauri/document-gateway";
import { useDocumentSession } from "./use-document-session";

vi.mock("../../infrastructure/tauri/runtime", () => ({ isTauriRuntime: () => true, messageFromError: (error: unknown) => String(error) }));
vi.mock("../../infrastructure/tauri/document-gateway", () => ({ documentGateway: { readDocument: vi.fn(), writeDocument: vi.fn(), locateDocument: vi.fn(), chooseSupportedFile: vi.fn() } }));
type CloseHandler = (event: { preventDefault: () => void }) => Promise<void>;
const onCloseRequested = vi.hoisted(() => vi.fn<(handler: CloseHandler) => Promise<() => void>>());
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const initial: DocumentSnapshot = { path: "/notes/a.md", name: "a.md", content: "saved", fileId: "a" };
let api: ReturnType<typeof useDocumentSession>;
let root: Root;
let host: HTMLElement;
function Harness() { api = useDocumentSession(initial); return null; }
function EditorHarness() {
  api = useDocumentSession({ ...initial, content: "hello" });
  const document = api.session.document;
  return document ? <MarkdownEditor value={document.content} loadGeneration={api.session.loadGeneration} externalRevision={api.session.externalRevision} documentPath={document.path} workspaceRoot="/notes" onChange={api.setContent} onCompositionChange={api.setComposing} onController={api.registerEditor} /> : null;
}
const setContent = (content: string) => flushSync(() => api.setContent(content, api.session.loadGeneration));
beforeEach(() => {
  onCloseRequested.mockReset().mockResolvedValue(() => undefined);
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
  vi.mocked(documentGateway.writeDocument).mockReset().mockResolvedValue(undefined);
  vi.mocked(documentGateway.readDocument).mockReset();
  vi.mocked(documentGateway.locateDocument).mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  flushSync(() => root.render(<Harness />));
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("document session save and load gates", () => {
  it("waits for the pending edit before allowing the native window to close", async () => {
    await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledOnce());
    const [close] = onCloseRequested.mock.calls[0];
    const write = deferred<void>();
    vi.mocked(documentGateway.writeDocument).mockReturnValueOnce(write.promise);
    setContent("last edit");
    const preventDefault = vi.fn();
    const first = close({ preventDefault });
    await vi.waitFor(() => expect(documentGateway.writeDocument).toHaveBeenCalledWith(initial.path, "last edit"));
    const repeat = { preventDefault: vi.fn() };
    await close(repeat);
    expect(repeat.preventDefault).toHaveBeenCalledOnce();
    write.resolve();
    await first;
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("keeps the window open on write failure and allows another close attempt", async () => {
    await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledOnce());
    const [close] = onCloseRequested.mock.calls[0];
    vi.mocked(documentGateway.writeDocument).mockRejectedValueOnce(new Error("disk full"));
    setContent("draft");
    const preventDefault = vi.fn();
    await close({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    preventDefault.mockClear();
    await close({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("writes the newest snapshot after an earlier save finishes", async () => {
    const first = deferred<void>();
    vi.mocked(documentGateway.writeDocument).mockReturnValueOnce(first.promise);
    setContent("first");
    const save = api.save();
    await vi.waitFor(() => expect(documentGateway.writeDocument).toHaveBeenCalledWith(initial.path, "first"));
    setContent("newer");
    first.resolve();
    expect(await save).toBe(true);
    await vi.waitFor(() => expect(api.dirty).toBe(false));
    expect(documentGateway.writeDocument).toHaveBeenLastCalledWith(initial.path, "newer");
    expect(api.session.savedContent).toBe("newer");
  });

  it("does not save marked text on debounce; resumes after composition commits", async () => {
    vi.useFakeTimers();
    flushSync(() => api.setComposing(true, api.session.loadGeneration));
    setContent("marked nihao");
    await vi.advanceTimersByTimeAsync(1000);
    expect(documentGateway.writeDocument).not.toHaveBeenCalled();
    setContent("你好");
    flushSync(() => api.setComposing(false, api.session.loadGeneration));
    await vi.advanceTimersByTimeAsync(401);
    expect(documentGateway.writeDocument).toHaveBeenCalledWith(initial.path, "你好");
  });

  it("finishes composition before an explicit save snapshots content", async () => {
    setContent("marked");
    flushSync(() => api.setComposing(true, api.session.loadGeneration));
    api.registerEditor({ focus() {}, finishComposition: async () => {
      setContent("中文");
      flushSync(() => api.setComposing(false, api.session.loadGeneration));
      return true;
    } });
    expect(await api.save()).toBe(true);
    expect(documentGateway.writeDocument).toHaveBeenCalledExactlyOnceWith(initial.path, "中文");
  });

  it("keeps editor focus and keyboard undo after Cmd/Ctrl+S flushes composition", async () => {
    flushSync(() => root.render(<EditorHarness />));
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!;
    view.focus();
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    flushSync(() => view.dispatch({ changes: { from: 5, insert: "x" }, selection: { anchor: 6 } }));
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "x" }));
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(documentGateway.writeDocument).toHaveBeenCalledWith(initial.path, "hellox"));
    expect(view.hasFocus).toBe(true);
    expect(view.state.selection.main.head).toBe(6);
    const modifier = /Mac|iP/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    flushSync(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ...modifier, bubbles: true, cancelable: true })));
    expect(view.state.sliceDoc()).toBe("hello");
  });

  it.each([
    { isComposing: true, keyCode: 83 },
    { isComposing: false, keyCode: 229 },
    { isComposing: true, keyCode: 229 },
  ])("leaves IME-owned Cmd+S alone ($isComposing / $keyCode)", async (processing) => {
    vi.useFakeTimers();
    const finishComposition = vi.fn(async () => false);
    api.registerEditor({ focus() {}, finishComposition });
    flushSync(() => api.setComposing(true, api.session.loadGeneration));
    setContent("marked ni hao");
    const event = new KeyboardEvent("keydown", { key: "s", code: "KeyS", metaKey: true, ...processing, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(1000);
    expect(event.defaultPrevented).toBe(false);
    expect(finishComposition).not.toHaveBeenCalled();
    expect(documentGateway.writeDocument).not.toHaveBeenCalled();
    expect(api.session.error).toBeNull();
    expect(api.session.document?.content).toBe("marked ni hao");
  });

  it("keeps marked text focused until the user commits after an IME-processing Cmd+S", async () => {
    flushSync(() => root.render(<EditorHarness />));
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!;
    view.focus();
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    flushSync(() => view.dispatch({ changes: { from: 5, insert: "ni hao" } }));
    const event = new KeyboardEvent("keydown", { key: "s", code: "KeyS", keyCode: 229, isComposing: true, metaKey: true, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(event.defaultPrevented).toBe(false);
    expect(view.hasFocus).toBe(true);
    expect(documentGateway.writeDocument).not.toHaveBeenCalled();
    expect(view.state.sliceDoc()).toBe("helloni hao");
    // Only the input method/user's explicit final transaction commits text.
    flushSync(() => view.dispatch({ changes: { from: 5, to: view.state.doc.length, insert: "你好" } }));
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "你好" }));
    await vi.waitFor(() => expect(documentGateway.writeDocument).toHaveBeenCalledWith(initial.path, "hello你好"));
    expect(view.hasFocus).toBe(true);
  });

  it.each(["input", "body", "window", "pointer"] as const)("does not return manual-save focus after a newer %s focus intent", async (target) => {
    flushSync(() => root.render(<EditorHarness />));
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!;
    const input = document.createElement("input"); document.body.append(input);
    view.focus();
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    flushSync(() => view.dispatch({ changes: { from: 5, insert: "x" } }));
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "x" }));
    const save = api.save();
    if (target === "window") window.dispatchEvent(new Event("blur"));
    else if (target === "pointer") document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    else {
      input.focus();
      if (target === "body") input.blur();
    }
    expect(await save).toBe(true);
    expect(document.activeElement).toBe(target === "input" ? input : document.body);
    expect(view.hasFocus).toBe(false);
    input.remove();
  });

  it("does not restore manual-save focus after a later file-open intent", async () => {
    vi.mocked(documentGateway.readDocument).mockResolvedValue({ path: "/notes/b.md", name: "b.md", content: "B" });
    flushSync(() => root.render(<EditorHarness />));
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!;
    view.focus();
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    flushSync(() => view.dispatch({ changes: { from: 5, insert: "x" } }));
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "x" }));
    const manual = api.save();
    const open = api.openPath("/notes/b.md");
    await manual; expect(await open).toBe(true);
    await vi.waitFor(() => expect(api.session.document?.name).toBe("b.md"));
    expect(view.hasFocus).toBe(false);
  });

  it("retains the current document when composition cannot finish", async () => {
    setContent("marked");
    flushSync(() => api.setComposing(true, api.session.loadGeneration));
    api.registerEditor({ focus() {}, finishComposition: async () => false });
    expect(await api.openPath("/notes/b.md")).toBe(false);
    expect(documentGateway.readDocument).not.toHaveBeenCalled();
    expect(documentGateway.writeDocument).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(api.session.error).toContain("输入法候选"));
    expect(api.session.document?.content).toBe("marked");
  });

  it("retains the editable buffer and refuses to switch after a write failure", async () => {
    vi.mocked(documentGateway.writeDocument).mockRejectedValue(new Error("permission denied"));
    setContent("draft");
    expect(await api.openPath("/notes/b.md")).toBe(false);
    expect(documentGateway.readDocument).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(api.session.error).toContain("permission denied"));
    expect(api.session.document?.content).toBe("draft");
    expect(api.dirty).toBe(true);
  });

  it("only accepts the latest asynchronous open and ignores old read errors", async () => {
    const oldRead = deferred<DocumentSnapshot>();
    vi.mocked(documentGateway.readDocument).mockImplementation((path) => path.endsWith("b.md") ? oldRead.promise : Promise.resolve({ path, name: "c.md", content: "C" }));
    const openB = api.openPath("/notes/b.md");
    await vi.waitFor(() => expect(documentGateway.readDocument).toHaveBeenCalledWith("/notes/b.md"));
    expect(await api.openPath("/notes/c.md")).toBe(true);
    oldRead.reject(new Error("old B failure"));
    expect(await openB).toBe(false);
    await vi.waitFor(() => expect(api.session.document?.name).toBe("c.md"));
    expect(api.session.error).toBeNull();
  });

  it("saves edits made during an open read before replacing the buffer", async () => {
    const read = deferred<DocumentSnapshot>();
    vi.mocked(documentGateway.readDocument).mockReturnValueOnce(read.promise).mockResolvedValue({ path: "/notes/b.md", name: "b.md", content: "B" });
    const open = api.openPath("/notes/b.md");
    await vi.waitFor(() => expect(documentGateway.readDocument).toHaveBeenCalledTimes(1));
    setContent("typed while reading");
    read.resolve({ path: "/notes/b.md", name: "b.md", content: "B" });
    expect(await open).toBe(true);
    expect(documentGateway.writeDocument).toHaveBeenCalledWith(initial.path, "typed while reading");
    expect(documentGateway.readDocument).toHaveBeenCalledTimes(2);
  });

  it("does not apply an old external-refresh failure to the new document", async () => {
    const refresh = deferred<DocumentSnapshot>();
    vi.mocked(documentGateway.readDocument).mockImplementation((path) => path === initial.path ? refresh.promise : Promise.resolve({ path, name: "b.md", content: "B" }));
    const pending = api.refreshFromDisk(initial.path);
    expect(await api.openPath("/notes/b.md")).toBe(true);
    refresh.reject(new Error("old refresh failure"));
    expect(await pending).toBe(false);
    await vi.waitFor(() => expect(api.session.document?.name).toBe("b.md"));
    expect(api.session.error).toBeNull();
  });

  it("rejects an old save invocation after a synchronous document discard", async () => {
    setContent("old draft");
    const pending = api.save();
    flushSync(() => api.discardDocument());
    expect(await pending).toBe(false);
    expect(documentGateway.writeDocument).not.toHaveBeenCalled();
  });

  it("does not apply a refresh read that predates a completed local save", async () => {
    const read = deferred<DocumentSnapshot>();
    vi.mocked(documentGateway.readDocument).mockReturnValue(read.promise);
    const refresh = api.refreshFromDisk(initial.path);
    setContent("new local snapshot");
    expect(await api.save()).toBe(true);
    read.resolve({ ...initial, content: "old external snapshot" });
    expect(await refresh).toBe(false);
    await vi.waitFor(() => expect(api.session.document?.content).toBe("new local snapshot"));
  });

  it("ignores content callbacks from a previous loaded editor generation", async () => {
    const previous = api.session.loadGeneration;
    vi.mocked(documentGateway.readDocument).mockResolvedValue({ path: "/notes/b.md", name: "b.md", content: "B" });
    expect(await api.openPath("/notes/b.md")).toBe(true);
    flushSync(() => api.setContent("late A", previous));
    await vi.waitFor(() => expect(api.session.document?.content).toBe("B"));
  });

  it("does not apply an old locate failure after same-file reopen", async () => {
    const locate = deferred<null>();
    vi.mocked(documentGateway.locateDocument).mockReturnValue(locate.promise);
    vi.mocked(documentGateway.readDocument).mockResolvedValue(initial);
    const pending = api.reconcileDocumentLocation(["/notes"], []);
    const generation = api.session.loadGeneration;
    expect(await api.openPath(initial.path)).toBe(true);
    locate.reject(new Error("old locate failure"));
    expect(await pending).toBe(false);
    await vi.waitFor(() => expect(api.session.loadGeneration).toBe(generation + 1));
    expect(api.session.error).toBeNull();
  });
});
