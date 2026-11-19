import { useCallback, useEffect, useRef, useState } from "react";
import type { RecentFilesGateway } from "../../core/ports/recent-files-gateway";
import type { RecentFile } from "../../core/recent-files";
import { recentFilesGateway } from "../../infrastructure/tauri/recent-files-gateway";
import { messageFromError } from "../../infrastructure/tauri/runtime";

export function useRecentFiles(gateway: RecentFilesGateway = recentFilesGateway) {
  const [files, setFiles] = useState<RecentFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingLoadsRef = useRef(0);

  // Serialize command invocation and snapshot publication together. IPC may
  // deliver parallel requests out of order, even for synchronous Native handlers.
  const enqueue = useCallback((operation: () => Promise<RecentFile[]>, isLoad = false): Promise<RecentFile[] | null> => {
    if (isLoad) {
      pendingLoadsRef.current += 1;
      if (mountedRef.current) setLoading(true);
    }
    const queued = queueRef.current.then(async () => {
      try {
        const next = await operation();
        if (mountedRef.current) {
          setFiles(next);
          setError(null);
        }
        return next;
      } catch (failure) {
        if (mountedRef.current) setError(`最近文件记录失败：${messageFromError(failure)}`);
        return null;
      } finally {
        if (isLoad) {
          pendingLoadsRef.current -= 1;
          if (mountedRef.current) setLoading(pendingLoadsRef.current > 0);
        }
      }
    });
    queueRef.current = queued.then(() => undefined);
    return queued;
  }, []);

  const reload = useCallback(async () => { await enqueue(() => gateway.list(), true); }, [enqueue, gateway]);
  const remember = useCallback(async (path: string): Promise<RecentFile | null> => {
    const next = await enqueue(() => gateway.remember(path));
    return next?.[0] ?? null;
  }, [enqueue, gateway]);
  const forget = useCallback(async (path: string) => { await enqueue(() => gateway.forget(path)); }, [enqueue, gateway]);
  const relocate = useCallback(async (previousPath: string, nextPath: string) => { await enqueue(() => gateway.relocate(previousPath, nextPath)); }, [enqueue, gateway]);
  const runAfterPending = useCallback(async <T>(operation: () => Promise<T>): Promise<T> => {
    while (true) {
      const pending = queueRef.current;
      await pending;
      // Include remembers queued while waiting. Invoke the filesystem operation
      // directly in this microtask; returning a separate drain promise would
      // leave a gap for another queued remember before the caller resumes.
      if (pending === queueRef.current) return operation();
    }
  }, []);
  const dismissError = useCallback(() => setError(null), []);

  useEffect(() => {
    mountedRef.current = true;
    void reload();
    return () => { mountedRef.current = false; };
  }, [reload]);

  return { files, error, loading, remember, forget, relocate, reload, runAfterPending, dismissError };
}
