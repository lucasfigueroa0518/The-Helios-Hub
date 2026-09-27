/**
 * RSS feeds surface outlet names as decorated strings —
 *   "AI News & Artificial Intelligence | TechCrunch"
 *   "AI | The Next Web"
 * — that are wrong to render as hero attribution on a slide.
 *
 * Rules (in order):
 *   1. Split on ` | ` and take the RIGHTMOST segment (feeds put the outlet last).
 *   2. Strip common URL suffixes (.com, .co, .io).
 *   3. Strip trailing separators (` - `, `-`, `·`, `—`).
 *   4. Trim whitespace.
 */
export function cleanOutletName(raw: string): string {
  const rightmost = raw.split(/\s+\|\s+/).pop() ?? raw;
  return rightmost
    .replace(/\.(com|co|io|net|org)\b/gi, '')
    .replace(/[\s\-·—]+$/g, '')
    .trim();
}
