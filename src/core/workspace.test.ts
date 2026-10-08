import { describe, expect, it } from "vitest";
import {
  fileKindFromPath,
  filterWorkspaceEntries,
  fileNameParts,
  findRootPathForFile,
  flattenMarkdownFiles,
  isPathWithinRoot,
  replacePathPrefix,
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

  it("filters file names while preserving matching directory ancestors", () => {
    const entries: WorkspaceEntry[] = [
      {
        path: "/root/drafts",
        name: "drafts",
        kind: "directory",
        children: [
          {
            path: "/root/drafts/Meeting Notes.md",
            name: "Meeting Notes.md",
            kind: "markdown",
            children: [],
          },
          {
            path: "/root/drafts/plan.md",
            name: "plan.md",
            kind: "markdown",
            children: [],
          },
        ],
      },
      {
        path: "/root/readme.md",
        name: "readme.md",
        kind: "markdown",
        children: [],
      },
    ];

    const filtered = filterWorkspaceEntries(entries, "meeting");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("drafts");
    expect(filtered[0]?.children.map((entry) => entry.name)).toEqual([
      "Meeting Notes.md",
    ]);
    expect(entries[0]?.children).toHaveLength(2);
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

  it("moves an entry path and all descendant paths to a renamed folder", () => {
    expect(
      replacePathPrefix(
        "/notes/archive/2026/plan.md",
        "/notes/archive",
        "/notes/history",
      ),
    ).toBe("/notes/history/2026/plan.md");
    expect(
      replacePathPrefix(
        "/notes/archive-old/plan.md",
        "/notes/archive",
        "/notes/history",
      ),
    ).toBe("/notes/archive-old/plan.md");
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
