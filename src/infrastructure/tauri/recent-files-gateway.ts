import { invoke } from "@tauri-apps/api/core";
import type { RecentFilesGateway } from "../../core/ports/recent-files-gateway";
import {
  forgetRecentFiles,
  relocateRecentFiles,
  rememberRecentFile,
  type RecentFile,
} from "../../core/recent-files";
import { isTauriRuntime } from "./runtime";

export class TauriRecentFilesGateway implements RecentFilesGateway {
  private previewFiles: RecentFile[] = [];

  async list(): Promise<RecentFile[]> {
    if (!isTauriRuntime()) return [...this.previewFiles];
    return invoke<RecentFile[]>("list_recent_files");
  }

  async remember(path: string): Promise<RecentFile[]> {
    if (!isTauriRuntime()) {
      this.previewFiles = rememberRecentFile(this.previewFiles, path);
      return [...this.previewFiles];
    }
    return invoke<RecentFile[]>("remember_recent_file", { path });
  }

  async forget(path: string): Promise<RecentFile[]> {
    if (!isTauriRuntime()) {
      this.previewFiles = forgetRecentFiles(this.previewFiles, path);
      return [...this.previewFiles];
    }
    return invoke<RecentFile[]>("forget_recent_file", { path });
  }

  async relocate(previousPath: string, nextPath: string): Promise<RecentFile[]> {
    if (!isTauriRuntime()) {
      this.previewFiles = relocateRecentFiles(this.previewFiles, previousPath, nextPath);
      return [...this.previewFiles];
    }
    return invoke<RecentFile[]>("relocate_recent_files", { previousPath, nextPath });
  }
}

export const recentFilesGateway = new TauriRecentFilesGateway();
