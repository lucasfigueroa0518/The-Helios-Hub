/**
 * Draft body → Smartlead `{{custom_body}}` HTML.
 *
 * Smartlead renders the custom field straight into the sequence template, so
 * whatever survives here is what lands in the recipient's client. Two rules
 * shape this:
 *
 *   - No images and no `cid:` references. The old AgentMail path inlined a
 *     headshot; inline attachments are a spam signal and Smartlead has no
 *     per-lead attachment slot. Signatures are account-level in Smartlead.
 *   - No styles, classes, scripts, or anything an ESP will flag. Cold step-1
 *     mail is plain prose: paragraphs and line breaks only. Links are allowed
 *     on follow-up steps, where a calendar link is the point.
 */

/** Tags allowed in a step-1 body. */
const BASE_ALLOWED = new Set(['p', 'br']);
/** Follow-ups may link out. */
const LINK_TAGS = new Set(['a']);

/**
 * Smartlead documents 200 custom fields per lead but no per-value length.
 * 20k characters is far above any cold email and well below a payload that
 * would get the request rejected, so it acts as a corruption tripwire.
 */
export const MAX_CUSTOM_FIELD_CHARS = 20_000;

export class CustomFieldTooLongError extends Error {
  constructor(
    readonly field: string,
    readonly length: number,
  ) {
    super(`Smartlead custom field "${field}" is ${length} chars (limit ${MAX_CUSTOM_FIELD_CHARS})`);
    this.name = 'CustomFieldTooLongError';
  }
}

export function assertCustomFieldLength(field: string, value: string): void {
  if (value.length > MAX_CUSTOM_FIELD_CHARS) {
    throw new CustomFieldTooLongError(field, value.length);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Only absolute http(s) links survive; `cid:`, `javascript:`, and `data:` do not. */
function safeHref(raw: string): string | null {
  const href = raw.trim().replace(/^["']|["']$/g, '');
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    return new URL(href).toString();
  } catch {
    return null;
  }
}

type ToHtmlOptions = {
  /** Follow-up steps may contain links; step 1 may not. */
  allowLinks?: boolean;
};

/** Elements that end the current paragraph even though their tag is dropped. */
const BLOCK_TAGS = /^(p|div|li|ul|ol|tr|table|h[1-6]|blockquote|section|article|pre|hr)$/;

/**
 * Rebuilds the body from scratch rather than filtering the input: the output is
 * assembled from a fixed vocabulary of paragraphs, breaks and vetted links, so
 * a tag or attribute we have never heard of cannot survive, and the result is
 * always well-formed regardless of how malformed the input was.
 */
export function toCustomBodyHtml(input: string, options: ToHtmlOptions = {}): string {
  const allowed = options.allowLinks ? new Set([...BASE_ALLOWED, ...LINK_TAGS]) : BASE_ALLOWED;

  // Elements whose *content* must go with them, not just their tags.
  const stripped = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title|svg)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(img|picture|source|video|audio|iframe|object|embed|input)\b[^>]*\/?>/gi, '');

  const paragraphs: string[] = [];
  let current: string[] = [];
  let openLink = false;

  const flush = () => {
    if (openLink) {
      current.push('</a>');
      openLink = false;
    }
    const text = current.join('').replace(/^(\s|<br>)+|(\s|<br>)+$/g, '');
    if (text) paragraphs.push(text);
    current = [];
  };

  let index = 0;
  for (const match of stripped.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    current.push(escapeHtml(stripped.slice(index, match.index)));
    index = match.index + match[0].length;

    const tag = match[1].toLowerCase();
    const closing = match[0].startsWith('</');

    if (BLOCK_TAGS.test(tag)) {
      flush();
      continue;
    }
    if (!allowed.has(tag)) continue;

    if (tag === 'br') {
      current.push('<br>');
    } else if (tag === 'a') {
      if (closing) {
        if (openLink) current.push('</a>');
        openLink = false;
      } else if (!openLink) {
        const href = safeHref(match[2].match(/href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i)?.[1] ?? '');
        if (href) {
          current.push(`<a href="${escapeHtml(href)}">`);
          openLink = true;
        }
        // An unusable link keeps its anchor text and loses the anchor.
      }
    }
  }
  current.push(escapeHtml(stripped.slice(index)));
  flush();

  return paragraphs
    .map((text) => `<p>${text.replace(/(<br>\s*){3,}/g, '<br><br>')}</p>`)
    .join('');
}

/**
 * Plain text → Smartlead HTML. Blank lines become paragraphs, single newlines
 * become `<br>`; this is the path for drafts stored as text.
 */
export function textToCustomBodyHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).split('\n').join('<br>')}</p>`);
  return paragraphs.join('');
}

/** True when the body still carries something no cold email should send. */
export function hasBlockedMarkup(html: string): boolean {
  return /<\s*(img|script|style|iframe|object|embed)\b/i.test(html)
    || /\bcid:/i.test(html)
    || /\bstyle\s*=/i.test(html)
    || /\bclass\s*=/i.test(html);
}
