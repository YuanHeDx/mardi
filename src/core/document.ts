export type DocumentMode = "preview" | "edit";

export interface DocumentSnapshot {
  path: string;
  name: string;
  content: string;
}

export interface DocumentSession {
  document: DocumentSnapshot | null;
  savedContent: string;
  mode: DocumentMode;
  isSaving: boolean;
  error: string | null;
}

export type DocumentAction =
  | { type: "loaded"; document: DocumentSnapshot }
  | { type: "relocated"; path: string; name: string }
  | { type: "cleared" }
  | { type: "contentChanged"; content: string }
  | { type: "modeChanged"; mode: DocumentMode }
  | { type: "saveStarted" }
  | { type: "saveCompleted" }
  | { type: "failed"; message: string }
  | { type: "dismissedError" };

export const initialDocumentSession: DocumentSession = {
  document: null,
  savedContent: "",
  mode: "preview",
  isSaving: false,
  error: null,
};

export function documentReducer(
  state: DocumentSession,
  action: DocumentAction,
): DocumentSession {
  switch (action.type) {
    case "loaded":
      return {
        document: action.document,
        savedContent: action.document.content,
        mode: "preview",
        isSaving: false,
        error: null,
      };
    case "relocated":
      if (!state.document) return state;
      return {
        ...state,
        document: {
          ...state.document,
          path: action.path,
          name: action.name,
        },
        error: null,
      };
    case "cleared":
      return initialDocumentSession;
    case "contentChanged":
      if (!state.document) return state;
      return {
        ...state,
        document: { ...state.document, content: action.content },
        error: null,
      };
    case "modeChanged":
      return { ...state, mode: action.mode };
    case "saveStarted":
      return { ...state, isSaving: true, error: null };
    case "saveCompleted":
      return {
        ...state,
        savedContent: state.document?.content ?? state.savedContent,
        isSaving: false,
        error: null,
      };
    case "failed":
      return { ...state, isSaving: false, error: action.message };
    case "dismissedError":
      return { ...state, error: null };
  }
}

export function isDocumentDirty(session: DocumentSession): boolean {
  return Boolean(
    session.document && session.document.content !== session.savedContent,
  );
}

export function getDocumentStats(content: string): {
  words: number;
  lines: number;
} {
  const trimmed = content.trim();
  const latinWords =
    trimmed.match(/[\p{Script=Latin}\p{N}_'-]+/gu)?.length ?? 0;
  const cjkCharacters = trimmed.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;

  return {
    words: latinWords + cjkCharacters,
    lines: content.length === 0 ? 0 : content.split(/\r\n|\r|\n/).length,
  };
}
