import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaContent } from "../core/workspace";
import { mediaGateway } from "../infrastructure/tauri/media-gateway";
import { MediaPreview } from "./media-preview";

vi.mock("../infrastructure/tauri/media-gateway", () => ({ mediaGateway: { prepareSource: vi.fn() } }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: Root;
let host: HTMLElement;
const media: MediaContent = { openGeneration: 1, path: "/tmp/image.png", name: "image.png", kind: "image", rootPath: null };
const render = (value: MediaContent = media) => flushSync(() => root.render(<MediaPreview media={value} />));
beforeEach(() => {
  vi.mocked(mediaGateway.prepareSource).mockReset();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("media preview request lifecycle", () => {
  it("does not request an image URL before the authorization promise succeeds", async () => {
    const request = deferred<string>();
    vi.mocked(mediaGateway.prepareSource).mockReturnValue(request.promise);
    render();
    expect(host.querySelector("img")).toBeNull();
    request.resolve("asset://canonical.png");
    await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toBe("asset://canonical.png?mardi-open=1"));
    flushSync(() => host.querySelector("img")!.dispatchEvent(new Event("load")));
    expect(host.querySelector(".media-preview")?.getAttribute("aria-busy")).toBe("false");
  });
  it("retries the same failed path as a fresh explicit open", async () => {
    vi.mocked(mediaGateway.prepareSource).mockRejectedValueOnce(new Error("first grant failed")).mockResolvedValue("asset://canonical.png");
    render();
    await vi.waitFor(() => expect(host.textContent).toContain("first grant failed"));
    render({ ...media, openGeneration: 2 });
    await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toBe("asset://canonical.png?mardi-open=2"));
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(mediaGateway.prepareSource).toHaveBeenCalledTimes(2);
    flushSync(() => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.querySelector("[role=alert]")).not.toBeNull();
    render({ ...media, openGeneration: 3 });
    await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toBe("asset://canonical.png?mardi-open=3"));
    expect(host.querySelector("[role=alert]")).toBeNull();
  });
  it("ignores a previous media file's delayed authorization result", async () => {
    const old = deferred<string>();
    vi.mocked(mediaGateway.prepareSource).mockReturnValueOnce(old.promise).mockResolvedValue("asset://new.png");
    render();
    await vi.waitFor(() => expect(mediaGateway.prepareSource).toHaveBeenCalledTimes(1));
    render({ ...media, openGeneration: 2, path: "/tmp/new.png", name: "new.png" });
    await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toBe("asset://new.png?mardi-open=2"));
    old.resolve("asset://old.png");
    await Promise.resolve();
    expect(host.querySelector("img")?.getAttribute("src")).toBe("asset://new.png?mardi-open=2");
  });
  it("ignores an old rejection after switching files", async () => {
    const old = deferred<string>();
    vi.mocked(mediaGateway.prepareSource).mockReturnValueOnce(old.promise).mockResolvedValue("asset://new.png");
    render();
    await vi.waitFor(() => expect(mediaGateway.prepareSource).toHaveBeenCalledTimes(1));
    render({ ...media, openGeneration: 2, path: "/tmp/new.png" });
    await vi.waitFor(() => expect(host.querySelector("img")).not.toBeNull());
    old.reject(new Error("old media failed"));
    await Promise.resolve();
    expect(host.querySelector("[role=alert]")).toBeNull();
  });
  it("prepares a video through the same boundary and pauses it on leave", async () => {
    vi.mocked(mediaGateway.prepareSource).mockResolvedValue("asset://movie.mov");
    render({ ...media, kind: "video", path: "/tmp/movie.mov" });
    await vi.waitFor(() => expect(host.querySelector("video")).not.toBeNull());
    const video = host.querySelector("video")!;
    flushSync(() => video.dispatchEvent(new Event("loadedmetadata")));
    expect(host.querySelector(".media-preview")?.getAttribute("aria-busy")).toBe("false");
    render({ ...media, openGeneration: 2 });
    expect(video.pause).toHaveBeenCalled();
  });
});
