import { FileWarning } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MediaContent } from "../core/workspace";
import { mediaGateway } from "../infrastructure/tauri/media-gateway";
import { messageFromError } from "../infrastructure/tauri/runtime";

interface MediaPreviewProps { media: MediaContent; }
interface PreviewState { key: string; source: string | null; isLoaded: boolean; error: string | null; }

export function MediaPreview({ media }: MediaPreviewProps) {
  const key = JSON.stringify([media.openGeneration, media.path]);
  const [preview, setPreview] = useState<PreviewState>({ key, source: null, isLoaded: false, error: null });
  const videoRef = useRef<HTMLVideoElement>(null);
  const current = preview.key === key ? preview : { key, source: null, isLoaded: false, error: null };

  useEffect(() => {
    let alive = true;
    setPreview({ key, source: null, isLoaded: false, error: null });
    void Promise.resolve().then(() => mediaGateway.prepareSource(media.path)).then((source) => {
      if (!alive) return;
      // Each explicit open retries decoding/network state, including a file
      // previously denied before its exact native grant or repaired on disk.
      const freshSource = `${source}${source.includes("?") ? "&" : "?"}mardi-open=${media.openGeneration}`;
      setPreview({ key, source: freshSource, isLoaded: false, error: null });
    }, (error) => {
      if (alive) setPreview({ key, source: null, isLoaded: false, error: messageFromError(error) });
    });
    return () => { alive = false; };
  }, [key, media.path, media.openGeneration]);

  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [key, current.source]);

  const loaded = () => setPreview((value) => value.key === key ? { ...value, isLoaded: true } : value);
  const failed = () => setPreview((value) => value.key === key ? {
    ...value,
    error: media.kind === "video" ? "文件格式或编码可能不受系统播放器支持。" : "文件可能已移动、损坏或格式不受支持。",
  } : value);

  if (current.error) {
    return (
      <div className="media-preview media-error" role="alert">
        <FileWarning />
        <strong>无法预览这个{media.kind === "image" ? "图片" : "视频"}</strong>
        <span>{current.error}</span>
      </div>
    );
  }

  return (
    <div className={`media-preview media-${media.kind}`} aria-busy={!current.isLoaded}>
      {!current.isLoaded ? <span className="media-loading">正在载入…</span> : null}
      {current.source ? media.kind === "image" ? (
        <img alt={media.name} key={key} onError={failed} onLoad={loaded} src={current.source} />
      ) : (
        <video controls key={key} onError={failed} onLoadedMetadata={loaded} playsInline preload="metadata" ref={videoRef} src={current.source}>
          你的系统不支持此视频格式。
        </video>
      ) : null}
    </div>
  );
}
