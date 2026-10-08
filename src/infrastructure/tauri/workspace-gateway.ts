import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  WorkspaceFilesChanged,
  WorkspaceGateway,
} from "../../core/ports/workspace-gateway";
import type {
  ProjectRoot,
  ProjectViewState,
  WorkspaceEntry,
  WorkspaceSnapshot,
} from "../../core/workspace";
import { isTauriRuntime } from "./runtime";

export class TauriWorkspaceGateway implements WorkspaceGateway {
  async chooseWorkspaceFolder(): Promise<string | null> {
    if (!isTauriRuntime()) return null;

    const selection = await open({
      directory: true,
      multiple: false,
      recursive: true,
    });
    return typeof selection === "string" ? selection : null;
  }

  listProjectRoots(): Promise<ProjectRoot[]> {
    return invoke<ProjectRoot[]>("list_project_roots");
  }

  rememberProjectRoot(rootPath: string): Promise<ProjectRoot> {
    return invoke<ProjectRoot>("remember_project_root", { rootPath });
  }

  forgetProjectRoot(rootPath: string): Promise<void> {
    return invoke("forget_project_root", { rootPath });
  }

  listWorkspace(rootPath: string): Promise<WorkspaceSnapshot> {
    return invoke<WorkspaceSnapshot>("list_workspace", { rootPath });
  }

  watchRoots(rootPaths: string[]): Promise<void> {
    if (!isTauriRuntime()) return Promise.resolve();
    return invoke("watch_workspace_roots", { rootPaths });
  }

  async listenToChanges(
    listener: (change: WorkspaceFilesChanged) => void,
  ): Promise<() => void> {
    if (!isTauriRuntime()) return () => undefined;
    return listen<WorkspaceFilesChanged>("workspace-files-changed", (event) =>
      listener(event.payload),
    );
  }

  createMarkdown(
    rootPath: string,
    parentPath: string,
    name: string,
  ): Promise<WorkspaceEntry> {
    return invoke<WorkspaceEntry>("create_workspace_markdown", {
      rootPath,
      parentPath,
      name,
    });
  }

  createDirectory(
    rootPath: string,
    parentPath: string,
    name: string,
  ): Promise<WorkspaceEntry> {
    return invoke<WorkspaceEntry>("create_workspace_directory", {
      rootPath,
      parentPath,
      name,
    });
  }

  renameEntry(
    rootPath: string,
    path: string,
    newStem: string,
  ): Promise<WorkspaceEntry> {
    return invoke<WorkspaceEntry>("rename_workspace_entry", {
      rootPath,
      path,
      newStem,
    });
  }

  trashEntry(rootPath: string, path: string): Promise<void> {
    return invoke("trash_workspace_entry", { rootPath, path });
  }

  updateProjectViewState(
    rootPath: string,
    viewState: ProjectViewState,
  ): Promise<void> {
    return invoke("update_project_view_state", {
      rootPath,
      isExpanded: viewState.isExpanded,
      collapsedPaths: viewState.collapsedPaths,
    });
  }
}

export const workspaceGateway = new TauriWorkspaceGateway();
