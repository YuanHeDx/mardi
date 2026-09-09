import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./markdown-preview";

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

describe("MarkdownPreview selection reporting", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
    Reflect.deleteProperty(Range.prototype, "getClientRects");
    Reflect.deleteProperty(document, "caretRangeFromPoint");
    Reflect.deleteProperty(document, "elementFromPoint");
    vi.restoreAllMocks();
  });

  it("controls the drag selection but waits until mouseup to report it", async () => {
    const rect = {
      left: 120,
      right: 240,
      top: 80,
      bottom: 100,
      width: 120,
      height: 20,
      x: 120,
      y: 80,
      toJSON: () => ({}),
    } as DOMRect;
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () =>
        ({
          0: rect,
          length: 1,
          item: (index: number) => (index === 0 ? rect : null),
          [Symbol.iterator]: function* () {
            yield rect;
          },
        }) as DOMRectList,
    });

    const host = document.createElement("div");
    document.body.append(host);
    const onTextSelection = vi.fn();
    const root = createRoot(host);
    flushSync(() => {
      root.render(
        <MarkdownPreview
          content={"first line\n\nsecond line"}
          document={null}
          onTextSelection={onTextSelection}
          workspaceRoot={null}
        />,
      );
    });

    const secondLine = host.querySelectorAll("p")[1].firstChild as Text;
    const selection = window.getSelection() as Selection;
    const removeAllRanges = vi.spyOn(selection, "removeAllRanges");
    const addRange = vi.spyOn(selection, "addRange");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => secondLine.parentElement,
    });
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: (x: number) => {
        const range = document.createRange();
        const offset = x < 160 ? 0 : secondLine.data.length;
        range.setStart(secondLine, offset);
        range.collapse(true);
        return range;
      },
    });

    secondLine.parentElement?.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 120,
        clientY: 90,
        detail: 1,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 200, clientY: 90 }),
    );
    await nextAnimationFrame();

    document.dispatchEvent(new Event("selectionchange"));
    await nextAnimationFrame();
    expect(onTextSelection).toHaveBeenCalledTimes(1);
    expect(onTextSelection).toHaveBeenLastCalledWith(null);
    expect(selection.toString()).toBe("second line");

    window.dispatchEvent(
      new MouseEvent("mouseup", { clientX: 200, clientY: 90 }),
    );
    await nextAnimationFrame();
    expect(onTextSelection).toHaveBeenLastCalledWith({
      text: "second line",
      anchor: { x: 180, top: 80, bottom: 100 },
    });
    expect(removeAllRanges).toHaveBeenCalled();
    expect(addRange).toHaveBeenCalled();

    flushSync(() => {
      root.render(
        <MarkdownPreview
          content={"first line\n\nsecond line"}
          document={null}
          onTextSelection={onTextSelection}
          workspaceRoot={null}
        />,
      );
    });
    expect(selection.toString()).toBe("second line");

    flushSync(() => root.unmount());
  });
});
