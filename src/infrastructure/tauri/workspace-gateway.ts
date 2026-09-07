import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { WorkspaceGateway } from "../../core/ports/workspace-gateway";
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

  renameFile(
    rootPath: string,
    path: string,
    newStem: string,
  ): Promise<WorkspaceEntry> {
    return invoke<WorkspaceEntry>("rename_workspace_file", {
      rootPath,
      path,
      newStem,
    });
  }

  trashFile(rootPath: string, path: string): Promise<void> {
    return invoke("trash_workspace_file", { rootPath, path });
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
