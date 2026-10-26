/**
 * Luma event descriptions arrive as a ProseMirror document (`description_mirror` from
 * `api.luma.com/event/get`). This flattens one to plain text: blocks are separated by a blank
 * line, list items become "- " or "1. " lines, hard breaks become newlines, marks are dropped.
 * Both node naming styles are handled (`bullet_list` and Tiptap's `bulletList`).
 */
export type ProseMirrorNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown> | null;
  content?: ProseMirrorNode[] | null;
};

const MAX_DEPTH = 40;

function kind(node: ProseMirrorNode): string {
  return (node.type || '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

function children(node: ProseMirrorNode): ProseMirrorNode[] {
  return Array.isArray(node.content) ? node.content.filter((child) => child && typeof child === 'object') : [];
}

function inline(node: ProseMirrorNode, depth: number): string {
  if (depth > MAX_DEPTH) return '';
  const type = kind(node);
  if (type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (type === 'hard_break') return '\n';
  if (type === 'image') return '';
  return children(node)
    .map((child) => inline(child, depth + 1))
    .join('');
}

function listItems(node: ProseMirrorNode, ordered: boolean, depth: number): string {
  const startAttr = Number(node.attrs?.start ?? node.attrs?.order ?? 1);
  const start = Number.isFinite(startAttr) ? startAttr : 1;
  return children(node)
    .map((item, index) => {
      const marker = ordered ? `${start + index}. ` : '- ';
      const body = children(item)
        .map((child) => block(child, depth + 1))
        .filter(Boolean)
        .join('\n');
      // Nested lines (a sub-list, a second paragraph) are indented under the marker.
      return marker + body.split('\n').join(`\n${' '.repeat(marker.length)}`);
    })
    .filter((line) => line.trim().length > 0)
    .join('\n');
}

function block(node: ProseMirrorNode, depth: number): string {
  if (depth > MAX_DEPTH) return '';
  switch (kind(node)) {
    case 'text':
    case 'hard_break':
      return inline(node, depth);
    case 'paragraph':
    case 'heading':
    case 'code_block':
      return inline(node, depth).trim();
    case 'bullet_list':
      return listItems(node, false, depth);
    case 'ordered_list':
      return listItems(node, true, depth);
    case 'horizontal_rule':
    case 'image':
      return '';
    default: {
      // doc, blockquote, list_item outside a list, and unknown wrappers: their blocks in order.
      const kids = children(node);
      if (kids.length && kids.every((child) => ['text', 'hard_break'].includes(kind(child)))) {
        return inline(node, depth).trim();
      }
      return kids
        .map((child) => block(child, depth + 1))
        .filter(Boolean)
        .join('\n\n');
    }
  }
}

/** Plain text of a ProseMirror document; '' for anything that is not one. */
export function proseMirrorToText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  return block(doc as ProseMirrorNode, 0)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
