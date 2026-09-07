import type {
  ProjectRoot,
  ProjectViewState,
  WorkspaceEntry,
  WorkspaceSnapshot,
} from "../workspace";

export interface WorkspaceGateway {
  chooseWorkspaceFolder(): Promise<string | null>;
  listProjectRoots(): Promise<ProjectRoot[]>;
  rememberProjectRoot(rootPath: string): Promise<ProjectRoot>;
  forgetProjectRoot(rootPath: string): Promise<void>;
  listWorkspace(rootPath: string): Promise<WorkspaceSnapshot>;
  createMarkdown(
    rootPath: string,
    parentPath: string,
    name: string,
  ): Promise<WorkspaceEntry>;
  renameEntry(
    rootPath: string,
    path: string,
    newStem: string,
  ): Promise<WorkspaceEntry>;
  trashEntry(rootPath: string, path: string): Promise<void>;
  updateProjectViewState(
    rootPath: string,
    viewState: ProjectViewState,
  ): Promise<void>;
}
