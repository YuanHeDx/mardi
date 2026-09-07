import { convertFileSrc } from "@tauri-apps/api/core";
import type { MediaGateway } from "../../core/ports/media-gateway";
import { isTauriRuntime } from "./runtime";

export class TauriMediaGateway implements MediaGateway {
  sourceFor(path: string): string {
    return isTauriRuntime() ? convertFileSrc(path) : path;
  }
}

export const mediaGateway = new TauriMediaGateway();
