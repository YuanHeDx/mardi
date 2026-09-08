import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  documentReducer,
  initialDocumentSession,
  isDocumentDirty,
  type DocumentSnapshot,
} from "../../core/document";
import { documentGateway } from "../../infrastructure/tauri/document-gateway";
import { isTauriRuntime, messageFromError } from "../../infrastructure/tauri/runtime";

export function useDocumentSession(initialDocument?: DocumentSnapshot) {
  const [session, dispatch] = useReducer(
    documentReducer,
    initialDocument
      ? documentReducer(initialDocumentSession, {
          type: "loaded",
          document: initialDocument,
        })
      : initialDocumentSession,
  );
  const dirty = isDocumentDirty(session);
  const dirtyRef = useRef(dirty);
  const sessionRef = useRef(session);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));

  useLayoutEffect(() => {
    dirtyRef.current = dirty;
    sessionRef.current = session;
  }, [dirty, session]);

  const canDiscardChanges = useCallback(() => {
    return (
      !dirtyRef.current ||
      window.confirm("当前修改尚未保存。要放弃这些修改吗？")
    );
  }, []);

  const save = useCallback((): Promise<boolean> => {
    if (!isTauriRuntime()) return Promise.resolve(true);

    const queuedSave = saveQueueRef.current
      .catch(() => false)
      .then(async () => {
        while (true) {
          const current = sessionRef.current;
          if (
            !current.document ||
            current.document.content === current.savedContent
          ) {
            return true;
          }

          const { path, content } = current.document;
          const saving = documentReducer(current, { type: "saveStarted" });
          sessionRef.current = saving;
          dispatch({ type: "saveStarted" });
          try {
            await documentGateway.writeDocument(path, content);
            const latest = sessionRef.current;
            const completed = documentReducer(latest, {
              type: "saveCompleted",
              content,
            });
            sessionRef.current = completed;
            dirtyRef.current = isDocumentDirty(completed);
            dispatch({ type: "saveCompleted", content });
          } catch (error) {
            const failed = documentReducer(sessionRef.current, {
              type: "failed",
              message: messageFromError(error),
            });
            sessionRef.current = failed;
            dirtyRef.current = isDocumentDirty(failed);
            dispatch({ type: "failed", message: failed.error ?? "保存失败" });
            return false;
          }
        }
      });
    saveQueueRef.current = queuedSave;
    return queuedSave;
  }, []);

  const openPath = useCallback(
    async (path: string) => {
      if (!(await save())) return false;
      try {
        const document = await documentGateway.readDocument(path);
        dispatch({ type: "loaded", document });
        return true;
      } catch (error) {
        dispatch({ type: "failed", message: messageFromError(error) });
        return false;
      }
    },
    [save],
  );

  const chooseFile = useCallback(async () => {
    try {
      return await documentGateway.chooseSupportedFile();
    } catch (error) {
      dispatch({ type: "failed", message: messageFromError(error) });
      return null;
    }
  }, []);

  const closeDocument = useCallback(async () => {
    if (!(await save())) return false;
    dispatch({ type: "cleared" });
    return true;
  }, [save]);

  const discardDocument = useCallback(() => {
    dispatch({ type: "cleared" });
  }, []);

  const relocateDocument = useCallback((path: string, name: string) => {
    dispatch({ type: "relocated", path, name });
  }, []);

  const refreshFromDisk = useCallback(async (path: string) => {
    const current = sessionRef.current;
    if (
      !current.document ||
      current.document.path !== path ||
      dirtyRef.current ||
      current.isSaving
    ) {
      return false;
    }

    try {
      const document = await documentGateway.readDocument(path);
      const latest = sessionRef.current;
      if (
        !latest.document ||
        latest.document.path !== path ||
        dirtyRef.current ||
        latest.isSaving
      ) {
        return false;
      }
      if (latest.document.content !== document.content) {
        dispatch({ type: "refreshed", document });
      }
      return true;
    } catch (error) {
      dispatch({ type: "failed", message: messageFromError(error) });
      return false;
    }
  }, []);

  const setContent = useCallback((content: string) => {
    const current = sessionRef.current;
    if (!current.document) return;
    sessionRef.current = {
      ...current,
      document: { ...current.document, content },
    };
    dirtyRef.current = content !== current.savedContent;
    dispatch({ type: "contentChanged", content });
  }, []);

  useEffect(() => {
    if (!dirty || !session.document || !isTauriRuntime()) return;
    const timeout = window.setTimeout(() => void save(), 400);
    return () => window.clearTimeout(timeout);
  }, [dirty, save, session.document]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [save]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;

    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const currentWindow = getCurrentWindow();
      return currentWindow
        .onCloseRequested(async (event) => {
          if (dirtyRef.current) {
            event.preventDefault();
            if (await save()) await currentWindow.destroy();
          }
        })
        .then((stopListening) => {
          unlisten = stopListening;
        });
    });

    return () => unlisten?.();
  }, [save]);

  return {
    session,
    dirty,
    chooseFile,
    openPath,
    closeDocument,
    discardDocument,
    relocateDocument,
    refreshFromDisk,
    confirmDiscardChanges: canDiscardChanges,
    save,
    setContent,
    setMode: (mode: "preview" | "edit") =>
      dispatch({ type: "modeChanged", mode }),
    dismissError: () => dispatch({ type: "dismissedError" }),
  };
}
