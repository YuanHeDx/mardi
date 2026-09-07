import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import MarkdownIt from "markdown-it";
import type {
  MarkdownIt as MarkdownItInstance,
  RendererRule,
} from "markdown-it";
import taskLists from "markdown-it-task-lists";
import type {
  MarkdownRenderer,
  RenderedMarkdown,
} from "../core/ports/markdown-renderer";

for (const [name, language] of Object.entries({
  bash,
  css,
  html: xml,
  javascript,
  json,
  markdown: markdownLanguage,
  typescript,
  xml,
})) {
  hljs.registerLanguage(name, language);
}

function isLocalImage(source: string): boolean {
  return !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source);
}

interface MarkdownEnvironment {
  localImageSources: Set<string>;
}

export class SafeMarkdownRenderer implements MarkdownRenderer {
  private readonly parser: MarkdownItInstance;

  constructor() {
    const markdownUtils = new MarkdownIt().utils;
    this.parser = new MarkdownIt({
      breaks: false,
      html: false,
      linkify: true,
      typographer: true,
      highlight(code, language) {
        if (language && hljs.getLanguage(language)) {
          return hljs.highlight(code, { language }).value;
        }
        return markdownUtils.escapeHtml(code);
      },
    }).use(taskLists, { enabled: true, label: true, labelAfter: true });

    const originalImageRule: RendererRule =
      this.parser.renderer.rules.image ??
      ((tokens, index, options, _environment, renderer) =>
        renderer.renderToken(tokens, index, options));

    this.parser.renderer.rules.image = (
      tokens,
      index,
      options,
      environment,
      renderer,
    ) => {
      const token = tokens[index];
      const rawImageSource = token.attrGet("src");
      const imageSource =
        typeof rawImageSource === "string" ? rawImageSource : "";

      if (isLocalImage(imageSource)) {
        const markdownEnvironment = environment as unknown as
          | MarkdownEnvironment
          | undefined;
        markdownEnvironment?.localImageSources.add(imageSource);
        token.attrSet("data-local-image", imageSource);
        token.attrSet(
          "src",
          "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
        );
      }

      token.attrSet("loading", "lazy");
      return originalImageRule(
        tokens,
        index,
        options,
        environment,
        renderer,
      );
    };
  }

  render(source: string): RenderedMarkdown {
    const localImageSources = new Set<string>();

    const rendered = this.parser.render(source, { localImageSources });
    const html = DOMPurify.sanitize(rendered, {
      ADD_ATTR: ["data-local-image", "target", "rel"],
    });

    return { html, localImageSources: [...localImageSources] };
  }
}

export const markdownRenderer = new SafeMarkdownRenderer();
