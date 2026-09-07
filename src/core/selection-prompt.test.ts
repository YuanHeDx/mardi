import { describe, expect, it } from "vitest";
import { buildAnnotationPrompt, buildReferencePrompt } from "./selection-prompt";

describe("selection prompts", () => {
  const selection = {
    filePath: "/Users/example/notes/plan.md",
    selectedText: "Ship the smallest useful slice.",
  };

  it("builds an AI-friendly reference with path and selected content", () => {
    const prompt = buildReferencePrompt(selection);
    expect(prompt).toContain("<file_path>\n/Users/example/notes/plan.md\n</file_path>");
    expect(prompt).toContain(
      "<selected_content>\nShip the smallest useful slice.\n</selected_content>",
    );
    expect(prompt).not.toContain("<annotation>");
  });

  it("adds the user's annotation to the selection context", () => {
    const prompt = buildAnnotationPrompt({
      ...selection,
      annotation: "改写得更具体，并给出两个例子。",
    });
    expect(prompt).toContain("文件绝对路径");
    expect(prompt).toContain("选中的内容");
    expect(prompt).toContain(
      "<annotation>\n改写得更具体，并给出两个例子。\n</annotation>",
    );
  });
});
