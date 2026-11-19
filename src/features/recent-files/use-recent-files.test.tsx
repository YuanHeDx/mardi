import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentFilesGateway } from "../../core/ports/recent-files-gateway";
import type { RecentFile } from "../../core/recent-files";
import { useRecentFiles } from "./use-recent-files";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const a: RecentFile = { path: "/notes/a.md", name: "a.md", kind: "markdown", lastOpenedAt: 1 };
const b: RecentFile = { path: "/notes/b.png", name: "b.png", kind: "image", lastOpenedAt: 2 };
let gateway: RecentFilesGateway;
let api: ReturnType<typeof useRecentFiles>;
let root: Root;
let host: HTMLElement;
let unmounted: boolean;
function Harness() { api = useRecentFiles(gateway); return null; }

beforeEach(() => {
  gateway = {
    list: vi.fn(async () => []),
    remember: vi.fn(async () => [b, a]),
    forget: vi.fn(async () => [b]),
    relocate: vi.fn(async () => []),
  };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  unmounted = false;
});
afterEach(() => {
  if (!unmounted) flushSync(() => root.unmount());
  host.remove();
});

describe("recent file persistence queue", () => {
  it("serializes initial hydration, native mutation invocation, and snapshot publication", async () => {
    const initial = deferred<RecentFile[]>();
    vi.mocked(gateway.list).mockReturnValue(initial.promise);
    flushSync(() => root.render(<Harness />));
    const open = api.remember(b.path);
    const forget = api.forget(a.path);
    await vi.waitFor(() => expect(gateway.list).toHaveBeenCalledTimes(1));
    expect(gateway.remember).not.toHaveBeenCalled();
    expect(gateway.forget).not.toHaveBeenCalled();
    expect(api.files).toEqual([]);
    initial.resolve([a]);
    expect(await open).toEqual(b); await forget;
    await vi.waitFor(() => expect(api.files).toEqual([b]));
    expect(api.loading).toBe(false);
    expect(gateway.remember).toHaveBeenCalledExactlyOnceWith(b.path);
    expect(gateway.forget).toHaveBeenCalledExactlyOnceWith(a.path);
  });

  it("absorbs read/write failures, keeps previous files, and continues the FIFO", async () => {
    vi.mocked(gateway.list).mockRejectedValueOnce(new Error("cannot read history"));
    flushSync(() => root.render(<Harness />));
    await vi.waitFor(() => expect(api.error).toContain("cannot read history"));
    expect(api.loading).toBe(false);
    await expect(api.remember(b.path)).resolves.toEqual(b);
    await vi.waitFor(() => expect(api.files).toEqual([b, a]));
    vi.mocked(gateway.forget).mockRejectedValueOnce(new Error("disk full"));
    await expect(api.forget(a.path)).resolves.toBeUndefined();
    await vi.waitFor(() => expect(api.error).toContain("disk full"));
    expect(api.files).toEqual([b, a]);
    flushSync(() => api.dismissError());
    expect(api.error).toBeNull();
    await expect(api.relocate("/notes", "/renamed")).resolves.toBeUndefined();
    await vi.waitFor(() => expect(api.files).toEqual([]));
  });

  it("queues reload invocation behind a pending mutation", async () => {
    const mutation = deferred<RecentFile[]>();
    vi.mocked(gateway.remember).mockReturnValue(mutation.promise);
    flushSync(() => root.render(<Harness />));
    await vi.waitFor(() => expect(api.loading).toBe(false));
    const open = api.remember(b.path);
    vi.mocked(gateway.list).mockResolvedValue([b, a]);
    const reload = api.reload();
    await vi.waitFor(() => expect(gateway.remember).toHaveBeenCalledTimes(1));
    expect(gateway.list).toHaveBeenCalledTimes(1);
    expect(api.files).toEqual([]);
    mutation.resolve([b, a]);
    await open; await reload;
    await vi.waitFor(() => expect(api.files).toEqual([b, a]));
    expect(gateway.list).toHaveBeenCalledTimes(2);
  });

  it("handles a rejected mutation when hydration allows its queued invocation", async () => {
    const initial = deferred<RecentFile[]>();
    vi.mocked(gateway.list).mockReturnValue(initial.promise);
    vi.mocked(gateway.remember).mockRejectedValueOnce(new Error("history unavailable"));
    flushSync(() => root.render(<Harness />));
    const open = api.remember(b.path);
    await vi.waitFor(() => expect(gateway.list).toHaveBeenCalledTimes(1));
    expect(gateway.remember).not.toHaveBeenCalled();
    initial.resolve([a]);
    await expect(open).resolves.toBeNull();
    await vi.waitFor(() => expect(api.error).toContain("history unavailable"));
    expect(api.files).toEqual([a]);
  });

  it("runAfterPending preserves the filesystem operation's result and failure", async () => {
    flushSync(() => root.render(<Harness />));
    await expect(api.runAfterPending(async () => ({ path: "/renamed/a.md" }))).resolves.toEqual({ path: "/renamed/a.md" });
    await expect(api.runAfterPending(async () => { throw new Error("rename denied"); })).rejects.toThrow("rename denied");
  });

  it("lets an authorized queued write finish after unmount without publishing state", async () => {
    const initial = deferred<RecentFile[]>();
    vi.mocked(gateway.list).mockReturnValue(initial.promise);
    flushSync(() => root.render(<Harness />));
    const open = api.remember(b.path);
    flushSync(() => root.unmount()); unmounted = true;
    initial.resolve([a]);
    await open;
    expect(gateway.remember).toHaveBeenCalledExactlyOnceWith(b.path);
    expect(api.files).toEqual([]);
    expect(api.error).toBeNull();
  });
});
