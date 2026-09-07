import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri/runtime";

export async function copyPlainText(text: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("copy_text_to_clipboard", { text });
    return;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // WKWebView may expose Clipboard without granting it for every context.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("无法写入剪贴板");
}
