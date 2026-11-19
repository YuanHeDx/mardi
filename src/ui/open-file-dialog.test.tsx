import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAbsoluteFilePath, OpenFileDialog } from "./open-file-dialog";

describe("OpenFileDialog", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("recognizes absolute paths across supported desktop platforms", () => {
    expect(isAbsoluteFilePath("/Users/me/notes.md")).toBe(true);
    expect(isAbsoluteFilePath("C:\\notes\\today.md")).toBe(true);
    expect(isAbsoluteFilePath("notes/today.md")).toBe(false);
  });

  it("opens a supported absolute path", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onCancel = vi.fn();
    const onOpenPath = vi.fn(async () => true);

    flushSync(() => {
      root.render(
        <OpenFileDialog
          onCancel={onCancel}
          onChooseFile={async () => false}
          onOpenPath={onOpenPath}
        />,
      );
    });

    const input = host.querySelector("input") as HTMLInputElement;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "/Users/me/notes.md");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => {
      (host.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    await vi.waitFor(() => {
      expect(onOpenPath).toHaveBeenCalledWith("/Users/me/notes.md");
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
    root.unmount();
  });

  it("keeps the dialog open for a relative path", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onOpenPath = vi.fn(async () => true);

    flushSync(() => {
      root.render(
        <OpenFileDialog
          onCancel={() => undefined}
          onChooseFile={async () => false}
          onOpenPath={onOpenPath}
        />,
      );
    });

    const input = host.querySelector("input") as HTMLInputElement;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "notes.md");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (host.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onOpenPath).not.toHaveBeenCalled();
    expect(host.textContent).toContain("请输入以 / 开头的绝对路径");
    root.unmount();
  });
});
