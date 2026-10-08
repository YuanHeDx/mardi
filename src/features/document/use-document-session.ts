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
  type DocumentAction,
  type DocumentSnapshot,
} from "../../core/document";
import { documentGateway } from "../../infrastructure/tauri/document-gateway";
import { isTauriRuntime, messageFromError } from "../../infrastructure/tauri/runtime";

const MISSING_DOCUMENT_MESSAGE =
  "原文件已在外部删除。当前未保存内容仍保留在编辑器中，不会写回旧路径。";

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
  const locationCheckRef = useRef(0);

  useLayoutEffect(() => {
    dirtyRef.current = dirty;
    sessionRef.current = session;
  }, [dirty, session]);

  const transition = useCallback((action: DocumentAction) => {
    const next = documentReducer(sessionRef.current, action);
    sessionRef.current = next;
    dirtyRef.current = isDocumentDirty(next);
    dispatch(action);
    return next;
  }, []);

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

          if (current.isMissing) {
            transition({ type: "failed", message: MISSING_DOCUMENT_MESSAGE });
            return false;
          }

          const { path, content } = current.document;
          transition({ type: "saveStarted" });
          try {
            await documentGateway.writeDocument(path, content);
            transition({ type: "saveCompleted", content });
          } catch (error) {
            const message = sessionRef.current.isMissing
              ? MISSING_DOCUMENT_MESSAGE
              : messageFromError(error);
            transition({
              type: "failed",
              message,
            });
            return false;
          }
        }
      });
    saveQueueRef.current = queuedSave;
    return queuedSave;
  }, [transition]);

  const prepareToLeave = useCallback(async () => {
    if (sessionRef.current.isMissing) return canDiscardChanges();
    return save();
  }, [canDiscardChanges, save]);

  const openPath = useCallback(
    async (path: string) => {
      if (!(await prepareToLeave())) return false;
      try {
        const document = await documentGateway.readDocument(path);
        transition({ type: "loaded", document });
        return true;
      } catch (error) {
        transition({ type: "failed", message: messageFromError(error) });
        return false;
      }
    },
    [prepareToLeave, transition],
  );

  const chooseFile = useCallback(async () => {
    try {
      return await documentGateway.chooseSupportedFile();
    } catch (error) {
      transition({ type: "failed", message: messageFromError(error) });
      return null;
    }
  }, [transition]);

  const closeDocument = useCallback(async () => {
    if (!(await prepareToLeave())) return false;
    transition({ type: "cleared" });
    return true;
  }, [prepareToLeave, transition]);

  const discardDocument = useCallback(() => {
    transition({ type: "cleared" });
  }, [transition]);

  const relocateDocument = useCallback((path: string, name: string) => {
    transition({ type: "relocated", path, name });
  }, [transition]);

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
        transition({ type: "refreshed", document });
      }
      return true;
    } catch (error) {
      transition({ type: "failed", message: messageFromError(error) });
      return false;
    }
  }, [transition]);

  const reconcileDocumentLocation = useCallback(
    async (rootPaths: string[], candidatePaths: string[]) => {
      const startingDocument = sessionRef.current.document;
      const fileId = startingDocument?.fileId;
      if (!startingDocument || !fileId) return false;

      const check = ++locationCheckRef.current;
      try {
        const location = await documentGateway.locateDocument(
          startingDocument.path,
          fileId,
          rootPaths,
          candidatePaths,
        );
        const latest = sessionRef.current;
        if (
          check !== locationCheckRef.current ||
          !latest.document ||
          latest.document.fileId !== fileId
        ) {
          return false;
        }

        if (!location) {
          if (dirtyRef.current) {
            transition({ type: "missing", message: MISSING_DOCUMENT_MESSAGE });
          } else {
            transition({ type: "cleared" });
          }
          return true;
        }

        if (
          latest.document.path !== location.path ||
          latest.document.name !== location.name ||
          latest.document.fileId !== location.fileId
        ) {
          transition({
            type: "relocated",
            path: location.path,
            name: location.name,
            fileId: location.fileId,
          });
        }
        if (!dirtyRef.current && !sessionRef.current.isSaving) {
          await refreshFromDisk(location.path);
        }
        return true;
      } catch (error) {
        transition({ type: "failed", message: messageFromError(error) });
        return false;
      }
    },
    [refreshFromDisk, transition],
  );

  const setContent = useCallback((content: string) => {
    const current = sessionRef.current;
    if (!current.document) return;
    transition({ type: "contentChanged", content });
  }, [transition]);

  useEffect(() => {
    if (
      !dirty ||
      !session.document ||
      session.isMissing ||
      !isTauriRuntime()
    ) {
      return;
    }
    const timeout = window.setTimeout(() => void save(), 400);
    return () => window.clearTimeout(timeout);
  }, [dirty, save, session.document, session.isMissing]);

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
            if (await prepareToLeave()) await currentWindow.destroy();
          }
        })
        .then((stopListening) => {
          unlisten = stopListening;
        });
    });

    return () => unlisten?.();
  }, [prepareToLeave]);

  return {
    session,
    dirty,
    chooseFile,
    openPath,
    closeDocument,
    discardDocument,
    relocateDocument,
    refreshFromDisk,
    reconcileDocumentLocation,
    confirmDiscardChanges: canDiscardChanges,
    save,
    setContent,
    setMode: (mode: "preview" | "edit") =>
      transition({ type: "modeChanged", mode }),
    dismissError: () => transition({ type: "dismissedError" }),
  };
}
