import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaContent, RootWorkspace } from "./core/workspace";
import type { RecentFile } from "./core/recent-files";
import App from "./App";
import type { ComponentProps } from "react";
import type { WorkspaceSidebar } from "./features/workspace/workspace-sidebar";

const state = vi.hoisted(() => ({
  roots: [] as RootWorkspace[], openPath: vi.fn(), closeDocument: vi.fn(),
  remember: vi.fn(), forget: vi.fn(), relocate: vi.fn(), renameEntry: vi.fn(), trashEntry: vi.fn(), removeRoot: vi.fn(),
  runAfterPending: vi.fn(),
  sidebar: null as ComponentProps<typeof WorkspaceSidebar> | null,
  media: null as MediaContent | null,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: () => Promise.resolve() }) }));
vi.mock("./infrastructure/tauri/runtime", () => ({ isTauriRuntime: () => true }));
vi.mock("./features/document/use-document-session", () => ({ useDocumentSession: () => ({ session: { document: null, loadGeneration: 0, externalRevision: 0, error: null, isSaving: false }, dirty: false, openPath: state.openPath, closeDocument: state.closeDocument }) }));
vi.mock("./features/workspace/use-workspace", () => ({ useWorkspace: () => ({ roots: state.roots, latestChange: null, error: null, renameEntry: state.renameEntry, trashEntry: state.trashEntry, removeRoot: state.removeRoot }) }));
vi.mock("./features/recent-files/use-recent-files", () => ({ useRecentFiles: () => ({ files: [], loading: false, error: null, remember: state.remember, forget: state.forget, relocate: state.relocate, runAfterPending: state.runAfterPending }) }));
vi.mock("./features/workspace/workspace-sidebar", () => ({ WorkspaceSidebar: (props: ComponentProps<typeof WorkspaceSidebar>) => { state.sidebar = props; return null; } }));
vi.mock("./ui/media-preview", () => ({ MediaPreview: ({ media }: { media: MediaContent }) => { state.media = media; return null; } }));
vi.mock("./ui/title-bar", () => ({ TitleBar: () => null }));
vi.mock("./ui/status-bar", () => ({ StatusBar: () => null }));
vi.mock("./ui/markdown-preview", () => ({ MarkdownPreview: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
let host: HTMLElement;
let root: Root;
let notify: () => void;
beforeEach(() => {
  state.roots = [];
  state.openPath.mockReset().mockResolvedValue(true);
  state.closeDocument.mockReset().mockResolvedValue(true);
  state.remember.mockReset().mockResolvedValue(undefined);
  state.forget.mockReset().mockResolvedValue(undefined);
  state.relocate.mockReset().mockResolvedValue(undefined);
  state.runAfterPending.mockReset().mockImplementation((operation: () => Promise<unknown>) => operation());
  state.renameEntry.mockReset();
  state.trashEntry.mockReset().mockResolvedValue(true);
  state.removeRoot.mockReset();
  state.sidebar = null;
  state.media = null;
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset().mockImplementation(async (_event, handler) => { notify = () => handler({} as never); return () => undefined; });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("native system-open request lifecycle", () => {
  it("keeps a backend-popped startup batch while workspace roots hydrate", async () => {
    const reply = deferred<string[]>();
    vi.mocked(invoke).mockReturnValue(reply.promise);
    flushSync(() => root.render(<App />));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("take_pending_open_files"));
    state.roots = [{ root: { rootPath: "/notes" } } as RootWorkspace];
    flushSync(() => root.render(<App />));
    reply.resolve(["/notes/startup.md"]);
    await vi.waitFor(() => expect(state.openPath).toHaveBeenCalledWith("/notes/startup.md"));
    expect(listen).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("serializes a newer notification after the current batch completes", async () => {
    const openA = deferred<boolean>();
    state.openPath.mockImplementation((path: string) => path.endsWith("a.md") ? openA.promise : Promise.resolve(true));
    vi.mocked(invoke).mockResolvedValueOnce(["/notes/a.md", "/notes/b.md"]).mockResolvedValueOnce(["/notes/c.md"]);
    flushSync(() => root.render(<App />));
    await vi.waitFor(() => expect(state.openPath).toHaveBeenCalledWith("/notes/a.md"));
    notify(); notify();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(state.openPath).toHaveBeenCalledTimes(1);
    openA.resolve(true);
    await vi.waitFor(() => expect(state.openPath).toHaveBeenLastCalledWith("/notes/c.md"));
    expect(state.openPath.mock.calls.map(([path]) => path)).toEqual(["/notes/a.md", "/notes/b.md", "/notes/c.md"]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("recent files open and lifecycle integration", () => {
  it("records system-open successes without waiting for history persistence", async () => {
    state.remember.mockReturnValue(new Promise(() => undefined));
    vi.mocked(invoke).mockResolvedValue(["/outside/a.md", "/notes/b.md"]);
    flushSync(() => root.render(<App />));
    await vi.waitFor(() => expect(state.remember.mock.calls.map(([path]) => path)).toEqual(["/outside/a.md", "/notes/b.md"]));
    expect(state.openPath.mock.calls.map(([path]) => path)).toEqual(["/outside/a.md", "/notes/b.md"]);
  });

  it("does not record failed document opens or media switches blocked by saving", async () => {
    state.openPath.mockResolvedValue(false);
    state.closeDocument.mockResolvedValue(false);
    vi.mocked(invoke).mockResolvedValue(["/missing.md", "/blocked.png"]);
    flushSync(() => root.render(<App />));
    await vi.waitFor(() => expect(state.closeDocument).toHaveBeenCalled());
    expect(state.remember).not.toHaveBeenCalled();
  });

  it("opens a recent item through the same document gate and refreshes its recency", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    flushSync(() => root.render(<App />));
    state.sidebar?.onSelectRecentFile?.({ path: "/outside/recent.md", name: "recent.md", kind: "markdown", lastOpenedAt: 1 });
    await vi.waitFor(() => expect(state.remember).toHaveBeenCalledWith("/outside/recent.md"));
    expect(state.openPath).toHaveBeenCalledWith("/outside/recent.md");
  });

  it("highlights canonical media history without changing the preview source or generation", async () => {
    const reply = deferred<RecentFile | null>();
    state.remember.mockReturnValue(reply.promise);
    vi.mocked(invoke).mockResolvedValue(["/tmp/alias.png"]);
    flushSync(() => root.render(<App />));
    await vi.waitFor(() => expect(state.media?.path).toBe("/tmp/alias.png"));
    const generation = state.media!.openGeneration;
    reply.resolve({ path: "/private/tmp/real.png", name: "real.png", kind: "image", lastOpenedAt: 1 });
    await vi.waitFor(() => expect(state.sidebar?.activePath).toBe("/private/tmp/real.png"));
    expect(state.media?.path).toBe("/tmp/alias.png");
    expect(state.media?.openGeneration).toBe(generation);
  });

  it("ignores canonical identity replies for media that has since been replaced", async () => {
    const oldReply = deferred<RecentFile | null>();
    state.remember.mockReturnValueOnce(oldReply.promise).mockResolvedValue(null);
    vi.mocked(invoke).mockResolvedValue(["/tmp/old.png", "/tmp/new.png"]);
    flushSync(() => root.render(<App />));
    await vi.waitFor(() => expect(state.media?.path).toBe("/tmp/new.png"));
    oldReply.resolve({ path: "/private/tmp/old.png", name: "old.png", kind: "image", lastOpenedAt: 1 });
    await Promise.resolve();
    flushSync(() => root.render(<App />));
    expect(state.sidebar?.activePath).toBe("/tmp/new.png");
    expect(state.media?.canonicalPath).toBeUndefined();
  });

  it("keeps recent files when removing a root and only edits history for a recent remove", () => {
    vi.mocked(invoke).mockResolvedValue([]);
    flushSync(() => root.render(<App />));
    state.sidebar?.onRemoveRoot("/notes");
    expect(state.removeRoot).toHaveBeenCalledWith("/notes");
    expect(state.forget).not.toHaveBeenCalled();
    state.sidebar?.onRemoveRecentFile?.("/outside/a.md");
    expect(state.forget).toHaveBeenCalledWith("/outside/a.md");
    expect(state.trashEntry).not.toHaveBeenCalled();
  });

  it("updates recent path prefixes only after a successful rename or trash", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const entry = { path: "/notes/old", name: "old", kind: "directory" as const, children: [] };
    state.renameEntry.mockResolvedValueOnce(null).mockResolvedValue({ ...entry, path: "/notes/new", name: "new" });
    state.trashEntry.mockResolvedValueOnce(false).mockResolvedValue(true);
    flushSync(() => root.render(<App />));
    expect(await state.sidebar?.onRenameFile(entry, "/notes", "new")).toBe(false);
    expect(state.relocate).not.toHaveBeenCalled();
    expect(await state.sidebar?.onDeleteFile(entry, "/notes")).toBe(false);
    expect(state.forget).not.toHaveBeenCalled();
    expect(await state.sidebar?.onRenameFile(entry, "/notes", "new")).toBe(true);
    expect(state.relocate).toHaveBeenCalledWith("/notes/old", "/notes/new");
    expect(await state.sidebar?.onDeleteFile(entry, "/notes")).toBe(true);
    expect(state.forget).toHaveBeenCalledWith("/notes/old");
  });

  it("holds filesystem mutations until earlier opened files have been recorded", async () => {
    const pendingHistory = deferred<void>();
    state.runAfterPending.mockImplementation(async (operation: () => Promise<unknown>) => {
      await pendingHistory.promise;
      return operation();
    });
    vi.mocked(invoke).mockResolvedValue([]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const entry = { path: "/notes/a.md", name: "a.md", kind: "markdown" as const, children: [] };
    state.renameEntry.mockResolvedValue({ ...entry, path: "/notes/b.md", name: "b.md" });
    flushSync(() => root.render(<App />));
    const renamed = state.sidebar?.onRenameFile(entry, "/notes", "b");
    const trashed = state.sidebar?.onDeleteFile(entry, "/notes");
    expect(state.renameEntry).not.toHaveBeenCalled();
    expect(state.trashEntry).not.toHaveBeenCalled();
    pendingHistory.resolve();
    expect(await renamed).toBe(true);
    expect(await trashed).toBe(true);
    expect(state.renameEntry).toHaveBeenCalledOnce();
    expect(state.trashEntry).toHaveBeenCalledOnce();
  });

  it.each([false, true])("rechecks media identity after trash waits for canonical history (switch media: %s)", async (switchMedia) => {
    const identity = deferred<RecentFile | null>();
    const trashed = deferred<boolean>();
    state.remember.mockReturnValue(identity.promise);
    state.runAfterPending.mockImplementation(async (operation: () => Promise<unknown>) => {
      await identity.promise;
      return operation();
    });
    state.trashEntry.mockReturnValue(trashed.promise);
    vi.mocked(invoke).mockResolvedValue(["/tmp/alias.png"]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    flushSync(() => root.render(<App />));
    await vi.waitFor(() => expect(state.sidebar?.activePath).toBe("/tmp/alias.png"));
    const deleted = state.sidebar?.onDeleteFile({ path: "/private/tmp/real.png", name: "real.png", kind: "image", children: [] }, "/private/tmp");
    identity.resolve({ path: "/private/tmp/real.png", name: "real.png", kind: "image", lastOpenedAt: 1 });
    await vi.waitFor(() => expect(state.sidebar?.activePath).toBe("/private/tmp/real.png"));
    if (switchMedia) {
      state.remember.mockResolvedValue(null);
      state.sidebar?.onSelectRecentFile?.({ path: "/private/tmp/new.png", name: "new.png", kind: "image", lastOpenedAt: 2 });
      await vi.waitFor(() => expect(state.sidebar?.activePath).toBe("/private/tmp/new.png"));
    }
    trashed.resolve(true);
    expect(await deleted).toBe(true);
    await vi.waitFor(() => expect(state.sidebar?.activePath).toBe(switchMedia ? "/private/tmp/new.png" : null));
  });
});
