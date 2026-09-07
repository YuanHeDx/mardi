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

    const saved = documentReducer(edited, { type: "saveCompleted" });
    expect(isDocumentDirty(saved)).toBe(false);
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
