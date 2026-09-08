import { describe, expect, it } from "vitest";
import {
  rangeBetweenBoundaries,
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

    expect(trimRangeWhitespace(range, root).toString()).toBe("当前一行");
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

  it("orders backwards drag boundaries without adding adjacent lines", () => {
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
