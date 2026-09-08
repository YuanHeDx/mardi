export interface SelectionBoundary {
  node: Node;
  offset: number;
}

type DocumentWithLegacyCaretRange = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function textNodeAfter(root: Node, node: Node): Text | null {
  const walker = root.ownerDocument?.createTreeWalker(root, 4);
  if (!walker) return null;
  walker.currentNode = node;
  return walker.nextNode() as Text | null;
}

function textNodeBefore(root: Node, node: Node): Text | null {
  const walker = root.ownerDocument?.createTreeWalker(root, 4);
  if (!walker) return null;
  walker.currentNode = node;
  return walker.previousNode() as Text | null;
}

export function trimRangeWhitespace(source: Range, root: Node): Range {
  const range = source.cloneRange();
  let startNode: Node | null = range.startContainer;
  let startOffset = range.startOffset;

  while (startNode?.nodeType === 3) {
    const text = (startNode as Text).data;
    const nonWhitespace = text.slice(startOffset).search(/\S/u);
    if (nonWhitespace >= 0) {
      range.setStart(startNode, startOffset + nonWhitespace);
      break;
    }
    const next = textNodeAfter(root, startNode);
    if (!next || !range.intersectsNode(next)) break;
    startNode = next;
    startOffset = 0;
  }

  let endNode: Node | null = range.endContainer;
  let endOffset = range.endOffset;
  while (endNode?.nodeType === 3) {
    const text = (endNode as Text).data;
    const beforeEnd = text.slice(0, endOffset);
    const trailingWhitespace = beforeEnd.match(/\s+$/u)?.[0].length ?? 0;
    if (endOffset - trailingWhitespace > 0) {
      range.setEnd(endNode, endOffset - trailingWhitespace);
      break;
    }
    const previous = textNodeBefore(root, endNode);
    if (!previous || !range.intersectsNode(previous)) break;
    endNode = previous;
    endOffset = previous.data.length;
  }

  return range;
}

export function caretBoundaryFromPoint(
  document: Document,
  x: number,
  y: number,
): SelectionBoundary | null {
  const position = document.caretPositionFromPoint?.(x, y);
  if (position) {
    return { node: position.offsetNode, offset: position.offset };
  }

  const range = (document as DocumentWithLegacyCaretRange).caretRangeFromPoint?.(
    x,
    y,
  );
  if (!range) return null;
  return { node: range.startContainer, offset: range.startOffset };
}

export function rangeBetweenBoundaries(
  document: Document,
  first: SelectionBoundary,
  second: SelectionBoundary,
): Range | null {
  try {
    const firstPoint = document.createRange();
    firstPoint.setStart(first.node, first.offset);
    firstPoint.collapse(true);
    const secondPoint = document.createRange();
    secondPoint.setStart(second.node, second.offset);
    secondPoint.collapse(true);
    const startsFirst =
      firstPoint.compareBoundaryPoints(Range.START_TO_START, secondPoint) <= 0;
    const range = document.createRange();
    const start = startsFirst ? first : second;
    const end = startsFirst ? second : first;
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}
