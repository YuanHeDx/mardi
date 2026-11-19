import { isolateHistory } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { documentGateway } from "../../infrastructure/tauri/document-gateway";
import { isTauriRuntime } from "../../infrastructure/tauri/runtime";
import { markdownRenderer } from "../../services/markdown-renderer";

export interface ResourceContext {
  generation: number;
  documentPath: string;
  workspaceRoot: string | null;
}

export function toggleTask(view: EditorView, from: number): boolean {
  const marker = view.state.sliceDoc(from, from + 3);
  if (!/^\[[ xX]\]$/.test(marker) || view.composing) return false;
  view.dispatch({
    changes: { from: from + 1, to: from + 2, insert: marker[1] === " " ? "x" : " " },
    annotations: [isolateHistory.of("full"), Transaction.userEvent.of("input.task")],
  });
  return true;
}

export class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) { super(); }
  eq(other: TaskWidget) { return this.checked === other.checked; }
  toDOM(view: EditorView) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "cm-task-checkbox";
    checkbox.checked = this.checked;
    // The source marker is keyboard-editable on the active line. Keep this
    // display affordance out of the document's Tab order.
    checkbox.tabIndex = -1;
    checkbox.setAttribute("aria-label", this.checked ? "标记为未完成" : "标记为完成");
    checkbox.addEventListener("mousedown", (event) => event.preventDefault());
    checkbox.addEventListener("click", (event) => {
      event.preventDefault();
      const from = view.posAtDOM(checkbox);
      toggleTask(view, from);
    });
    return checkbox;
  }
  ignoreEvent() { return true; }
}

export class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-list-bullet";
    element.textContent = "•";
    return element;
  }
  ignoreEvent() { return false; }
}

interface TableRowSource { from: number; cells: number[]; }
export class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly rows: TableRowSource[]) { super(); }
  eq(other: TableWidget) {
    return this.source === other.source && this.rows[0]?.from === other.rows[0]?.from;
  }
  toDOM() {
    const element = document.createElement("div");
    element.className = "cm-preview-table";
    element.innerHTML = markdownRenderer.render(this.source).html;
    element.setAttribute("aria-label", "Markdown 表格，点击编辑源码");
    element.querySelectorAll("tr").forEach((row, index) => {
      row.querySelectorAll<HTMLElement>("th, td").forEach((cell, column) => {
        const position = this.rows[index]?.cells[column] ?? this.rows[index]?.from;
        if (position !== undefined) cell.dataset.mardiTableSource = String(position);
      });
    });
    return element;
  }
  // Let CM's public mouseSelectionStyle start its native gesture lifecycle.
  ignoreEvent() { return false; }
}

// Only successful/failed authorized gateway requests are shared. The cache is
// bounded, and context is part of its key (rename changes resource authority).
const imageRequests = new Map<string, Promise<string>>();
export function imageRequest(context: ResourceContext, source: string): Promise<string> {
  const key = JSON.stringify([context.generation, context.documentPath, context.workspaceRoot, source]);
  let request = imageRequests.get(key);
  if (!request) {
    request = isTauriRuntime() && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)
      ? Promise.resolve().then(() => documentGateway.readLocalImage(context.documentPath, source, context.workspaceRoot))
      : Promise.reject(new Error("Unsupported image source"));
    // Attach immediately, including when the widget is removed before toDOM.
    const pending = request;
    void request.catch(() => { if (imageRequests.get(key) === pending) imageRequests.delete(key); });
    imageRequests.set(key, request);
    if (imageRequests.size > 64) imageRequests.delete(imageRequests.keys().next().value!);
  }
  return request;
}

export class ImageWidget extends WidgetType {
  constructor(readonly source: string, readonly alt: string, readonly context: ResourceContext) { super(); }
  get key() {
    return JSON.stringify([this.source, this.context.generation, this.context.documentPath, this.context.workspaceRoot]);
  }
  eq(other: ImageWidget) { return this.key === other.key && this.alt === other.alt; }
  updateDOM(dom: HTMLElement) {
    if (dom.dataset.imageKey !== this.key) return false;
    const image = dom.querySelector("img");
    if (image) image.alt = this.alt;
    const label = dom.querySelector(".cm-image-label");
    if (label) label.textContent = this.alt;
    return true;
  }
  toDOM(view: EditorView) {
    const element = document.createElement("div");
    element.className = "cm-preview-image is-loading";
    element.dataset.imageKey = this.key;
    element.dataset.alive = "true";
    const image = document.createElement("img");
    image.alt = this.alt;
    const label = document.createElement("span");
    label.className = "cm-image-label";
    label.textContent = this.alt;
    const status = document.createElement("span");
    status.className = "cm-image-status";
    status.textContent = "图片加载中…";
    element.append(image, label, status);
    const live = () => element.dataset.alive === "true" && element.isConnected;
    const failed = () => {
      if (!live()) return;
      element.className = "cm-preview-image is-error";
      status.textContent = "图片无法显示";
      view.requestMeasure();
    };
    image.addEventListener("load", () => {
      if (!live()) return;
      element.className = "cm-preview-image";
      status.textContent = "";
      view.requestMeasure();
    });
    image.addEventListener("error", failed);
    void imageRequest(this.context, this.source).then((dataUrl) => {
      if (live()) image.src = dataUrl;
    }, failed);
    element.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || view.composing) return;
      event.preventDefault();
      // The preview is a block widget below its source line. Resolve its
      // current DOM position rather than retaining an offset across edits.
      const end = view.posAtDOM(element);
      const line = view.state.doc.lineAt(Math.max(0, end));
      view.dispatch({ selection: { anchor: line.from } });
      view.focus();
    });
    return element;
  }
  destroy(dom: HTMLElement) { dom.dataset.alive = "false"; }
  ignoreEvent(event: Event) { return event.type === "mousedown"; }
}
