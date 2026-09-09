import { describe, expect, it } from "vitest";
import {
  rangeBetweenBoundaries,
  selectionBoundaryFromPoint,
  trimRangeWhitespace,
} from "./preview-selection";

describe("preview selection", () => {
  it("trims line-boundary whitespace from the visible selection", () => {
    const root = document.createElement("article");
    root.innerHTML = "<p>上一行</p>\n<p>  当前一行  </p>\n<p>下一行</p>";
    document.body.append(root);
    const current = root.querySelectorAll("p")[1].firstChild as Text;
    const range = document.createRange();
    range.setStart(current, 0);
    range.setEnd(current, current.data.length);

    const trimmed = trimRangeWhitespace(range, root);

    expect(trimmed.toString()).toBe("当前一行");
    expect(range.toString()).toBe("  当前一行  ");
    root.remove();
  });

  it("drops an empty boundary anchored at the end of the previous line", () => {
    const root = document.createElement("article");
    root.innerHTML = "<p>上一行</p><p>当前一行</p>";
    document.body.append(root);
    const paragraphs = root.querySelectorAll("p");
    const previous = paragraphs[0].firstChild as Text;
    const current = paragraphs[1].firstChild as Text;
    const range = document.createRange();
    range.setStart(previous, previous.data.length);
    range.setEnd(current, current.data.length);

    expect(trimRangeWhitespace(range, root).toString()).toBe("当前一行");
    root.remove();
  });

  it("keeps intentional content between different lines", () => {
    const root = document.createElement("article");
    root.innerHTML = "<p>第一行</p>\n<p>第二行</p>\n<p>第三行</p>";
    document.body.append(root);
    const paragraphs = root.querySelectorAll("p");
    const first = paragraphs[0].firstChild as Text;
    const third = paragraphs[2].firstChild as Text;
    const range = document.createRange();
    range.setStart(first, 1);
    range.setEnd(third, 2);

    expect(trimRangeWhitespace(range, root).toString()).toBe(
      "一行\n第二行\n第三",
    );
    root.remove();
  });

  it("clamps a misplaced caret to the block under the mouse", () => {
    const root = document.createElement("article");
    root.innerHTML = "<ul><li>上一行</li><li>当前一行</li></ul>";
    document.body.append(root);
    const items = root.querySelectorAll("li");
    const previous = items[0].firstChild as Text;
    const current = items[1].firstChild as Text;
    const misplaced = document.createRange();
    misplaced.setStart(previous, previous.data.length);
    misplaced.collapse(true);
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: () => misplaced,
    });
    items[1].getBoundingClientRect = () =>
      ({ left: 100, width: 200 }) as DOMRect;

    const boundary = selectionBoundaryFromPoint(
      document,
      root,
      items[1],
      110,
      20,
    );

    expect(boundary).toEqual({ node: current, offset: 0 });
    Reflect.deleteProperty(document, "caretRangeFromPoint");
    root.remove();
  });

  it("finds a rendered text boundary when caret APIs return no position", () => {
    const root = document.createElement("article");
    root.innerHTML = "<ul><li>alpha</li></ul>";
    document.body.append(root);
    const item = root.querySelector("li") as HTMLLIElement;
    const text = item.firstChild as Text;
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: () => null,
    });
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: function (this: Range) {
        const rect = {
          left: 100 + this.startOffset * 10,
          right: 110 + this.startOffset * 10,
          top: 0,
          bottom: 20,
          width: 10,
          height: 20,
        } as DOMRect;
        return {
          0: rect,
          length: 1,
          item: (index: number) => (index === 0 ? rect : null),
          [Symbol.iterator]: function* () {
            yield rect;
          },
        } as DOMRectList;
      },
    });

    const boundary = selectionBoundaryFromPoint(
      document,
      root,
      item,
      126,
      10,
    );

    expect(boundary).toEqual({ node: text, offset: 3 });
    Reflect.deleteProperty(Range.prototype, "getClientRects");
    Reflect.deleteProperty(document, "caretRangeFromPoint");
    root.remove();
  });

  it("orders backwards drag boundaries", () => {
    const root = document.createElement("p");
    root.textContent = "alpha beta gamma";
    document.body.append(root);
    const text = root.firstChild as Text;
    const range = rangeBetweenBoundaries(
      document,
      { node: text, offset: 10 },
      { node: text, offset: 6 },
    );

    expect(range?.toString()).toBe("beta");
    root.remove();
  });
});
