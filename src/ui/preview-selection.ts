export interface SelectionBoundary {
  node: Node;
  offset: number;
}

type DocumentWithCaretRange = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

const SELECTION_BLOCK_SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th";

function firstTextNode(root: Node): Text | null {
  const walker = root.ownerDocument?.createTreeWalker(root, 4);
  return (walker?.nextNode() as Text | null) ?? null;
}

function lastTextNode(root: Node): Text | null {
  const walker = root.ownerDocument?.createTreeWalker(root, 4);
  if (!walker) return null;
  let current: Text | null = null;
  let next: Text | null;
  while ((next = walker.nextNode() as Text | null)) current = next;
  return current;
}

function distanceToInterval(value: number, start: number, end: number) {
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
}

function textBoundaryFromRenderedPoint(
  document: Document,
  block: Element,
  x: number,
  y: number,
): SelectionBoundary | null {
  const walker = document.createTreeWalker(block, 4);
  const probe = document.createRange();
  let best:
    | {
        boundary: SelectionBoundary;
        verticalDistance: number;
        horizontalDistance: number;
      }
    | undefined;
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    for (let offset = 0; offset < node.data.length; offset += 1) {
      probe.setStart(node, offset);
      probe.setEnd(node, offset + 1);
      for (const rect of Array.from(probe.getClientRects())) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        const verticalDistance = distanceToInterval(y, rect.top, rect.bottom);
        const horizontalDistance = distanceToInterval(x, rect.left, rect.right);
        if (
          best &&
          (verticalDistance > best.verticalDistance ||
            (verticalDistance === best.verticalDistance &&
              horizontalDistance >= best.horizontalDistance))
        ) {
          continue;
        }
        best = {
          boundary: {
            node,
            offset: x <= rect.left + rect.width / 2 ? offset : offset + 1,
          },
          verticalDistance,
          horizontalDistance,
        };
      }
    }
  }

  return best?.boundary ?? null;
}

function textBoundaryWithin(
  block: Element,
  boundary: SelectionBoundary,
  x: number,
): SelectionBoundary | null {
  if (boundary.node.nodeType === Node.TEXT_NODE) {
    if (block.contains(boundary.node)) {
      const text = boundary.node as Text;
      return {
        node: text,
        offset: Math.max(0, Math.min(boundary.offset, text.data.length)),
      };
    }
  }

  if (boundary.node.nodeType === Node.ELEMENT_NODE) {
    const element = boundary.node as Element;
    if (block.contains(element) || element === block) {
      const childAfter = element.childNodes[boundary.offset];
      const after = childAfter ? firstTextNode(childAfter) : null;
      if (after && block.contains(after)) return { node: after, offset: 0 };
      const childBefore = element.childNodes[boundary.offset - 1];
      const before = childBefore ? lastTextNode(childBefore) : null;
      if (before && block.contains(before)) {
        return { node: before, offset: before.data.length };
      }
    }
  }

  const first = firstTextNode(block);
  const last = lastTextNode(block);
  if (!first || !last) return null;
  const rect = block.getBoundingClientRect();
  return x <= rect.left + rect.width / 2
    ? { node: first, offset: 0 }
    : { node: last, offset: last.data.length };
}

export function selectionBoundaryFromPoint(
  document: Document,
  root: Element,
  target: EventTarget | null,
  x: number,
  y: number,
): SelectionBoundary | null {
  const targetElement =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  const block = targetElement?.closest(SELECTION_BLOCK_SELECTOR);
  if (!block || !root.contains(block)) return null;

  const position = document.caretPositionFromPoint?.(x, y);
  const caretRange = position
    ? null
    : (document as DocumentWithCaretRange).caretRangeFromPoint?.(x, y);
  const boundary = position
    ? { node: position.offsetNode, offset: position.offset }
    : caretRange
      ? { node: caretRange.startContainer, offset: caretRange.startOffset }
      : null;
  if (!boundary) return textBoundaryFromRenderedPoint(document, block, x, y);

  return textBoundaryWithin(block, boundary, x);
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
