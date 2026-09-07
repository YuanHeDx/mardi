import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProjectRoot,
  ProjectViewState,
  RootWorkspace,
  WorkspaceSnapshot,
} from "../../core/workspace";
import {
  setDirectoryExpanded,
  viewStateForProject,
} from "../../core/workspace";
import {
  isTauriRuntime,
  messageFromError,
} from "../../infrastructure/tauri/runtime";
import { workspaceGateway } from "../../infrastructure/tauri/workspace-gateway";

function unloadedRoot(
  root: ProjectRoot,
  isExpanded = root.viewState?.isExpanded ?? false,
): RootWorkspace {
  const viewState = viewStateForProject(root, isExpanded);
  return {
    root,
    entries: null,
    isExpanded: viewState.isExpanded,
    isLoading: false,
    isTruncated: false,
    error: null,
    collapsedPaths: viewState.collapsedPaths,
  };
}

function loadedRoot(
  workspace: RootWorkspace,
  snapshot: WorkspaceSnapshot,
): RootWorkspace {
  return {
    ...workspace,
    entries: snapshot.entries,
    isExpanded: true,
    isLoading: false,
    isTruncated: snapshot.isTruncated,
    error: null,
  };
}

export function useWorkspace(initialRoots: RootWorkspace[] = []) {
  const [roots, setRoots] = useState<RootWorkspace[]>(initialRoots);
  const [error, setError] = useState<string | null>(null);
  const persistenceQueues = useRef(new Map<string, Promise<void>>());

  const persistViewState = useCallback(
    (rootPath: string, viewState: ProjectViewState) => {
      if (!isTauriRuntime()) return;

      const previous =
        persistenceQueues.current.get(rootPath) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() => workspaceGateway.updateProjectViewState(rootPath, viewState));
      persistenceQueues.current.set(rootPath, next);
      void next
        .catch((caughtError) => setError(messageFromError(caughtError)))
        .finally(() => {
          if (persistenceQueues.current.get(rootPath) === next) {
            persistenceQueues.current.delete(rootPath);
          }
        });
    },
    [],
  );

  const loadRoot = useCallback(async (rootPath: string) => {
    setRoots((current) =>
      current.map((workspace) =>
        workspace.root.rootPath === rootPath
          ? {
              ...workspace,
              isExpanded: true,
              isLoading: true,
              error: null,
            }
          : workspace,
      ),
    );

    try {
      const snapshot = await workspaceGateway.listWorkspace(rootPath);
      setRoots((current) =>
        current.map((workspace) =>
          workspace.root.rootPath === rootPath
            ? loadedRoot(workspace, snapshot)
            : workspace,
        ),
      );
      return snapshot;
    } catch (caughtError) {
      const message = messageFromError(caughtError);
      setRoots((current) =>
        current.map((workspace) =>
          workspace.root.rootPath === rootPath
            ? {
                ...workspace,
                entries: null,
                isExpanded: true,
                isLoading: false,
                error: message,
              }
            : workspace,
        ),
      );
      return null;
    }
  }, []);

  useEffect(() => {
    if (initialRoots.length > 0) return;
    let cancelled = false;

    void workspaceGateway
      .listProjectRoots()
      .then((projects) => {
        if (cancelled) return;
        const workspaces = projects.map((project, index) =>
          unloadedRoot(
            project,
            project.viewState?.isExpanded ?? index === 0,
          ),
        );
        setRoots(workspaces);

        for (const workspace of workspaces) {
          if (!workspace.root.viewState) {
            persistViewState(workspace.root.rootPath, {
              isExpanded: workspace.isExpanded,
              collapsedPaths: workspace.collapsedPaths,
            });
          }
          if (workspace.isExpanded) void loadRoot(workspace.root.rootPath);
        }
      })
      .catch((caughtError) => {
        if (!cancelled) setError(messageFromError(caughtError));
      });

    return () => {
      cancelled = true;
    };
  }, [initialRoots.length, loadRoot, persistViewState]);

  const openWorkspace = useCallback(async () => {
    try {
      const rootPath = await workspaceGateway.chooseWorkspaceFolder();
      if (!rootPath) return null;

      const project = await workspaceGateway.rememberProjectRoot(rootPath);
      setRoots((current) => [
        unloadedRoot(project, true),
        ...current.filter(
          (workspace) => workspace.root.rootPath !== project.rootPath,
        ),
      ]);

      const snapshot = await loadRoot(project.rootPath);
      setError(null);
      return snapshot;
    } catch (caughtError) {
      setError(messageFromError(caughtError));
      return null;
    }
  }, [loadRoot]);

  const toggleRoot = useCallback(
    (workspace: RootWorkspace) => {
      const isExpanded = !workspace.isExpanded;
      persistViewState(workspace.root.rootPath, {
        isExpanded,
        collapsedPaths: workspace.collapsedPaths,
      });

      if (isExpanded && !workspace.entries) {
        void loadRoot(workspace.root.rootPath);
        return;
      }

      setRoots((current) =>
        current.map((item) =>
          item.root.rootPath === workspace.root.rootPath
            ? { ...item, isExpanded }
            : item,
        ),
      );
    },
    [loadRoot, persistViewState],
  );

  const setPathExpanded = useCallback(
    (rootPath: string, path: string, isExpanded: boolean) => {
      setRoots((current) =>
        current.map((workspace) => {
          if (workspace.root.rootPath !== rootPath) return workspace;
          const collapsedPaths = setDirectoryExpanded(
            workspace.collapsedPaths,
            path,
            isExpanded,
          );
          const next = { ...workspace, collapsedPaths };
          persistViewState(rootPath, {
            isExpanded: next.isExpanded,
            collapsedPaths: next.collapsedPaths,
          });
          return next;
        }),
      );
    },
    [persistViewState],
  );

  const togglePath = useCallback(
    (rootPath: string, path: string) => {
      setRoots((current) =>
        current.map((workspace) => {
          if (workspace.root.rootPath !== rootPath) return workspace;
          const collapsedPaths = setDirectoryExpanded(
            workspace.collapsedPaths,
            path,
            workspace.collapsedPaths.includes(path),
          );
          const next = { ...workspace, collapsedPaths };
          persistViewState(rootPath, {
            isExpanded: next.isExpanded,
            collapsedPaths: next.collapsedPaths,
          });
          return next;
        }),
      );
    },
    [persistViewState],
  );

  const removeRoot = useCallback(async (rootPath: string) => {
    try {
      await persistenceQueues.current.get(rootPath)?.catch(() => undefined);
      await workspaceGateway.forgetProjectRoot(rootPath);
      persistenceQueues.current.delete(rootPath);
      setRoots((current) =>
        current.filter((workspace) => workspace.root.rootPath !== rootPath),
      );
      setError(null);
    } catch (caughtError) {
      setError(messageFromError(caughtError));
    }
  }, []);

  const createFile = useCallback(
    async (rootPath: string, parentPath: string, name: string) => {
      try {
        const entry = await workspaceGateway.createMarkdown(
          rootPath,
          parentPath,
          name,
        );
        await loadRoot(rootPath);
        setError(null);
        return entry;
      } catch (caughtError) {
        setError(messageFromError(caughtError));
        return null;
      }
    },
    [loadRoot],
  );

  const renameFile = useCallback(
    async (rootPath: string, path: string, newStem: string) => {
      try {
        const entry = await workspaceGateway.renameFile(
          rootPath,
          path,
          newStem,
        );
        await loadRoot(rootPath);
        setError(null);
        return entry;
      } catch (caughtError) {
        setError(messageFromError(caughtError));
        return null;
      }
    },
    [loadRoot],
  );

  const trashFile = useCallback(
    async (rootPath: string, path: string) => {
      try {
        await workspaceGateway.trashFile(rootPath, path);
        await loadRoot(rootPath);
        setError(null);
        return true;
      } catch (caughtError) {
        setError(messageFromError(caughtError));
        return false;
      }
    },
    [loadRoot],
  );

  return {
    roots,
    error,
    openWorkspace,
    toggleRoot,
    togglePath,
    expandPath: (rootPath: string, path: string) =>
      setPathExpanded(rootPath, path, true),
    removeRoot,
    createFile,
    renameFile,
    trashFile,
    retryRoot: loadRoot,
    dismissError: () => setError(null),
  };
}
