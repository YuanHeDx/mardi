import { describe, expect, it } from "vitest";
import {
  documentReducer,
  getDocumentStats,
  initialDocumentSession,
  isDocumentDirty,
} from "./document";

describe("document session", () => {
  it("tracks loaded, edited, and saved content", () => {
    const loaded = documentReducer(initialDocumentSession, {
      type: "loaded",
      document: { path: "/notes/a.md", name: "a.md", content: "Hello" },
    });
    expect(isDocumentDirty(loaded)).toBe(false);

    const edited = documentReducer(loaded, {
      type: "contentChanged",
      content: "Hello mardi",
    });
    expect(isDocumentDirty(edited)).toBe(true);

    const saved = documentReducer(edited, {
      type: "saveCompleted",
      content: "Hello mardi",
    });
    expect(isDocumentDirty(saved)).toBe(false);
  });

  it("only marks the exact written snapshot as saved", () => {
    const loaded = documentReducer(initialDocumentSession, {
      type: "loaded",
      document: { path: "/notes/a.md", name: "a.md", content: "saved" },
    });
    const saving = documentReducer(loaded, {
      type: "contentChanged",
      content: "first edit",
    });
    const editedAgain = documentReducer(saving, {
      type: "contentChanged",
      content: "newer edit",
    });
    const completed = documentReducer(editedAgain, {
      type: "saveCompleted",
      content: "first edit",
    });

    expect(completed.savedContent).toBe("first edit");
    expect(completed.document?.content).toBe("newer edit");
    expect(isDocumentDirty(completed)).toBe(true);
  });

  it("refreshes a clean document from disk without leaving preview mode", () => {
    const loaded = documentReducer(initialDocumentSession, {
      type: "loaded",
      document: { path: "/notes/a.md", name: "a.md", content: "old" },
    });
    const refreshed = documentReducer(loaded, {
      type: "refreshed",
      document: { path: "/notes/a.md", name: "a.md", content: "new" },
    });

    expect(refreshed.document?.content).toBe("new");
    expect(refreshed.savedContent).toBe("new");
    expect(refreshed.mode).toBe("preview");
    expect(isDocumentDirty(refreshed)).toBe(false);
  });

  it("keeps unsaved content and mode when the file is renamed", () => {
    const loaded = documentReducer(initialDocumentSession, {
      type: "loaded",
      document: {
        path: "/notes/old.md",
        name: "old.md",
        content: "saved",
      },
    });
    const editing = documentReducer(
      documentReducer(loaded, { type: "contentChanged", content: "draft" }),
      { type: "modeChanged", mode: "edit" },
    );
    const relocated = documentReducer(editing, {
      type: "relocated",
      path: "/notes/new.md",
      name: "new.md",
    });

    expect(relocated.document).toEqual({
      path: "/notes/new.md",
      name: "new.md",
      content: "draft",
    });
    expect(relocated.savedContent).toBe("saved");
    expect(relocated.mode).toBe("edit");
    expect(isDocumentDirty(relocated)).toBe(true);
  });

  it("keeps unsaved content but blocks the stale path after external deletion", () => {
    const loaded = documentReducer(initialDocumentSession, {
      type: "loaded",
      document: { path: "/notes/a.md", name: "a.md", content: "saved" },
    });
    const edited = documentReducer(loaded, {
      type: "contentChanged",
      content: "draft",
    });
    const missing = documentReducer(edited, {
      type: "missing",
      message: "原文件已删除",
    });
    const editedAgain = documentReducer(missing, {
      type: "contentChanged",
      content: "draft 2",
    });

    expect(editedAgain.document?.content).toBe("draft 2");
    expect(editedAgain.document?.path).toBe("/notes/a.md");
    expect(editedAgain.isMissing).toBe(true);
    expect(editedAgain.error).toBe("原文件已删除");
    expect(isDocumentDirty(editedAgain)).toBe(true);
  });

  it("counts lines and mixed-language words", () => {
    expect(getDocumentStats("Hello world\n你好")).toEqual({
      words: 4,
      lines: 2,
    });
  });

  it("clears a document before switching to media", () => {
    const loaded = documentReducer(initialDocumentSession, {
      type: "loaded",
      document: { path: "/notes/a.md", name: "a.md", content: "Hello" },
    });

    expect(documentReducer(loaded, { type: "cleared" })).toEqual(
      initialDocumentSession,
    );
  });
});
