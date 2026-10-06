/**
 * D-246. Model-written text sometimes comes back with its escape sequences
 * written out: the two characters \ and n where a line break belongs, \" where
 * a quote belongs, or ’ where an apostrophe belongs. Older writers also
 * leaked pieces of the tool's own JSON into the caption.
 *
 * Three layers use this one module:
 *   1. parseCopyReport repairs every model-written field and fails the report
 *      when anything is left over (the draft call is retried once).
 *   2. checkCopy records any leftovers for review.
 *   3. The posting path repairs the assembled caption again and refuses to
 *      post one that still carries an artifact, which also covers rows
 *      written before this module existed.
 */

/**
 * One pass, left to right, so an escaped backslash is never read twice.
 * A written-out Windows break becomes one line break.
 */
const WRITTEN_ESCAPE = /\\(?:r\\n|u([0-9a-fA-F]{4})|([nrt"'\\/]))/g;

const ESCAPE_REPLACEMENTS: Record<string, string> = {
  n: '\n',
  r: '\n',
  t: ' ',
  '"': '"',
  "'": "'",
  '\\': '\\',
  '/': '/',
};

/** Repairs written-out escapes and real Windows breaks. Text without either comes back unchanged. */
export function repairModelText(value: string): string {
  return value
    .replace(WRITTEN_ESCAPE, (match: string, hex: string | undefined, char: string | undefined) => {
      if (match === '\\r\\n') return '\n';
      if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
      return char ? (ESCAPE_REPLACEMENTS[char] ?? match) : match;
    })
    .replace(/\r\n?/g, '\n');
}

/** The report_copy keys, so a key that leaked into a field can be recognized. */
const TOOL_KEYS = [
  'hook_drafts',
  'copy_draft',
  'caption_draft',
  'remaining_patterns',
  'viewer_stake',
  'outcome_note',
  'on_screen_copies',
  'caption',
  'call_to_action',
  'hashtags',
  'sources',
];

const LEFTOVER_ESCAPE = /\\(?:[nrt"'\\/]|u[0-9a-fA-F]{4})/;
const TOOL_KEY = new RegExp(`"\\s*(?:${TOOL_KEYS.join('|')})"\\s*:`);
const STRAY_JSON = /^\s*[{[]\s*"|"\s*[}\]]\s*$/;

/** What is still wrong with one field after repair. Empty when it is clean. */
export function textArtifacts(value: string): string[] {
  const found: string[] = [];
  if (LEFTOVER_ESCAPE.test(value)) found.push('escape sequence');
  if (TOOL_KEY.test(value)) found.push('tool syntax');
  if (STRAY_JSON.test(value)) found.push('stray JSON');
  return found;
}

function paragraphs(caption: string): string[] {
  return caption
    .split(/\n[ \t]*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Lowercased, with punctuation and spacing ignored, for comparing a call to action with a paragraph. */
function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(?:cta|call to action)\s*:\s*/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const HASHTAG_PARAGRAPH = /^(?:#[\p{L}\p{N}_]+[\s,]*)+$/u;

/**
 * The caption body ends where the bucket structure ends (D-230). A trailing
 * paragraph that is only hashtags, or that repeats the call to action, is
 * removed here, since both are posted from their own fields. Parsing keeps at
 * least two paragraphs so the one-block rule still means something (D-229);
 * the posted caption can go down to one.
 */
export function stripCaptionTail(caption: string, callToAction: string, minParagraphs = 1): string {
  const parts = paragraphs(caption);
  const cta = comparable(callToAction);
  for (;;) {
    const last = parts[parts.length - 1];
    if (last === undefined || parts.length <= Math.max(1, minParagraphs)) break;
    if (HASHTAG_PARAGRAPH.test(last) || (cta && comparable(last) === cta)) {
      parts.pop();
      continue;
    }
    break;
  }
  return parts.join('\n\n');
}

/**
 * Caption problems that only show up in the body: the call to action or a
 * hashtag line still inside it once the posted tail is stripped.
 */
export function captionBodyArtifacts(caption: string, callToAction: string): string[] {
  const found = textArtifacts(caption);
  const cta = comparable(callToAction);
  const parts = paragraphs(stripCaptionTail(caption, callToAction, 1));
  if (cta && parts.some((part) => comparable(part) === cta)) found.push('call to action in the caption body');
  if (parts.some((part) => HASHTAG_PARAGRAPH.test(part))) found.push('hashtags in the caption body');
  return found;
}

/** The last gate before Instagram. The caption is repaired; anything still wrong is named. */
export function postableCaption(caption: string): { caption: string; problems: string[] } {
  const repaired = repairModelText(caption);
  return { caption: repaired, problems: textArtifacts(repaired) };
}
