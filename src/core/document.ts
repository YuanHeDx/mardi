export interface DocumentSnapshot {
  path: string;
  name: string;
  content: string;
  fileId?: string | null;
}

export interface DocumentSession {
  document: DocumentSnapshot | null;
  savedContent: string;
  loadGeneration: number;
  externalRevision: number;
  isSaving: boolean;
  isMissing: boolean;
  error: string | null;
}

export type DocumentAction =
  | { type: "loaded"; document: DocumentSnapshot }
  | { type: "refreshed"; document: DocumentSnapshot }
  | { type: "relocated"; path: string; name: string; fileId?: string | null }
  | { type: "missing"; message: string }
  | { type: "cleared" }
  | { type: "contentChanged"; content: string }
  | { type: "saveStarted"; generation: number }
  | { type: "saveCompleted"; content: string; generation: number }
  | { type: "failed"; message: string }
  | { type: "dismissedError" };

export const initialDocumentSession: DocumentSession = {
  document: null,
  savedContent: "",
  loadGeneration: 0,
  externalRevision: 0,
  isSaving: false,
  isMissing: false,
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
        loadGeneration: state.loadGeneration + 1,
        externalRevision: 0,
        isSaving: false,
        isMissing: false,
        error: null,
      };
    case "refreshed":
      if (!state.document || state.document.path !== action.document.path) {
        return state;
      }
      return {
        ...state,
        document: action.document,
        savedContent: action.document.content,
        externalRevision: state.externalRevision + 1,
        isMissing: false,
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
          fileId: action.fileId ?? state.document.fileId,
        },
        isMissing: false,
        error: null,
      };
    case "missing":
      if (!state.document) return state;
      return {
        ...state,
        isSaving: false,
        isMissing: true,
        error: action.message,
      };
    case "cleared":
      return { ...initialDocumentSession, loadGeneration: state.loadGeneration + 1 };
    case "contentChanged":
      if (!state.document) return state;
      return {
        ...state,
        document: { ...state.document, content: action.content },
        error: state.isMissing ? state.error : null,
      };
    case "saveStarted":
      if (state.loadGeneration !== action.generation) return state;
      return { ...state, isSaving: true, error: null };
    case "saveCompleted":
      if (state.loadGeneration !== action.generation) return state;
      return {
        ...state,
        savedContent: action.content,
        isSaving: false,
        error: state.isMissing ? state.error : null,
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
