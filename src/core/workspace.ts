export type FileKind = "directory" | "markdown" | "image" | "video";

export interface WorkspaceEntry {
  path: string;
  name: string;
  kind: FileKind;
  children: WorkspaceEntry[];
}

export interface WorkspaceSnapshot {
  rootPath: string;
  rootName: string;
  entries: WorkspaceEntry[];
  isTruncated: boolean;
}

export interface ProjectRoot {
  rootPath: string;
  name: string;
  lastOpenedAt: number;
}

export interface RootWorkspace {
  root: ProjectRoot;
  entries: WorkspaceEntry[] | null;
  isExpanded: boolean;
  isLoading: boolean;
  isTruncated: boolean;
  error: string | null;
}

export type MediaKind = "image" | "video";

export interface MediaContent {
  kind: MediaKind;
  path: string;
  name: string;
  rootPath: string | null;
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "avif",
]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm"]);

export function fileKindFromPath(
  path: string,
): Exclude<FileKind, "directory"> | null {
  const extension = path.split(".").pop()?.toLowerCase();
  if (!extension) return null;
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function flattenMarkdownFiles(
  entries: WorkspaceEntry[],
): WorkspaceEntry[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "directory") {
      return flattenMarkdownFiles(entry.children);
    }
    return entry.kind === "markdown" ? [entry] : [];
  });
}

export function isPathWithinRoot(path: string, rootPath: string): boolean {
  const separator = path.includes("\\") || rootPath.includes("\\") ? "\\" : "/";
  const normalizedRoot = rootPath.endsWith(separator)
    ? rootPath.slice(0, -1)
    : rootPath;
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}${separator}`);
}

export function findRootPathForFile(
  roots: RootWorkspace[],
  path: string,
): string | null {
  let closestRoot: string | null = null;
  for (const workspace of roots) {
    const rootPath = workspace.root.rootPath;
    if (
      isPathWithinRoot(path, rootPath) &&
      (!closestRoot || rootPath.length > closestRoot.length)
    ) {
      closestRoot = rootPath;
    }
  }
  return closestRoot;
}
