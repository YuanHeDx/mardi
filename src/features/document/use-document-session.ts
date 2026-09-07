import { useCallback, useEffect, useReducer, useRef } from "react";
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

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const canDiscardChanges = useCallback(() => {
    return (
      !dirtyRef.current ||
      window.confirm("当前修改尚未保存。要放弃这些修改吗？")
    );
  }, []);

  const openPath = useCallback(
    async (path: string) => {
      if (!canDiscardChanges()) return false;
      try {
        const document = await documentGateway.readDocument(path);
        dispatch({ type: "loaded", document });
        return true;
      } catch (error) {
        dispatch({ type: "failed", message: messageFromError(error) });
        return false;
      }
    },
    [canDiscardChanges],
  );

  const chooseFile = useCallback(async () => {
    try {
      return await documentGateway.chooseSupportedFile();
    } catch (error) {
      dispatch({ type: "failed", message: messageFromError(error) });
      return null;
    }
  }, []);

  const closeDocument = useCallback(() => {
    if (!canDiscardChanges()) return false;
    dispatch({ type: "cleared" });
    return true;
  }, [canDiscardChanges]);

  const save = useCallback(async () => {
    if (!session.document || !dirty || !isTauriRuntime()) return;
    dispatch({ type: "saveStarted" });
    try {
      await documentGateway.writeDocument(
        session.document.path,
        session.document.content,
      );
      dispatch({ type: "saveCompleted" });
    } catch (error) {
      dispatch({ type: "failed", message: messageFromError(error) });
    }
  }, [dirty, session.document]);

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

    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .onCloseRequested((event) => {
          if (
            dirtyRef.current &&
            !window.confirm("当前修改尚未保存。确定关闭 mardi 吗？")
          ) {
            event.preventDefault();
          }
        })
        .then((stopListening) => {
          unlisten = stopListening;
        }),
    );

    return () => unlisten?.();
  }, []);

  return {
    session,
    dirty,
    chooseFile,
    openPath,
    closeDocument,
    save,
    setContent: (content: string) =>
      dispatch({ type: "contentChanged", content }),
    setMode: (mode: "preview" | "edit") =>
      dispatch({ type: "modeChanged", mode }),
    dismissError: () => dispatch({ type: "dismissedError" }),
  };
}
