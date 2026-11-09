/**
 * The Field Notes caption: the Writer's short text, then a how-to-try section built by code from each
 * slide's `name` and `tryIt` (verbatim, never reworded; the tip's source link when tryIt is empty), then the closing lines every post carries (a follow
 * line and a few hashtags). The cap (write/caps.ts CAPTION_CAP, Instagram's 2,200) is on the assembled caption.
 * When it is over, the hashtags are dropped first; still over is reported (the gates make it a hard failure),
 * never trimmed silently. Fixed lines have no emoji and no exclamation marks; the Writer's text keeps at most one.
 *
 * Deviation from the other carousel types: the shared `social_hub.caption_closings` log is not
 * written. Its CHECK lists only carousel, reel, explainer and lfd, and the schema is not ours to
 * edit; when it learns 'field_notes', record the closing with closingsLog(query, 'field_notes').
 */
import { FOLLOW_HANDLE } from './types';
import { CAPTION_CAP } from './write/caps';

export const CAPTION_MAX_CHARS = CAPTION_CAP;
export const FIELD_NOTES_FOLLOW_LINE = `Follow ${FOLLOW_HANDLE} for more AI field notes from the Helios team.`;
export const FIELD_NOTES_HASHTAGS = ['#FieldNotes', '#AITips', '#AIWorkflow', '#HeliosAI'] as const;
/** The heading line of the code-built how-to-try section. */
export const HOW_TO_TRY_HEADING = 'How to try:';

/** What the how-to-try section reads from each slide, in slide order. `sourceUrl` stands in when tryIt is empty. */
export type HowToTry = { name: string; tryIt: string; sourceUrl?: string | null };

/** Each slide's how-to-try entry with its tip's source link (matched by tipId), for slides whose tryIt is empty. */
export function withSourceLinks(
  slides: readonly { tipId: string; name: string; tryIt: string }[],
  tips: readonly { id: string; sourceUrl: string | null }[],
): HowToTry[] {
  const url = new Map(tips.map((t) => [t.id, t.sourceUrl]));
  return slides.map((s) => ({ name: s.name, tryIt: s.tryIt, sourceUrl: url.get(s.tipId) ?? null }));
}

/**
 * One numbered line per slide: `N. name: tryIt`, both verbatim, or `N. name: source link` when tryIt is empty.
 * A slide with neither gets no line. Empty when no slide has a line.
 */
export function howToTrySection(slides: readonly HowToTry[]): string {
  const lines = slides
    .map((s) => ({ name: s.name.trim(), how: s.tryIt.trim() || (s.sourceUrl ?? '').trim() }))
    .filter((s) => s.name && s.how)
    .map((s, i) => `${i + 1}. ${s.name}: ${s.how}`);
  return lines.length ? [HOW_TO_TRY_HEADING, ...lines].join('\n') : '';
}

/** Reads the how-to-try lines back out of an assembled caption (the review panel shows them under each slide). */
export function parseHowToTry(caption: string): HowToTry[] {
  const lines = caption.split('\n');
  const start = lines.findIndex((l) => l.trim() === HOW_TO_TRY_HEADING);
  if (start < 0) return [];
  const out: HowToTry[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^\d+\. (.+?): (.*)$/.exec(line);
    if (!m) break;
    out.push({ name: m[1]!, tryIt: m[2]! });
  }
  return out;
}

export type AssembledCaption = {
  caption: string;
  /** The hashtags were left off to fit the cap. */
  droppedHashtags: boolean;
  /** Characters still over CAPTION_CAP after the hashtags were dropped (0 when it fits). */
  over: number;
};

/** The Writer's caption text with at most one exclamation mark (the first stays; any more become periods). */
const writerText = (s: string): string => {
  let seen = false;
  return s.replace(/!/g, () => (seen ? '.' : ((seen = true), '!'))).trim();
};

/** Writer text, how-to-try section, follow line, hashtags; drops the hashtags (only) when over the cap and says so. */
export function assembleFieldNotesCaption(writerCaption: string, slides: readonly HowToTry[] = []): AssembledCaption {
  const head = [writerText(writerCaption), howToTrySection(slides)].filter(Boolean);
  const withTags = [...head, FIELD_NOTES_FOLLOW_LINE, FIELD_NOTES_HASHTAGS.join(' ')].join('\n\n');
  if (withTags.length <= CAPTION_CAP) return { caption: withTags, droppedHashtags: false, over: 0 };
  const noTags = [...head, FIELD_NOTES_FOLLOW_LINE].join('\n\n');
  return { caption: noTags, droppedHashtags: true, over: Math.max(0, noTags.length - CAPTION_CAP) };
}

/**
 * The caption stored on the post. The gates have already failed any draft whose assembled caption is still over
 * the cap, so `over` is 0 here in a real run; as a last guard only, the Writer's own text (never a how-to-try line)
 * is cut at a sentence end so the caption never exceeds Instagram's limit.
 */
export function buildFieldNotesCaption(writerCaption: string, slides: readonly HowToTry[] = []): string {
  const a = assembleFieldNotesCaption(writerCaption, slides);
  if (a.over === 0) return a.caption;
  let body = writerText(writerCaption);
  const room = Math.max(0, body.length - a.over);
  const cut = body.slice(0, room);
  const stop = cut.lastIndexOf('.');
  body = (stop > 0 ? cut.slice(0, stop + 1) : cut).trim();
  return assembleFieldNotesCaption(body, slides).caption;
}
