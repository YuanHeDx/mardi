import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { MediaGateway } from "../../core/ports/media-gateway";
import { isTauriRuntime } from "./runtime";

export class TauriMediaGateway implements MediaGateway {
  async prepareSource(path: string): Promise<string> {
    if (!isTauriRuntime()) return path;
    const canonicalPath = await invoke<string>("prepare_media_source", { path });
    return convertFileSrc(canonicalPath);
  }
}

export const mediaGateway = new TauriMediaGateway();
