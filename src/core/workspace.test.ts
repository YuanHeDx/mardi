import { describe, expect, it } from "vitest";
import {
  fileKindFromPath,
  fileNameParts,
  findRootPathForFile,
  flattenMarkdownFiles,
  isPathWithinRoot,
  setDirectoryExpanded,
  viewStateForProject,
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
      collapsedPaths: [],
    }));

    expect(isPathWithinRoot("/notes/a.md", "/notes")).toBe(true);
    expect(isPathWithinRoot("/notes-old/a.md", "/notes")).toBe(false);
    expect(findRootPathForFile(roots, "/notes/work/a.md")).toBe("/notes/work");
  });

  it("splits the editable file stem from its fixed extension", () => {
    expect(fileNameParts("draft.notes.markdown")).toEqual({
      stem: "draft.notes",
      extension: ".markdown",
    });
    expect(fileNameParts("README")).toEqual({ stem: "README", extension: "" });
  });

  it("restores saved project view state and migrates old roots", () => {
    expect(
      viewStateForProject(
        { rootPath: "/old", name: "old", lastOpenedAt: 1 },
        true,
      ),
    ).toEqual({ isExpanded: true, collapsedPaths: [] });

    const saved = {
      isExpanded: false,
      collapsedPaths: ["/notes/archive"],
    };
    expect(
      viewStateForProject({
        rootPath: "/notes",
        name: "notes",
        lastOpenedAt: 2,
        viewState: saved,
      }),
    ).toBe(saved);
  });

  it("tracks collapsed directories without duplicates", () => {
    expect(setDirectoryExpanded([], "/notes/archive", false)).toEqual([
      "/notes/archive",
    ]);
    expect(
      setDirectoryExpanded(["/notes/archive"], "/notes/archive", false),
    ).toEqual(["/notes/archive"]);
    expect(
      setDirectoryExpanded(["/notes/archive"], "/notes/archive", true),
    ).toEqual([]);
  });
});
