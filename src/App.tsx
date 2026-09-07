import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  fileKindFromPath,
  fileNameFromPath,
  findRootPathForFile,
  flattenMarkdownFiles,
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
            onOpenFile={() => void handleOpenFile()}
            onOpenFolder={() => void handleOpenFolder()}
            onRemoveRoot={(rootPath) =>
              void workspaceSession.removeRoot(rootPath)
            }
            onRetryRoot={(rootPath) =>
              void workspaceSession.retryRoot(rootPath)
            }
            onSelectEntry={(entry, rootPath) =>
              void openEntry(entry, rootPath)
            }
            onToggleRoot={workspaceSession.toggleRoot}
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
                value={activeDocument.content}
              />
            </Suspense>
          ) : (
            <MarkdownPreview
              content={displayContent}
              document={activeDocument}
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
