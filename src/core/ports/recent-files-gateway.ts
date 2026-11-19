import type { RecentFile } from "../recent-files";

export interface RecentFilesGateway {
  list(): Promise<RecentFile[]>;
  remember(path: string): Promise<RecentFile[]>;
  forget(path: string): Promise<RecentFile[]>;
  relocate(previousPath: string, nextPath: string): Promise<RecentFile[]>;
}
