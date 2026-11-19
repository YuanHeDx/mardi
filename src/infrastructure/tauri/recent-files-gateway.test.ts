import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriRecentFilesGateway } from "./recent-files-gateway";
import { isTauriRuntime } from "./runtime";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./runtime", () => ({ isTauriRuntime: vi.fn(() => true) }));
beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([]);
  vi.mocked(isTauriRuntime).mockReturnValue(true);
});

describe("recent files gateway", () => {
  it("uses only the four history commands with their explicit arguments", async () => {
    const gateway = new TauriRecentFilesGateway();
    await gateway.list();
    await gateway.remember("/notes/a.md");
    await gateway.forget("/notes/a.md");
    await gateway.relocate("/notes", "/archive");
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["list_recent_files"],
      ["remember_recent_file", { path: "/notes/a.md" }],
      ["forget_recent_file", { path: "/notes/a.md" }],
      ["relocate_recent_files", { previousPath: "/notes", nextPath: "/archive" }],
    ]);
  });

  it("offers an in-memory MRU for browser previews without invoking native", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    const gateway = new TauriRecentFilesGateway();
    await gateway.remember("/notes/a.md");
    await gateway.remember("/notes-other/b.png");
    await gateway.remember("/notes/a.md");
    const files = await gateway.relocate("/notes", "/renamed");
    expect(files.map((file) => file.path)).toEqual(["/renamed/a.md", "/notes-other/b.png"]);
    expect(files[0].name).toBe("a.md");
    expect((await gateway.forget("/renamed")).map((file) => file.path)).toEqual(["/notes-other/b.png"]);
    expect(await new TauriRecentFilesGateway().list()).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
