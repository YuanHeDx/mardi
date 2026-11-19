import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const STORAGE_KEY = "mardi.sidebar.folderRatio.v1";
const DEFAULT_RATIO = 0.6;
const DIVIDER_HEIGHT = 9;
const MIN_PANEL_HEIGHT = 96;

function initialRatio() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      const value = Number(stored);
      if (Number.isFinite(value) && value > 0 && value < 1) return value;
    }
  } catch { /* The splitter remains usable when storage is unavailable. */ }
  return DEFAULT_RATIO;
}

function limits(height: number) {
  const available = height - DIVIDER_HEIGHT;
  const minimum = available > 0 ? Math.min(0.5, MIN_PANEL_HEIGHT / available) : 0.2;
  return { minimum, maximum: 1 - minimum, available };
}

function constrain(value: number, height: number) {
  const { minimum, maximum } = limits(height);
  return Math.min(maximum, Math.max(minimum, value));
}

function persist(ratio: number) {
  try { localStorage.setItem(STORAGE_KEY, String(ratio)); } catch { /* Optional UI preference. */ }
}

interface Drag {
  pointerId: number;
  startY: number;
  startRatio: number;
  height: number;
  target: HTMLDivElement;
}

export function SidebarSplitPane({ folders, recent }: { folders: ReactNode; recent: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(initialRatio);
  const ratioRef = useRef(ratio);
  const [height, setHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const foldersId = useId();
  const recentId = useId();
  const visibleRatio = constrain(ratio, height);
  const range = limits(height);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setHeight(element.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      const next = constrain(current.startRatio + (event.clientY - current.startY) / (current.height - DIVIDER_HEIGHT), current.height);
      ratioRef.current = next;
      setRatio(next);
    };
    const finish = (event?: PointerEvent) => {
      const current = drag.current;
      if (!current || (event && event.pointerId !== current.pointerId)) return;
      drag.current = null;
      persist(ratioRef.current);
      setDragging(false);
      if (current.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    };
    const blur = () => finish();
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("lostpointercapture", finish);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("lostpointercapture", finish);
      window.removeEventListener("blur", blur);
      const current = drag.current;
      drag.current = null;
      if (current?.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    };
  }, []);

  return (
    <div
      className={`sidebar-split-pane${dragging ? " is-resizing" : ""}`}
      ref={container}
      style={{ gridTemplateRows: `minmax(0, ${visibleRatio}fr) ${DIVIDER_HEIGHT}px minmax(0, ${1 - visibleRatio}fr)` }}
    >
      <section className="sidebar-panel sidebar-folders-panel" id={foldersId} aria-label="文件夹">
        {folders}
      </section>
      <div
        aria-controls={`${foldersId} ${recentId}`}
        aria-label="调整文件夹与最近列表高度"
        aria-orientation="horizontal"
        aria-valuemax={Math.round(range.maximum * 100)}
        aria-valuemin={Math.round(range.minimum * 100)}
        aria-valuenow={Math.round(visibleRatio * 100)}
        aria-valuetext={`文件夹 ${Math.round(visibleRatio * 100)}%，最近 ${Math.round((1 - visibleRatio) * 100)}%`}
        className="sidebar-divider"
        onKeyDown={(event) => {
          const currentHeight = container.current?.getBoundingClientRect().height ?? height;
          const bounds = limits(currentHeight);
          const step = bounds.available > 0 ? 20 / bounds.available : 0.05;
          const current = constrain(ratioRef.current, currentHeight);
          const next = event.key === "ArrowUp" ? current - step : event.key === "ArrowDown" ? current + step : event.key === "Home" ? bounds.minimum : event.key === "End" ? bounds.maximum : null;
          if (next === null) return;
          event.preventDefault();
          ratioRef.current = constrain(next, currentHeight);
          setRatio(ratioRef.current);
          persist(ratioRef.current);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) return;
          const currentHeight = container.current?.getBoundingClientRect().height ?? 0;
          if (currentHeight <= DIVIDER_HEIGHT) return;
          event.preventDefault();
          event.currentTarget.focus();
          const currentRatio = constrain(ratioRef.current, currentHeight);
          ratioRef.current = currentRatio;
          drag.current = { pointerId: event.pointerId, startY: event.clientY, startRatio: currentRatio, height: currentHeight, target: event.currentTarget };
          setDragging(true);
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners retain the drag if capture is unavailable. */ }
        }}
        role="separator"
        tabIndex={0}
      />
      <section className="sidebar-panel sidebar-recent-panel" id={recentId} aria-label="最近">
        {recent}
      </section>
    </div>
  );
}
