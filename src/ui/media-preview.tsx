import { FileWarning } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaContent } from "../core/workspace";
import { mediaGateway } from "../infrastructure/tauri/media-gateway";

interface MediaPreviewProps {
  media: MediaContent;
}

export function MediaPreview({ media }: MediaPreviewProps) {
  const source = useMemo(() => mediaGateway.sourceFor(media.path), [media.path]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
  }, [source]);

  useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [source]);

  if (hasError) {
    return (
      <div className="media-preview media-error" role="alert">
        <FileWarning />
        <strong>无法预览这个{media.kind === "image" ? "图片" : "视频"}</strong>
        <span>
          {media.kind === "video"
            ? "文件格式或编码可能不受系统播放器支持。"
            : "文件可能已移动、损坏或格式不受支持。"}
        </span>
      </div>
    );
  }

  return (
    <div className={`media-preview media-${media.kind}`} aria-busy={!isLoaded}>
      {!isLoaded ? <span className="media-loading">正在载入…</span> : null}
      {media.kind === "image" ? (
        <img
          alt={media.name}
          onError={() => setHasError(true)}
          onLoad={() => setIsLoaded(true)}
          src={source}
        />
      ) : (
        <video
          controls
          onError={() => setHasError(true)}
          onLoadedMetadata={() => setIsLoaded(true)}
          playsInline
          preload="metadata"
          ref={videoRef}
          src={source}
        >
          你的系统不支持此视频格式。
        </video>
      )}
    </div>
  );
}
