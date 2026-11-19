/** The editor owns composition. The session must finish it before saving/leaving. */
export interface MarkdownEditorController {
  finishComposition(options?: {
    /** Manual save only; the session checks ownership before focus returns. */
    restoreFocusIf?: () => boolean;
  }): Promise<boolean>;
  focus(): void;
}
