import { describe, expect, it } from "vitest";
import { SafeMarkdownRenderer } from "./markdown-renderer";

describe("SafeMarkdownRenderer", () => {
  const renderer = new SafeMarkdownRenderer();

  it("renders common markdown and task lists", () => {
    const result = renderer.render(
      "# mardi\n\n- [x] open a file\n\n```ts\nconst ready = true\n```",
    );

    const host = document.createElement("div");
    host.innerHTML = result.html;
    expect(host.querySelector("h1")?.textContent).toBe("mardi");
    expect(result.html).toContain('type="checkbox"');
    expect(result.html).toContain("hljs-keyword");
  });

  it("marks only rendered text as selectable highlight content", () => {
    const result = renderer.render("first paragraph\n\n## Second heading");
    const host = document.createElement("div");
    host.innerHTML = result.html;

    expect(
      Array.from(host.querySelectorAll(".markdown-text"), (element) =>
        element.textContent,
      ),
    ).toEqual(["first paragraph", "Second heading"]);
    expect(host.textContent).toBe("first paragraph\nSecond heading\n");
    expect(
      Array.from(host.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .every((node) => !/\S/u.test(node.textContent ?? "")),
    ).toBe(true);
  });

  it("removes executable HTML", () => {
    const result = renderer.render(
      '<script>alert("no")</script>\n\n[unsafe](javascript:alert(1))',
    );

    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain('href="javascript:');
  });

  it("marks relative images for local loading", () => {
    const result = renderer.render("![cover](./assets/cover.png)");
    const secondResult = renderer.render("![other](./assets/other.png)");

    expect(result.localImageSources).toEqual(["./assets/cover.png"]);
    expect(result.html).toContain('data-local-image="./assets/cover.png"');
    expect(secondResult.localImageSources).toEqual(["./assets/other.png"]);
  });
});
