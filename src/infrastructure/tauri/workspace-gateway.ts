import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { WorkspaceGateway } from "../../core/ports/workspace-gateway";
import type { ProjectRoot, WorkspaceSnapshot } from "../../core/workspace";
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
}

export const workspaceGateway = new TauriWorkspaceGateway();
