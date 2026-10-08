import type { DocumentSnapshot } from "../document";

export interface DocumentLocation {
  path: string;
  name: string;
  fileId: string;
}

export interface DocumentGateway {
  chooseSupportedFile(): Promise<string | null>;
  readDocument(path: string): Promise<DocumentSnapshot>;
  locateDocument(
    currentPath: string,
    fileId: string,
    rootPaths: string[],
    candidatePaths: string[],
  ): Promise<DocumentLocation | null>;
  writeDocument(path: string, content: string): Promise<void>;
  readLocalImage(
    documentPath: string,
    source: string,
    workspaceRoot: string | null,
  ): Promise<string>;
}
