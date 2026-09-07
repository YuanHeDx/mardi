import type { DocumentSnapshot } from "../document";

export interface DocumentGateway {
  chooseSupportedFile(): Promise<string | null>;
  readDocument(path: string): Promise<DocumentSnapshot>;
  writeDocument(path: string, content: string): Promise<void>;
  readLocalImage(
    documentPath: string,
    source: string,
    workspaceRoot: string | null,
  ): Promise<string>;
}
