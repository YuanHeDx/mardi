export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
