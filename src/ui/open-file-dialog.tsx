import { FileSearch, FolderOpen, X } from "lucide-react";
import { useState, type FormEvent, type MouseEvent } from "react";
import { fileKindFromPath } from "../core/workspace";

interface OpenFileDialogProps {
  onCancel: () => void;
  onChooseFile: () => Promise<boolean>;
  onOpenPath: (path: string) => Promise<boolean>;
}

export function isAbsoluteFilePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.startsWith("\\\\")
  );
}

export function OpenFileDialog({
  onCancel,
  onChooseFile,
  onOpenPath,
}: OpenFileDialogProps) {
  const [path, setPath] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  const openPath = async (event: FormEvent) => {
    event.preventDefault();
    if (isOpening) return;

    const candidate = path.trim();
    if (!candidate) {
      setValidationError("请输入文件的绝对路径");
      return;
    }
    if (!isAbsoluteFilePath(candidate)) {
      setValidationError("请输入以 / 开头的绝对路径");
      return;
    }
    if (!fileKindFromPath(candidate)) {
      setValidationError("mardi 不支持此文件类型");
      return;
    }

    setValidationError(null);
    setIsOpening(true);
    try {
      if (await onOpenPath(candidate)) onCancel();
    } finally {
      setIsOpening(false);
    }
  };

  const chooseFile = async () => {
    if (isOpening) return;
    setValidationError(null);
    setIsOpening(true);
    try {
      if (await onChooseFile()) onCancel();
    } finally {
      setIsOpening(false);
    }
  };

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isOpening) onCancel();
  };

  return (
    <div
      aria-label="打开文件"
      className="dialog-backdrop"
      onClick={closeFromBackdrop}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isOpening) onCancel();
      }}
      role="dialog"
      aria-modal="true"
    >
      <section className="open-file-dialog">
        <div className="dialog-header">
          <div>
            <h2>打开文件</h2>
            <p>输入 Markdown、图片或视频的绝对路径</p>
          </div>
          <button
            aria-label="关闭"
            className="dialog-close"
            disabled={isOpening}
            onClick={onCancel}
            type="button"
          >
            <X />
          </button>
        </div>

        <form onSubmit={(event) => void openPath(event)}>
          <label htmlFor="open-file-path">绝对路径</label>
          <div className="open-path-input">
            <FileSearch aria-hidden="true" />
            <input
              aria-describedby={
                validationError ? "open-file-path-error" : undefined
              }
              aria-invalid={Boolean(validationError)}
              autoFocus
              disabled={isOpening}
              id="open-file-path"
              onChange={(event) => {
                setPath(event.target.value);
                setValidationError(null);
              }}
              placeholder="/Users/you/Documents/notes.md"
              spellCheck={false}
              value={path}
            />
          </div>
          <div className="open-path-message" id="open-file-path-error">
            {validationError ?? "支持 .md、.markdown 及预览媒体格式"}
          </div>

          <div className="dialog-actions">
            <button
              className="dialog-secondary-button"
              disabled={isOpening}
              onClick={() => void chooseFile()}
              type="button"
            >
              <FolderOpen />
              从文件管理器选择
            </button>
            <button
              className="dialog-primary-button"
              disabled={isOpening || !path.trim()}
              type="submit"
            >
              {isOpening ? "正在打开…" : "打开"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
