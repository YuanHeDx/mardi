import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauriRuntime } from "./runtime";
import { TauriMediaGateway } from "./media-gateway";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: vi.fn((path: string) => `asset:${path}`) }));
vi.mock("./runtime", () => ({ isTauriRuntime: vi.fn(() => true) }));
beforeEach(() => { vi.mocked(invoke).mockReset(); vi.mocked(convertFileSrc).mockClear(); vi.mocked(isTauriRuntime).mockReturnValue(true); });

describe("media native authorization boundary", () => {
  it("waits for the exact-file grant before converting the returned canonical path", async () => {
    let grant!: (path: string) => void;
    vi.mocked(invoke).mockReturnValue(new Promise<string>((resolve) => { grant = resolve; }));
    const pending = new TauriMediaGateway().prepareSource("/tmp/alias.png");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("prepare_media_source", { path: "/tmp/alias.png" });
    expect(convertFileSrc).not.toHaveBeenCalled();
    grant("/private/tmp/real.png");
    expect(await pending).toBe("asset:/private/tmp/real.png");
    expect(convertFileSrc).toHaveBeenCalledExactlyOnceWith("/private/tmp/real.png");
  });
  it("never publishes an asset URL if native validation/authorization fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("unsupported media"));
    await expect(new TauriMediaGateway().prepareSource("/tmp/unsafe.svg")).rejects.toThrow("unsupported media");
    expect(convertFileSrc).not.toHaveBeenCalled();
  });
  it("keeps browser preview paths without an IPC grant", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    expect(await new TauriMediaGateway().prepareSource("/demo.png")).toBe("/demo.png");
    expect(invoke).not.toHaveBeenCalled();
  });
});
