export interface RenderedMarkdown {
  html: string;
  localImageSources: string[];
}

export interface MarkdownRenderer {
  render(source: string): RenderedMarkdown;
}
