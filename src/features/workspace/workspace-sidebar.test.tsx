import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RootWorkspace } from "../../core/workspace";
import { WorkspaceSidebar } from "./workspace-sidebar";
import type { ComponentProps } from "react";

const workspace: RootWorkspace = {
  root: {
    rootPath: "/notes",
    name: "notes",
    lastOpenedAt: 1,
  },
  entries: [
    {
      path: "/notes/empty-folder",
      name: "empty-folder",
      kind: "directory",
      children: [],
    },
    {
      path: "/notes/meeting-notes.md",
      name: "meeting-notes.md",
      kind: "markdown",
      children: [],
    },
    {
      path: "/notes/unreadable",
      name: "unreadable",
      kind: "directory",
      children: [],
      error: "Permission denied",
    },
  ],
  isExpanded: true,
  isLoading: false,
  isTruncated: false,
  error: null,
  collapsedPaths: [],
};

function renderSidebar(overrides: Partial<ComponentProps<typeof WorkspaceSidebar>> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onCreateDirectory = vi.fn(async () => true);
  const onRefreshFiles = vi.fn(async () => undefined);

  flushSync(() => {
    root.render(
      <WorkspaceSidebar
        activePath={null}
        canManageFiles
        onCreateDirectory={onCreateDirectory}
        onCreateFile={async () => true}
        onDeleteFile={async () => true}
        onExpandPath={() => undefined}
        onOpenFile={() => undefined}
        onOpenFolder={() => undefined}
        onRefreshFiles={onRefreshFiles}
        onRemoveRoot={() => undefined}
        onRenameFile={async () => true}
        onRetryRoot={() => undefined}
        onSelectEntry={() => undefined}
        onTogglePath={() => undefined}
        onToggleRoot={() => undefined}
        roots={[workspace]}
        {...overrides}
      />,
    );
  });

  return { host, onCreateDirectory, onRefreshFiles, root };
}

describe("WorkspaceSidebar", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("renders empty directories in the file tree", () => {
    const { host, root } = renderSidebar();

    expect(host.querySelector('[title="/notes/empty-folder"]')).not.toBeNull();
    expect(host.textContent).toContain("empty-folder");

    root.unmount();
  });

  it("keeps standalone recent files available without any open folders", () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const files = [
      { path: "/outside/first/note.md", name: "note.md", kind: "markdown" as const, lastOpenedAt: 2 },
      { path: "/outside/second/note.md", name: "note.md", kind: "markdown" as const, lastOpenedAt: 1 },
    ];
    const { host, root } = renderSidebar({ roots: [], recentFiles: files, activePath: files[0].path, onSelectRecentFile: onOpen, onRemoveRecentFile: onRemove });
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".recent-file-open")];
    expect(buttons.map((button) => button.title)).toEqual(files.map((file) => file.path));
    expect(host.textContent).toContain("outside/first");
    expect(host.textContent).toContain("outside/second");
    expect(buttons[0].getAttribute("aria-current")).toBe("page");
    flushSync(() => buttons[0].click());
    expect(onOpen).toHaveBeenCalledWith(files[0]);
    flushSync(() => (host.querySelector(".recent-file-remove") as HTMLButtonElement).click());
    expect(onRemove).toHaveBeenCalledWith(files[0].path);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="separator"]')).not.toBeNull();
    root.unmount();
  });

  it("keeps the tree usable when recent history needs a retry", () => {
    const retry = vi.fn();
    const { host, root } = renderSidebar({ recentFilesError: "disk unavailable", onRetryRecentFiles: retry });
    expect(host.querySelector('[title="/notes/meeting-notes.md"]')).not.toBeNull();
    flushSync(() => (host.querySelector('[aria-label="重试读取最近记录"]') as HTMLButtonElement).click());
    expect(retry).toHaveBeenCalledOnce();
    root.unmount();
  });

  it.each([
    ["/notes", "button"],
    ["/notes", "menu"],
    ["/notes/empty-folder", "button"],
    ["/notes/empty-folder", "menu"],
  ])("creates a named file in %s using the %s", (parent, action) => {
    const onCreateFile = vi.fn(async () => true);
    const onToggleRoot = vi.fn();
    const onTogglePath = vi.fn();
    const { host, root } = renderSidebar({ onCreateFile, onToggleRoot, onTogglePath });
    const folder = host.querySelector<HTMLButtonElement>(`[title="${parent}"]`)!;
    if (action === "button") {
      flushSync(() => folder.parentElement!.querySelector<HTMLButtonElement>(".folder-create")!.click());
    } else {
      flushSync(() => folder.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
      const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((item) => item.textContent === "新建 Markdown")!;
      flushSync(() => item.click());
    }

    const input = host.querySelector<HTMLInputElement>('[aria-label="文件名"]')!;
    expect(document.activeElement).toBe(input);
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "会议.v2.md");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onCreateFile).toHaveBeenCalledExactlyOnceWith("/notes", parent, "会议.v2");
    expect(onToggleRoot).not.toHaveBeenCalled();
    expect(onTogglePath).not.toHaveBeenCalled();
    root.unmount();
  });

  it("reveals a filtered creation target below collapsed ancestors", () => {
    const parent = "/notes/archive";
    const target = parent + "/drafts";
    const onExpandPath = vi.fn();
    const { host, root } = renderSidebar({
      roots: [{
        ...workspace,
        entries: [{ path: parent, name: "archive", kind: "directory", children: [
          { path: target, name: "drafts", kind: "directory", children: [] },
        ] }],
        collapsedPaths: [parent, target],
      }],
      onExpandPath,
    });
    const filter = host.querySelector<HTMLInputElement>('[aria-label="筛选文件树"]')!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(filter, "drafts");
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="在 drafts 中新建 Markdown"]')!.click());
    expect(filter.value).toBe("");
    expect(onExpandPath.mock.calls).toEqual([["/notes", parent], ["/notes", target]]);
    root.unmount();
  });

  it("only offers the row button on manageable folders", () => {
    const { host, root } = renderSidebar();
    expect([...host.querySelectorAll(".folder-create")].map((button) => button.getAttribute("aria-label")))
      .toEqual(["在 notes 中新建 Markdown", "在 empty-folder 中新建 Markdown"]);
    root.unmount();
    const readOnly = renderSidebar({ canManageFiles: false });
    expect(readOnly.host.querySelector(".folder-create")).toBeNull();
    readOnly.root.unmount();
  });

  it("offers new folder from the root context menu", () => {
    const { host, root } = renderSidebar();
    const rootButton = host.querySelector('[title="/notes"]') as HTMLButtonElement;

    flushSync(() => {
      rootButton.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 40,
          clientY: 40,
        }),
      );
    });

    const newFolderItem = [...document.querySelectorAll('[role="menuitem"]')]
      .find((item) => item.textContent?.includes("新建文件夹")) as HTMLButtonElement;
    expect(newFolderItem).not.toBeUndefined();

    flushSync(() => newFolderItem.click());
    const editor = host.querySelector('[aria-label="文件名"]') as HTMLInputElement;
    expect(editor.value).toBe("未命名文件夹");

    root.unmount();
  });

  it("shows an unreadable subtree without replacing the root", () => {
    const { host, root } = renderSidebar();

    expect(host.textContent).toContain("meeting-notes.md");
    expect(host.textContent).toContain("无法读取此文件夹");
    expect(host.querySelector('[title="Permission denied"]')).not.toBeNull();

    root.unmount();
  });

  it("filters by file name and can clear the filter", () => {
    const { host, root } = renderSidebar();
    const input = host.querySelector(
      '[aria-label="筛选文件树"]',
    ) as HTMLInputElement;

    flushSync(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "meeting");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("meeting-notes.md");
    expect(host.textContent).not.toContain("empty-folder");

    flushSync(() => {
      (host.querySelector('[aria-label="清除筛选"]') as HTMLButtonElement).click();
    });
    expect(host.textContent).toContain("empty-folder");

    root.unmount();
  });

  it("exposes a manual refresh action", () => {
    const { host, onRefreshFiles, root } = renderSidebar();

    flushSync(() => {
      (host.querySelector('[aria-label="刷新文件树"]') as HTMLButtonElement).click();
    });
    expect(onRefreshFiles).toHaveBeenCalledTimes(1);

    root.unmount();
  });
});
