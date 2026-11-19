import { mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { RecentFilesGateway } from "../src/core/ports/recent-files-gateway";
import type { RecentFile } from "../src/core/recent-files";
import { useRecentFiles } from "../src/features/recent-files/use-recent-files";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function mount(gateway: RecentFilesGateway) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let api!: ReturnType<typeof useRecentFiles>;
  function Harness() { api = useRecentFiles(gateway); return null; }
  flushSync(() => root.render(<Harness />));
  return { get api() { return api; }, unmount() { flushSync(() => root.unmount()); host.remove(); } };
}

describe("recent files across filesystem mutations", () => {
  it("waits for startup and all remembers added during the drain before invoking rename once", async () => {
    const directory = mkdtempSync("/private/tmp/mardi-recent-hook-");
    const previousPath = `${directory}/before.md`;
    const nextPath = `${directory}/after.md`;
    const extraPath = `${directory}/extra.md`;
    writeFileSync(previousPath, "# first fixture");
    writeFileSync(extraPath, "# later fixture");
    const initial = deferred<RecentFile[]>();
    const firstReply = deferred<void>();
    const laterReply = deferred<void>();
    let stored: RecentFile[] = [];
    const events: string[] = [];
    const gateway: RecentFilesGateway = {
      list: vi.fn(() => initial.promise),
      remember: vi.fn(async (path) => {
        events.push(`start:${path}`);
        await (path === previousPath ? firstReply.promise : laterReply.promise);
        const canonicalPath = realpathSync(path);
        const record: RecentFile = { path: canonicalPath, name: path.split("/").pop()!, kind: "markdown", lastOpenedAt: stored.length + 1 };
        stored = [record, ...stored];
        events.push(`done:${path}`);
        return [...stored];
      }),
      forget: async () => [],
      relocate: async (previous, next) => {
        const canonicalPath = realpathSync(next);
        stored = stored.map((file) => file.path === previous ? { ...file, path: canonicalPath, name: "after.md" } : file);
        return [...stored];
      },
    };
    const harness = mount(gateway);
    try {
      const opened = harness.api.remember(previousPath);
      const rename = vi.fn(async () => {
        events.push("rename");
        renameSync(previousPath, nextPath);
        return { path: nextPath };
      });
      const renamed = harness.api.runAfterPending(rename);
      expect(gateway.remember).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalled();
      initial.resolve([]);
      await vi.waitFor(() => expect(gateway.remember).toHaveBeenCalledExactlyOnceWith(previousPath));
      // This success enters history while runAfterPending is already waiting.
      const laterOpen = harness.api.remember(extraPath);
      firstReply.resolve();
      expect((await opened)?.path).toBe(previousPath);
      await vi.waitFor(() => expect(gateway.remember).toHaveBeenCalledTimes(2));
      expect(rename).not.toHaveBeenCalled();
      laterReply.resolve();
      expect((await laterOpen)?.path).toBe(extraPath);
      await expect(renamed).resolves.toEqual({ path: nextPath });
      expect(rename).toHaveBeenCalledTimes(1);
      expect(events).toEqual([
        `start:${previousPath}`, `done:${previousPath}`,
        `start:${extraPath}`, `done:${extraPath}`, "rename",
      ]);
      await harness.api.relocate(previousPath, nextPath);
      expect(stored.map((file) => file.path)).toEqual([extraPath, nextPath]);
      await vi.waitFor(() => expect(harness.api.files).toEqual(stored));
      expect(harness.api.error).toBeNull();
    } finally {
      harness.unmount();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("still executes the real filesystem rename after history read and write failures", async () => {
    const directory = mkdtempSync("/private/tmp/mardi-recent-hook-");
    const previousPath = `${directory}/before.md`;
    const nextPath = `${directory}/after.md`;
    writeFileSync(previousPath, "# fixture");
    const gateway: RecentFilesGateway = {
      list: async () => { throw new Error("history read denied"); },
      remember: async () => { throw new Error("history disk full"); },
      forget: async () => [],
      relocate: async () => [],
    };
    const harness = mount(gateway);
    try {
      const opened = harness.api.remember(previousPath);
      const rename = vi.fn(async () => {
        renameSync(previousPath, nextPath);
        return realpathSync(nextPath);
      });
      await expect(harness.api.runAfterPending(rename)).resolves.toBe(nextPath);
      await expect(opened).resolves.toBeNull();
      expect(rename).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(harness.api.error).toContain("history disk full"));
    } finally {
      harness.unmount();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
