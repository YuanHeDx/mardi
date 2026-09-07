import { useCallback, useEffect, useState } from "react";
import type {
  ProjectRoot,
  RootWorkspace,
  WorkspaceSnapshot,
} from "../../core/workspace";
import { messageFromError } from "../../infrastructure/tauri/runtime";
import { workspaceGateway } from "../../infrastructure/tauri/workspace-gateway";

function unloadedRoot(root: ProjectRoot, isExpanded = false): RootWorkspace {
  return {
    root,
    entries: null,
    isExpanded,
    isLoading: false,
    isTruncated: false,
    error: null,
  };
}

function loadedRoot(
  root: ProjectRoot,
  snapshot: WorkspaceSnapshot,
): RootWorkspace {
  return {
    root,
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
            ? loadedRoot(workspace.root, snapshot)
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
        setRoots(projects.map((project) => unloadedRoot(project)));
        if (projects[0]) void loadRoot(projects[0].rootPath);
      })
      .catch((caughtError) => {
        if (!cancelled) setError(messageFromError(caughtError));
      });

    return () => {
      cancelled = true;
    };
  }, [initialRoots.length, loadRoot]);

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
      if (workspace.isExpanded) {
        setRoots((current) =>
          current.map((item) =>
            item.root.rootPath === workspace.root.rootPath
              ? { ...item, isExpanded: false }
              : item,
          ),
        );
      } else if (workspace.entries) {
        setRoots((current) =>
          current.map((item) =>
            item.root.rootPath === workspace.root.rootPath
              ? { ...item, isExpanded: true }
              : item,
          ),
        );
      } else {
        void loadRoot(workspace.root.rootPath);
      }
    },
    [loadRoot],
  );

  const removeRoot = useCallback(async (rootPath: string) => {
    try {
      await workspaceGateway.forgetProjectRoot(rootPath);
      setRoots((current) =>
        current.filter((workspace) => workspace.root.rootPath !== rootPath),
      );
      setError(null);
    } catch (caughtError) {
      setError(messageFromError(caughtError));
    }
  }, []);

  return {
    roots,
    error,
    openWorkspace,
    toggleRoot,
    removeRoot,
    retryRoot: loadRoot,
    dismissError: () => setError(null),
  };
}
