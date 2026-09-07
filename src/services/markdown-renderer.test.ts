import { describe, expect, it } from "vitest";
import { SafeMarkdownRenderer } from "./markdown-renderer";

describe("SafeMarkdownRenderer", () => {
  const renderer = new SafeMarkdownRenderer();

  it("renders common markdown and task lists", () => {
    const result = renderer.render(
      "# mardi\n\n- [x] open a file\n\n```ts\nconst ready = true\n```",
    );

    expect(result.html).toContain("<h1>mardi</h1>");
    expect(result.html).toContain('type="checkbox"');
    expect(result.html).toContain("hljs-keyword");
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
