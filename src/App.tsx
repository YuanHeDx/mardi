import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const documentSession = useDocumentSession(
    runsInTauri ? undefined : browserDemoDocument,
  );
  const workspaceSession = useWorkspace(
    runsInTauri ? [] : browserDemoRoots,
  );
  const { session } = documentSession;
  const activeDocument = session.document;
  const activePath = activeMedia?.path ?? activeDocument?.path ?? null;
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
  }, [activeDocument?.path, session.mode]);

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

  const openEntry = async (entry: WorkspaceEntry, rootPath: string | null) => {
    if (entry.kind === "markdown") {
      const didOpen = await documentSession.openPath(entry.path);
      if (didOpen) setActiveMedia(null);
      return;
    }

    if (entry.kind === "image" || entry.kind === "video") {
      if (!documentSession.closeDocument()) return;
      setActiveMedia({
        kind: entry.kind,
        path: entry.path,
        name: entry.name,
        rootPath,
      });
    }
  };

  const handleOpenFolder = async () => {
    const snapshot = await workspaceSession.openWorkspace();
    const firstDocument = snapshot
      ? flattenMarkdownFiles(snapshot.entries)[0]
      : undefined;
    if (firstDocument) await openEntry(firstDocument, snapshot?.rootPath ?? null);
  };

  const handleOpenFile = async () => {
    const path = await documentSession.chooseFile();
    if (!path) return;
    const kind = fileKindFromPath(path);
    if (!kind) return;

    await openEntry(
      {
        path,
        name: fileNameFromPath(path),
        kind,
        children: [],
      },
      findRootPathForFile(workspaceSession.roots, path),
    );
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

  const handleRenameEntry = async (
    entry: WorkspaceEntry,
    rootPath: string,
    newStem: string,
  ) => {
    const renamed = await workspaceSession.renameEntry(
      rootPath,
      entry.path,
      newStem,
    );
    if (!renamed) return false;

    if (activeDocument && isPathWithinRoot(activeDocument.path, entry.path)) {
      documentSession.relocateDocument(
        replacePathPrefix(activeDocument.path, entry.path, renamed.path),
        activeDocument.path === entry.path ? renamed.name : activeDocument.name,
      );
    }
    if (activeMedia && isPathWithinRoot(activeMedia.path, entry.path)) {
      setActiveMedia({
        ...activeMedia,
        path: replacePathPrefix(activeMedia.path, entry.path, renamed.path),
        name: activeMedia.path === entry.path ? renamed.name : activeMedia.name,
      });
    }
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
    const isActiveMedia = Boolean(
      activeMedia && isPathWithinRoot(activeMedia.path, entry.path),
    );
    if (isActiveDocument && !documentSession.confirmDiscardChanges()) {
      return false;
    }

    const didDelete = await workspaceSession.trashEntry(rootPath, entry.path);
    if (!didDelete) return false;
    if (isActiveDocument) documentSession.discardDocument();
    if (isActiveMedia) setActiveMedia(null);
    return true;
  };

  const dismissError = () => {
    documentSession.dismissError();
    workspaceSession.dismissError();
  };

  return (
    <div className="app-shell">
      <TitleBar
        canEdit={Boolean(activeDocument) && !activeMedia}
        dirty={documentSession.dirty}
        mode={session.mode}
        onModeChange={documentSession.setMode}
        onToggleSidebar={() => setSidebarVisible((visible) => !visible)}
        sidebarVisible={sidebarVisible}
        title={activeTitle}
      />

      <div className="workspace-layout">
        {sidebarVisible ? (
          <WorkspaceSidebar
            activePath={activePath}
            canManageFiles={runsInTauri}
            onCreateFile={handleCreateFile}
            onDeleteFile={handleDeleteEntry}
            onExpandPath={workspaceSession.expandPath}
            onOpenFile={() => void handleOpenFile()}
            onOpenFolder={() => void handleOpenFolder()}
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
          ) : session.mode === "edit" && activeDocument ? (
            <Suspense fallback={<div className="editor-loading" />}>
              <MarkdownEditor
                onChange={documentSession.setContent}
                onTextSelection={setTextSelection}
                value={activeDocument.content}
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
