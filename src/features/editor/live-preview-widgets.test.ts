import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { documentGateway } from "../../infrastructure/tauri/document-gateway";
import { ImageWidget, imageRequest } from "./live-preview-widgets";

vi.mock("../../infrastructure/tauri/runtime", () => ({ isTauriRuntime: () => true }));
vi.mock("../../infrastructure/tauri/document-gateway", () => ({ documentGateway: { readLocalImage: vi.fn() } }));
afterEach(() => { document.body.replaceChildren(); vi.mocked(documentGateway.readLocalImage).mockReset(); });

describe("authorized image widget lifecycle", () => {
  it("deduplicates requests in the same document and scopes authority by path/root/generation", async () => {
    vi.mocked(documentGateway.readLocalImage).mockResolvedValue("data:image/png;base64,a");
    const context = { generation: 101, documentPath: "/notes/a.md", workspaceRoot: "/notes" };
    const first = imageRequest(context, "same.png");
    expect(imageRequest(context, "same.png")).toBe(first);
    await first;
    expect(documentGateway.readLocalImage).toHaveBeenCalledTimes(1);
    await imageRequest({ ...context, documentPath: "/elsewhere/renamed.md" }, "same.png");
    expect(documentGateway.readLocalImage).toHaveBeenLastCalledWith("/elsewhere/renamed.md", "same.png", "/notes");
    expect(documentGateway.readLocalImage).toHaveBeenCalledTimes(2);
  });

  it("does not mutate a removed widget when the previous document's image resolves", async () => {
    let resolve!: (value: string) => void;
    vi.mocked(documentGateway.readLocalImage).mockReturnValue(new Promise<string>((yes) => { resolve = yes; }));
    const view = new EditorView({ state: EditorState.create({ doc: "image" }) });
    const widget = new ImageWidget("late.png", "old document", { generation: 102, documentPath: "/notes/old.md", workspaceRoot: "/notes" });
    const dom = widget.toDOM(view);
    document.body.append(dom);
    widget.destroy(dom); dom.remove();
    await Promise.resolve();
    resolve("data:image/png;base64,a");
    await Promise.resolve();
    expect(dom.querySelector("img")?.getAttribute("src")).toBeNull();
    view.destroy();
  });

  it("updates alt text without replacing an already loaded image DOM", async () => {
    vi.mocked(documentGateway.readLocalImage).mockResolvedValue("data:image/png;base64,a");
    const view = new EditorView({ state: EditorState.create({ doc: "image" }) });
    const context = { generation: 103, documentPath: "/notes/a.md", workspaceRoot: "/notes" };
    const original = new ImageWidget("cat.png", "old alt", context);
    const dom = original.toDOM(view); document.body.append(dom);
    const image = dom.querySelector("img");
    expect(new ImageWidget("cat.png", "new alt", context).updateDOM(dom)).toBe(true);
    expect(dom.querySelector("img")).toBe(image);
    expect(image?.alt).toBe("new alt");
    original.destroy(dom); view.destroy();
  });

  it("degrades synchronous gateway/URL decoding failures to the image placeholder", async () => {
    vi.mocked(documentGateway.readLocalImage).mockImplementation(() => { throw new URIError("malformed percent encoding"); });
    const view = new EditorView({ state: EditorState.create({ doc: "image" }) });
    const widget = new ImageWidget("bad%zz.png", "keep the source", { generation: 105, documentPath: "/notes/a.md", workspaceRoot: "/notes" });
    const dom = widget.toDOM(view);
    document.body.append(dom);
    await vi.waitFor(() => expect(dom.textContent).toContain("图片无法显示"));
    expect(dom.querySelector(".cm-image-label")?.textContent).toBe("keep the source");
    widget.destroy(dom); view.destroy();
  });

  it("rejects remote and unsafe schemes without calling the filesystem gateway", async () => {
    const context = { generation: 104, documentPath: "/notes/a.md", workspaceRoot: "/notes" };
    await expect(imageRequest(context, "https://example.com/cat.png")).rejects.toThrow();
    await expect(imageRequest(context, "file:///etc/passwd")).rejects.toThrow();
    expect(documentGateway.readLocalImage).not.toHaveBeenCalled();
  });
});
