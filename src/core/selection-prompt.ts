interface SelectionPromptInput {
  filePath: string;
  selectedText: string;
}

interface AnnotationPromptInput extends SelectionPromptInput {
  annotation: string;
}

function contextBlock(label: string, tag: string, value: string): string {
  return `${label}：\n<${tag}>\n${value}\n</${tag}>`;
}

export function buildReferencePrompt({
  filePath,
  selectedText,
}: SelectionPromptInput): string {
  return [
    "请根据以下本地文件片段理解并处理相关内容。回答时请保留文件上下文，并明确关联所选内容。",
    contextBlock("文件绝对路径", "file_path", filePath),
    contextBlock("选中的内容", "selected_content", selectedText),
  ].join("\n\n");
}

export function buildAnnotationPrompt({
  filePath,
  selectedText,
  annotation,
}: AnnotationPromptInput): string {
  return [
    "请根据以下本地文件片段和我的批注执行任务。批注代表我希望你重点处理的要求。",
    contextBlock("文件绝对路径", "file_path", filePath),
    contextBlock("选中的内容", "selected_content", selectedText),
    contextBlock("我的批注", "annotation", annotation),
  ].join("\n\n");
}
