import { describe, expect, it } from "vitest";
import {
  fileKindFromPath,
  findRootPathForFile,
  flattenMarkdownFiles,
  isPathWithinRoot,
  type RootWorkspace,
  type WorkspaceEntry,
} from "./workspace";

describe("workspace models", () => {
  it("recognizes the supported preview file types", () => {
    expect(fileKindFromPath("README.MD")).toBe("markdown");
    expect(fileKindFromPath("cover.avif")).toBe("image");
    expect(fileKindFromPath("demo.MOV")).toBe("video");
    expect(fileKindFromPath("unsafe.svg")).toBeNull();
    expect(fileKindFromPath("archive.zip")).toBeNull();
  });

  it("flattens Markdown files without returning media", () => {
    const entries: WorkspaceEntry[] = [
      {
        path: "/root/cover.png",
        name: "cover.png",
        kind: "image",
        children: [],
      },
      {
        path: "/root/notes",
        name: "notes",
        kind: "directory",
        children: [
          {
            path: "/root/notes/a.md",
            name: "a.md",
            kind: "markdown",
            children: [],
          },
        ],
      },
    ];

    expect(flattenMarkdownFiles(entries).map((entry) => entry.path)).toEqual([
      "/root/notes/a.md",
    ]);
  });

  it("matches path boundaries and chooses the closest nested root", () => {
    const roots = ["/notes", "/notes/work"].map<RootWorkspace>((rootPath) => ({
      root: { rootPath, name: rootPath, lastOpenedAt: 1 },
      entries: null,
      isExpanded: false,
      isLoading: false,
      isTruncated: false,
      error: null,
    }));

    expect(isPathWithinRoot("/notes/a.md", "/notes")).toBe(true);
    expect(isPathWithinRoot("/notes-old/a.md", "/notes")).toBe(false);
    expect(findRootPathForFile(roots, "/notes/work/a.md")).toBe("/notes/work");
  });
});
