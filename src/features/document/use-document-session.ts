import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
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

import type { MarkdownEditorController } from "../editor/editor-controller";

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
  const openOperationRef = useRef(0);
  const editorControllerRef = useRef<MarkdownEditorController | null>(null);
  const composingRef = useRef(false);
  const [isComposing, setIsComposing] = useState(false);

  const registerEditor = useCallback((controller: MarkdownEditorController | null) => {
    editorControllerRef.current = controller;
  }, []);

  const setComposing = useCallback((composing: boolean, generation: number) => {
    if (sessionRef.current.loadGeneration !== generation) return;
    composingRef.current = composing;
    setIsComposing(composing);
  }, []);

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

  const finishComposition = useCallback(async (restoreFocus = false) => {
    if (!composingRef.current) return true;
    const controller = editorControllerRef.current;
    const generation = sessionRef.current.loadGeneration;
    const revision = sessionRef.current.externalRevision;
    const operation = openOperationRef.current;
    const finished = await controller?.finishComposition(restoreFocus ? {
      restoreFocusIf: () => sessionRef.current.loadGeneration === generation &&
        sessionRef.current.externalRevision === revision &&
        editorControllerRef.current === controller && openOperationRef.current === operation,
    } : undefined);
    if (!finished || composingRef.current) {
      transition({ type: "failed", message: "请先确认当前输入法候选，再重试保存或打开文件。" });
      return false;
    }
    return true;
  }, [transition]);

  const saveWithIntent = useCallback(async (intent: "manual" | "auto" | "leave"): Promise<boolean> => {
    const requestedGeneration = sessionRef.current.loadGeneration;
    if (intent === "auto" && composingRef.current) return false;
    if (!(await finishComposition(intent === "manual")) || sessionRef.current.loadGeneration !== requestedGeneration) return false;
    if (!isTauriRuntime()) return true;

    const queuedSave = saveQueueRef.current
      .catch(() => false)
      .then(async () => {
        while (true) {
          const current = sessionRef.current;
          if (current.loadGeneration !== requestedGeneration || composingRef.current) return false;
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

          // A new composition can start while an earlier write is in flight.
          // The existing snapshot may finish, but marked text must not be written.
          if (composingRef.current) return false;
          const { path, content } = current.document;
          const generation = current.loadGeneration;
          transition({ type: "saveStarted", generation });
          try {
            await documentGateway.writeDocument(path, content);
            if (sessionRef.current.loadGeneration !== generation) return false;
            transition({ type: "saveCompleted", content, generation });
          } catch (error) {
            if (sessionRef.current.loadGeneration !== generation) return false;
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
  }, [finishComposition, transition]);

  const save = useCallback(() => saveWithIntent("manual"), [saveWithIntent]);

  const prepareToLeave = useCallback(async () => {
    if (sessionRef.current.isMissing) {
      if (!(await finishComposition())) return false;
      return canDiscardChanges();
    }
    return saveWithIntent("leave");
  }, [canDiscardChanges, finishComposition, saveWithIntent]);

  const openPath = useCallback(
    async (path: string) => {
      const operation = ++openOperationRef.current;
      try {
        while (operation === openOperationRef.current) {
          if (!(await prepareToLeave()) || operation !== openOperationRef.current) return false;
          const beforeRead = sessionRef.current;
          const document = await documentGateway.readDocument(path);
          if (operation !== openOperationRef.current) return false;
          // Typing can continue during an asynchronous disk read. Save that
          // newer buffer, then read again (especially for same-path reopen).
          if (beforeRead.document?.content !== sessionRef.current.document?.content || composingRef.current) continue;
          composingRef.current = false;
          setIsComposing(false);
          transition({ type: "loaded", document });
          return true;
        }
        return false;
      } catch (error) {
        if (operation !== openOperationRef.current) return false;
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
    const operation = ++openOperationRef.current;
    if (!(await prepareToLeave()) || operation !== openOperationRef.current) return false;
    transition({ type: "cleared" });
    return true;
  }, [prepareToLeave, transition]);

  const discardDocument = useCallback(() => {
    ++openOperationRef.current;
    composingRef.current = false;
    setIsComposing(false);
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
      current.isSaving ||
      composingRef.current
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
        latest.isSaving ||
        composingRef.current ||
        latest.loadGeneration !== current.loadGeneration ||
        latest.document.content !== current.document.content ||
        latest.savedContent !== current.savedContent
      ) {
        return false;
      }
      if (latest.document.content !== document.content) {
        transition({ type: "refreshed", document });
      }
      return true;
    } catch (error) {
      if (sessionRef.current.loadGeneration !== current.loadGeneration || sessionRef.current.document?.path !== path) return false;
      transition({ type: "failed", message: messageFromError(error) });
      return false;
    }
  }, [transition]);

  const reconcileDocumentLocation = useCallback(
    async (rootPaths: string[], candidatePaths: string[]) => {
      const generation = sessionRef.current.loadGeneration;
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
          latest.loadGeneration !== generation ||
          !latest.document ||
          latest.document.fileId !== fileId
        ) {
          return false;
        }

        if (!location) {
          if (dirtyRef.current || composingRef.current) {
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
        if (sessionRef.current.loadGeneration !== generation || check !== locationCheckRef.current) return false;
        transition({ type: "failed", message: messageFromError(error) });
        return false;
      }
    },
    [refreshFromDisk, transition],
  );

  const setContent = useCallback((content: string, generation: number) => {
    const current = sessionRef.current;
    if (!current.document || current.loadGeneration !== generation) return;
    transition({ type: "contentChanged", content });
  }, [transition]);

  useEffect(() => {
    if (
      !dirty ||
      !session.document ||
      session.isMissing ||
      isComposing ||
      !isTauriRuntime()
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      if (!composingRef.current) void saveWithIntent("auto");
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [dirty, isComposing, saveWithIntent, session.document, session.isMissing]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // An IME processing key can retain Cmd/Ctrl+S metadata. It belongs to
      // composition, not the Save shortcut; do not blur or commit marked text.
      if (event.isComposing || event.keyCode === 229) return;
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
          if (dirtyRef.current || composingRef.current) {
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
    confirmDiscardChanges: async () => (await finishComposition()) && canDiscardChanges(),
    save,
    setContent,
    setComposing,
    registerEditor,
    dismissError: () => transition({ type: "dismissedError" }),
  };
}
