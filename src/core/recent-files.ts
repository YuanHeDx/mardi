import { fileKindFromPath, fileNameFromPath, isPathWithinRoot, replacePathPrefix } from "./workspace";

export type RecentFileKind = "markdown" | "image" | "video";

export interface RecentFile {
  path: string;
  name: string;
  kind: RecentFileKind;
  lastOpenedAt: number;
}

export const MAX_RECENT_FILES = 100;

export function normalizeRecentFiles(files: RecentFile[]): RecentFile[] {
  const paths = new Set<string>();
  return [...files]
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    .filter((file) => {
      if (paths.has(file.path)) return false;
      paths.add(file.path);
      return true;
    })
    .slice(0, MAX_RECENT_FILES);
}

// Browser preview uses the same MRU behavior; native owns filesystem validation.
export function rememberRecentFile(files: RecentFile[], path: string, now = Date.now()): RecentFile[] {
  const kind = fileKindFromPath(path);
  if (!kind) throw new Error("mardi 不支持这个文件类型");
  const lastOpenedAt = Math.max(now, ...files.map((file) => file.lastOpenedAt));
  return normalizeRecentFiles([
    { path, name: fileNameFromPath(path), kind, lastOpenedAt },
    ...files.filter((file) => file.path !== path),
  ]);
}

export function forgetRecentFiles(files: RecentFile[], path: string): RecentFile[] {
  return files.filter((file) => !isPathWithinRoot(file.path, path));
}

export function relocateRecentFiles(files: RecentFile[], previousPath: string, nextPath: string): RecentFile[] {
  return normalizeRecentFiles(files.map((file) => {
    const path = replacePathPrefix(file.path, previousPath, nextPath);
    return path === file.path ? file : { ...file, path, name: fileNameFromPath(path) };
  }));
}
