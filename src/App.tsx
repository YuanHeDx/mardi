import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import {
  fileKindFromPath,
  fileNameFromPath,
  findRootPathForFile,
  flattenMarkdownFiles,
  isPathWithinRoot,
  replacePathPrefix,
  type MediaContent,
  type WorkspaceEntry,
} from "./core/workspace";
import { useDocumentSession } from "./features/document/use-document-session";
import { useRecentFiles } from "./features/recent-files/use-recent-files";
import { useWorkspace } from "./features/workspace/use-workspace";
import { WorkspaceSidebar } from "./features/workspace/workspace-sidebar";
import { isTauriRuntime } from "./infrastructure/tauri/runtime";
import {
  browserDemoDocument,
  browserDemoRoots,
  welcomeMarkdown,
} from "./services/demo-content";
import { MarkdownPreview } from "./ui/markdown-preview";
import { MediaPreview } from "./ui/media-preview";
import { OpenFileDialog } from "./ui/open-file-dialog";
import { StatusBar } from "./ui/status-bar";
import {
  SelectionToolbar,
  type TextSelection,
} from "./ui/selection-toolbar";
import { TitleBar } from "./ui/title-bar";
import "./ui/styles/tokens.css";
import "./ui/styles/typora-theme.css";
import "./App.css";

const MarkdownEditor = lazy(() =>
  import("./features/editor/markdown-editor").then((module) => ({
    default: module.MarkdownEditor,
  })),
);

function App() {
  const runsInTauri = useMemo(() => isTauriRuntime(), []);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [activeMedia, setActiveMedia] = useState<MediaContent | null>(null);
  const mediaGenerationRef = useRef(0);
  const [openFileDialogVisible, setOpenFileDialogVisible] = useState(false);
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const recentFiles = useRecentFiles();
  const documentSession = useDocumentSession(
    runsInTauri ? undefined : browserDemoDocument,
  );
  const workspaceSession = useWorkspace(
    runsInTauri ? [] : browserDemoRoots,
  );
  const { session } = documentSession;
  const activeDocument = session.document;
  const activePath = activeMedia?.canonicalPath ?? activeMedia?.path ?? activeDocument?.path ?? null;
  const activeTitle = activeMedia?.name ?? activeDocument?.name ?? "mardi";
  const displayContent = activeDocument?.content ?? welcomeMarkdown;
  const workspaceRoot = useMemo(
    () =>
      activeDocument
        ? findRootPathForFile(workspaceSession.roots, activeDocument.path)
        : null,
    [activeDocument, workspaceSession.roots],
  );
  const visibleError = session.error ?? workspaceSession.error;
  const dismissTextSelection = useCallback(() => setTextSelection(null), []);

  useEffect(() => {
    setTextSelection(null);
  }, [session.loadGeneration]);

  useEffect(() => {
    const change = workspaceSession.latestChange;
    if (!activeDocument || !change) return;
    if (change.kind === "structure") {
      void documentSession.reconcileDocumentLocation(
        workspaceSession.roots.map((workspace) => workspace.root.rootPath),
        change.paths,
      );
      return;
    }
    const affectsDocument = change.paths.some(
      (path) =>
        isPathWithinRoot(path, activeDocument.path) ||
        isPathWithinRoot(activeDocument.path, path),
    );
    if (affectsDocument) {
      if (activeDocument.fileId) {
        void documentSession.reconcileDocumentLocation(
          workspaceSession.roots.map((workspace) => workspace.root.rootPath),
          change.paths,
        );
      } else {
        void documentSession.refreshFromDisk(activeDocument.path);
      }
    }
  }, [
    activeDocument?.path,
    documentSession.dirty,
    session.isSaving,
    workspaceSession.latestChange?.sequence,
  ]);

  useEffect(() => {
    if (!runsInTauri) return;
    const title = activePath
      ? `${documentSession.dirty ? "• " : ""}${activeTitle} — mardi`
      : "mardi";
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().setTitle(title),
    );
  }, [
    activePath,
    activeTitle,
    documentSession.dirty,
    runsInTauri,
  ]);

  const openEntry = useCallback(async (entry: WorkspaceEntry, rootPath: string | null) => {
    if (entry.kind === "markdown") {
      const didOpen = await documentSession.openPath(entry.path);
      if (didOpen) {
        setActiveMedia(null);
        void recentFiles.remember(entry.path);
      }
      return didOpen;
    }

    if (entry.kind === "image" || entry.kind === "video") {
      if (!(await documentSession.closeDocument())) return false;
      const openGeneration = ++mediaGenerationRef.current;
      setActiveMedia({
        openGeneration,
        kind: entry.kind,
        path: entry.path,
        name: entry.name,
        rootPath,
      });
      void recentFiles.remember(entry.path).then((file) => {
        if (!file) return;
        // Keep the preview source and playback generation stable when Native
        // resolves a symlink or /tmp alias to the history's canonical identity.
        setActiveMedia((current) => current?.openGeneration === openGeneration && current.path === entry.path
          ? { ...current, canonicalPath: file.path }
          : current);
      });
      return true;
    }

    return false;
  }, [documentSession.closeDocument, documentSession.openPath, recentFiles.remember]);

  // A watcher can relocate an already-open document without opening it again.
  // Follow that known path change without increasing its recency timestamp.
  const recentDocumentLocation = useRef<{ path: string; generation: number } | null>(null);
  useEffect(() => {
    const previous = recentDocumentLocation.current;
    recentDocumentLocation.current = activeDocument ? { path: activeDocument.path, generation: session.loadGeneration } : null;
    if (activeDocument && previous && previous.generation === session.loadGeneration && previous.path !== activeDocument.path) {
      void recentFiles.relocate(previous.path, activeDocument.path);
    }
  }, [activeDocument?.path, session.loadGeneration, recentFiles.relocate]);

  const openFileAtPath = useCallback(async (path: string) => {
    const kind = fileKindFromPath(path);
    if (!kind) return false;

    return openEntry(
      {
        path,
        name: fileNameFromPath(path),
        kind,
        children: [],
      },
      findRootPathForFile(workspaceSession.roots, path),
    );
  }, [openEntry, workspaceSession.roots]);

  // Root hydration/renames can change the callback without invalidating an
  // already backend-popped request batch or recreating the native listener.
  const openFileAtPathRef = useRef(openFileAtPath);
  useLayoutEffect(() => { openFileAtPathRef.current = openFileAtPath; }, [openFileAtPath]);

  useEffect(() => {
    if (!runsInTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let running = false;
    let rerun = false;

    const drainSystemOpenRequests = async () => {
      rerun = true;
      if (running) return;
      running = true;
      try {
        while (!disposed && rerun) {
          rerun = false;
          const paths = await invoke<string[]>("take_pending_open_files");
          for (const path of paths) {
            if (disposed) return;
            await openFileAtPathRef.current(path);
          }
        }
      } finally {
        running = false;
      }
    };

    // Opening is serialized across batches as well as within one batch. A new
    // notification cannot open C in parallel with [A,B] then let old B win.
    const requestDrain = () => { void drainSystemOpenRequests().catch(() => undefined); };
    void listen("open-files-requested", requestDrain).then((stopListening) => {
      if (disposed) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      requestDrain();
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [runsInTauri]);

  const handleOpenFolder = async () => {
    const snapshot = await workspaceSession.openWorkspace();
    const firstDocument = snapshot
      ? flattenMarkdownFiles(snapshot.entries)[0]
      : undefined;
    if (firstDocument) await openEntry(firstDocument, snapshot?.rootPath ?? null);
  };

  const handleChooseFile = async () => {
    const path = await documentSession.chooseFile();
    if (!path) return false;
    return openFileAtPath(path);
  };

  const handleCreateFile = async (
    rootPath: string,
    parentPath: string,
    name: string,
  ) => {
    const entry = await workspaceSession.createFile(rootPath, parentPath, name);
    if (!entry) return false;
    await openEntry(entry, rootPath);
    return true;
  };

  const handleCreateDirectory = async (
    rootPath: string,
    parentPath: string,
    name: string,
  ) =>
    Boolean(
      await workspaceSession.createDirectory(rootPath, parentPath, name),
    );

  const handleRenameEntry = async (
    entry: WorkspaceEntry,
    rootPath: string,
    newStem: string,
  ) => {
    const renamed = await recentFiles.runAfterPending(() =>
      workspaceSession.renameEntry(rootPath, entry.path, newStem),
    );
    if (!renamed) return false;
    void recentFiles.relocate(entry.path, renamed.path);

    if (activeDocument && isPathWithinRoot(activeDocument.path, entry.path)) {
      documentSession.relocateDocument(
        replacePathPrefix(activeDocument.path, entry.path, renamed.path),
        activeDocument.path === entry.path ? renamed.name : activeDocument.name,
      );
    }
    setActiveMedia((current) => {
      const identity = current?.canonicalPath ?? current?.path;
      if (!current || !identity || !isPathWithinRoot(identity, entry.path)) return current;
      const nextPath = replacePathPrefix(identity, entry.path, renamed.path);
      return { ...current, path: nextPath, canonicalPath: nextPath, name: identity === entry.path ? renamed.name : current.name };
    });
    return true;
  };

  const handleDeleteEntry = async (
    entry: WorkspaceEntry,
    rootPath: string,
  ) => {
    if (!window.confirm(`要将“${entry.name}”移到废纸篓吗？`)) return false;

    const isActiveDocument = Boolean(
      activeDocument && isPathWithinRoot(activeDocument.path, entry.path),
    );
    if (isActiveDocument && !(await documentSession.confirmDiscardChanges())) {
      return false;
    }

    const didDelete = await recentFiles.runAfterPending(() =>
      workspaceSession.trashEntry(rootPath, entry.path),
    );
    if (!didDelete) return false;
    void recentFiles.forget(entry.path);
    if (isActiveDocument) documentSession.discardDocument();
    setActiveMedia((current) => current && isPathWithinRoot(current.canonicalPath ?? current.path, entry.path) ? null : current);
    return true;
  };

  const dismissError = () => {
    documentSession.dismissError();
    workspaceSession.dismissError();
  };

  return (
    <div className="app-shell">
      <TitleBar
        dirty={documentSession.dirty}
        onToggleSidebar={() => setSidebarVisible((visible) => !visible)}
        sidebarVisible={sidebarVisible}
        title={activeTitle}
      />

      <div className="workspace-layout">
        {sidebarVisible ? (
          <WorkspaceSidebar
            activePath={activePath}
            canManageFiles={runsInTauri}
            recentFiles={recentFiles.files}
            recentFilesError={recentFiles.error}
            recentFilesLoading={recentFiles.loading}
            onSelectRecentFile={(file) => void openFileAtPath(file.path)}
            onRemoveRecentFile={(path) => void recentFiles.forget(path)}
            onRetryRecentFiles={() => void recentFiles.reload()}
            onCreateDirectory={handleCreateDirectory}
            onCreateFile={handleCreateFile}
            onDeleteFile={handleDeleteEntry}
            onExpandPath={workspaceSession.expandPath}
            onOpenFile={() => setOpenFileDialogVisible(true)}
            onOpenFolder={() => void handleOpenFolder()}
            onRefreshFiles={workspaceSession.refreshAll}
            onRemoveRoot={(rootPath) =>
              void workspaceSession.removeRoot(rootPath)
            }
            onRetryRoot={(rootPath) =>
              void workspaceSession.retryRoot(rootPath)
            }
            onRenameFile={handleRenameEntry}
            onSelectEntry={(entry, rootPath) =>
              void openEntry(entry, rootPath)
            }
            onToggleRoot={workspaceSession.toggleRoot}
            onTogglePath={workspaceSession.togglePath}
            roots={workspaceSession.roots}
          />
        ) : null}

        <main className="document-pane">
          {activeMedia ? (
            <MediaPreview media={activeMedia} />
          ) : activeDocument ? (
            <Suspense fallback={<div className="editor-loading" />}>
              <MarkdownEditor
                documentPath={activeDocument.path}
                externalRevision={session.externalRevision}
                loadGeneration={session.loadGeneration}
                onChange={documentSession.setContent}
                onCompositionChange={documentSession.setComposing}
                onController={documentSession.registerEditor}
                onTextSelection={setTextSelection}
                value={activeDocument.content}
                workspaceRoot={workspaceRoot}
              />
            </Suspense>
          ) : (
            <MarkdownPreview
              content={displayContent}
              document={activeDocument}
              onTextSelection={activeDocument ? setTextSelection : undefined}
              workspaceRoot={workspaceRoot}
            />
          )}
        </main>
      </div>

      <StatusBar
        content={displayContent}
        isSaving={session.isSaving}
        kind={activeMedia?.kind ?? (activeDocument ? "markdown" : null)}
      />

      {activeDocument && textSelection ? (
        <SelectionToolbar
          filePath={activeDocument.path}
          onDismiss={dismissTextSelection}
          selection={textSelection}
        />
      ) : null}

      {openFileDialogVisible ? (
        <OpenFileDialog
          onCancel={() => setOpenFileDialogVisible(false)}
          onChooseFile={handleChooseFile}
          onOpenPath={openFileAtPath}
        />
      ) : null}

      {visibleError ? (
        <div className="error-banner" role="alert">
          <span>{visibleError}</span>
          <button aria-label="关闭错误提示" onClick={dismissError} type="button">
            <X />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default App;
