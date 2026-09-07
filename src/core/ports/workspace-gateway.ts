import type { ProjectRoot, WorkspaceSnapshot } from "../workspace";

export interface WorkspaceGateway {
  chooseWorkspaceFolder(): Promise<string | null>;
  listProjectRoots(): Promise<ProjectRoot[]>;
  rememberProjectRoot(rootPath: string): Promise<ProjectRoot>;
  forgetProjectRoot(rootPath: string): Promise<void>;
  listWorkspace(rootPath: string): Promise<WorkspaceSnapshot>;
}
