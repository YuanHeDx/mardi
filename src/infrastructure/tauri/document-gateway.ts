import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DocumentSnapshot } from "../../core/document";
import type { DocumentGateway } from "../../core/ports/document-gateway";
import { isTauriRuntime } from "./runtime";

export class TauriDocumentGateway implements DocumentGateway {
  async chooseSupportedFile(): Promise<string | null> {
    if (!isTauriRuntime()) return null;

    const selection = await open({
      directory: false,
      multiple: false,
      filters: [
        {
          name: "mardi 支持的文件",
          extensions: [
            "md",
            "markdown",
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
            "bmp",
            "avif",
            "mp4",
            "mov",
            "m4v",
            "webm",
          ],
        },
      ],
    });

    return typeof selection === "string" ? selection : null;
  }

  readDocument(path: string): Promise<DocumentSnapshot> {
    return invoke<DocumentSnapshot>("read_document", { path });
  }

  writeDocument(path: string, content: string): Promise<void> {
    return invoke("write_document", { path, content });
  }

  readLocalImage(
    documentPath: string,
    source: string,
    workspaceRoot: string | null,
  ): Promise<string> {
    return invoke<string>("read_local_image", {
      documentPath,
      source: decodeURI(source),
      workspaceRoot,
    });
  }
}

export const documentGateway = new TauriDocumentGateway();
