import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarSplitPane } from "./sidebar-split-pane";

let host: HTMLDivElement;
let root: Root;
let height: number;
let folderRenders: number;
function Folders() { folderRenders += 1; return <span>folder tree</span>; }
function render() { flushSync(() => root.render(<SidebarSplitPane folders={<Folders />} recent={<span>recent files</span>} />)); }
function separator() { return host.querySelector('[role="separator"]') as HTMLDivElement; }
function pointer(type: string, clientY: number, pointerId = 7) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}
function key(value: string) { flushSync(() => separator().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value }))); }

beforeEach(() => {
  localStorage.clear(); height = 609; folderRenders = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ x: 0, y: 0, top: 0, left: 0, width: 248, height, right: 248, bottom: height, toJSON: () => ({}) }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("sidebar split layout", () => {
  it("tracks a pointer outside the separator, clamps both panes, and persists without rerendering the tree", () => {
    render();
    expect(separator().getAttribute("aria-valuenow")).toBe("60");
    flushSync(() => separator().dispatchEvent(pointer("pointerdown", 300)));
    flushSync(() => window.dispatchEvent(pointer("pointermove", 10_000)));
    expect(separator().getAttribute("aria-valuenow")).toBe("84");
    flushSync(() => window.dispatchEvent(pointer("pointerup", 10_000)));
    expect(folderRenders).toBe(1);
    expect(localStorage.getItem("mardi.sidebar.folderRatio.v1")).toBe("0.84");
    expect(host.querySelector(".is-resizing")).toBeNull();
  });

  it.each(["pointercancel", "lostpointercapture", "blur"])("ends a drag on %s and ignores later moves", (end) => {
    render();
    flushSync(() => separator().dispatchEvent(pointer("pointerdown", 300)));
    flushSync(() => window.dispatchEvent(pointer("pointermove", 360)));
    const value = separator().getAttribute("aria-valuenow");
    flushSync(() => window.dispatchEvent(end === "blur" ? new Event(end) : pointer(end, 360)));
    flushSync(() => window.dispatchEvent(pointer("pointermove", 500)));
    expect(separator().getAttribute("aria-valuenow")).toBe(value);
    expect(host.querySelector(".is-resizing")).toBeNull();
  });

  it("supports keyboard bounds, restores the saved ratio, and keeps both panes visible on resize", () => {
    render();
    key("Home"); expect(separator().getAttribute("aria-valuenow")).toBe("16");
    key("ArrowUp"); expect(separator().getAttribute("aria-valuenow")).toBe("16");
    key("End"); expect(separator().getAttribute("aria-valuenow")).toBe("84");
    key("ArrowUp");
    const before = separator().getAttribute("aria-valuenow");
    flushSync(() => root.unmount()); root = createRoot(host); render();
    expect(separator().getAttribute("aria-valuenow")).toBe(before);
    height = 200;
    flushSync(() => window.dispatchEvent(new Event("resize")));
    expect(separator().getAttribute("aria-valuenow")).toBe("50");
    height = 609;
    flushSync(() => window.dispatchEvent(new Event("resize")));
    expect(separator().getAttribute("aria-valuenow")).toBe(before);
  });

  it("still resizes when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render();
    key("ArrowDown");
    expect(Number(separator().getAttribute("aria-valuenow"))).toBeGreaterThan(60);
  });
});
