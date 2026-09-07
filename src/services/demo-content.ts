import type { DocumentSnapshot } from "../core/document";
import type { RootWorkspace, WorkspaceSnapshot } from "../core/workspace";

export const welcomeMarkdown = `# Welcome to mardi

mardi is a lightweight Markdown editor and viewer for macOS, designed for calm, focused writing and reading.

## A quieter Markdown workflow

- Focus on your content, not the interface.
- Instant preview and clean rendering.
- Simple, fast, and gets out of your way.
- Works beautifully with your existing files.

> Good writing is about clarity. Good tools help you stay in the flow.

\`\`\`ts
function greet(name: string) {
  const message = \`Welcome to mardi, \${name}!\`;
  return message;
}
\`\`\`
`;

export const browserDemoDocument: DocumentSnapshot = {
  path: "/preview/Documents/welcome.md",
  name: "welcome.md",
  content: welcomeMarkdown,
};

export const browserDemoWorkspace: WorkspaceSnapshot = {
  rootPath: "/preview/Documents",
  rootName: "Documents",
  entries: [
    {
      path: browserDemoDocument.path,
      name: "welcome.md",
      kind: "markdown",
      children: [],
    },
    {
      path: "/preview/Documents/notes.md",
      name: "notes.md",
      kind: "markdown",
      children: [],
    },
    {
      path: "/preview/Documents/ideas.md",
      name: "ideas.md",
      kind: "markdown",
      children: [],
    },
  ],
  isTruncated: false,
};

export const browserDemoRoots: RootWorkspace[] = [
  {
    root: {
      rootPath: browserDemoWorkspace.rootPath,
      name: browserDemoWorkspace.rootName,
      lastOpenedAt: 2,
    },
    entries: browserDemoWorkspace.entries,
    isExpanded: true,
    isLoading: false,
    isTruncated: false,
    error: null,
  },
  {
    root: {
      rootPath: "/preview/work-wiki",
      name: "work-wiki",
      lastOpenedAt: 1,
    },
    entries: [],
    isExpanded: false,
    isLoading: false,
    isTruncated: false,
    error: null,
  },
];
