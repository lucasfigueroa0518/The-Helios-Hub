/**
 * The Field Notes caption, all built by code (caption voice, 2026-11-24): the how-to-try section first,
 * from each slide's `name` and `tryIt` (verbatim, never reworded, with the backticks the Writer wraps
 * commands in removed, since Instagram shows them literally; a labelled source link when tryIt is empty),
 * then the Helios line (helios-line.ts) and a few hashtags. The cap (write/caps.ts CAPTION_CAP,
 * Instagram's 2,200) is on the assembled caption. When it is over, the hashtags are dropped first;
 * still over is reported (the gates make it a hard failure). There is no Writer text any more.
 *
 * Deviation from the other carousel types: the shared `social_hub.caption_closings` log is not
 * written. Its CHECK lists only carousel, reel, explainer and lfd, and the schema is not ours to
 * edit; when it learns 'field_notes', record the closing with closingsLog(query, 'field_notes').
 */
import { heliosLine } from '@/lib/social/captions/helios-line';

import { CAPTION_CAP } from './write/caps';

export const CAPTION_MAX_CHARS = CAPTION_CAP;
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

/** Label in front of a source link that stands in for an empty tryIt. */
export const SOURCE_LINK_LABEL = 'steps at';

/**
 * One numbered line per slide: `N. name: tryIt`, both verbatim minus backticks, or `N. name: steps at <link>`
 * when tryIt is empty. A slide with neither gets no line. Empty when no slide has a line.
 */
export function howToTrySection(slides: readonly HowToTry[]): string {
  const lines = slides
    .map((s) => {
      const link = (s.sourceUrl ?? '').trim();
      return { name: s.name.trim().replace(/`/g, ''), how: s.tryIt.replace(/`/g, '').trim() || (link ? `${SOURCE_LINK_LABEL} ${link}` : '') };
    })
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

/** How-to-try section, Helios line, hashtags; drops the hashtags (only) when over the cap and says so. */
export function assembleFieldNotesCaption(slides: readonly HowToTry[], helios: string): AssembledCaption {
  const head = [howToTrySection(slides), helios].filter(Boolean);
  const withTags = [...head, FIELD_NOTES_HASHTAGS.join(' ')].join('\n\n');
  if (withTags.length <= CAPTION_CAP) return { caption: withTags, droppedHashtags: false, over: 0 };
  const noTags = head.join('\n\n');
  return { caption: noTags, droppedHashtags: true, over: Math.max(0, noTags.length - CAPTION_CAP) };
}

/** The caption stored on the post. `seed` (the post's slug) picks its Helios line. The gates already failed any draft still over the cap. */
export function buildFieldNotesCaption(slides: readonly HowToTry[], seed: string): string {
  return assembleFieldNotesCaption(slides, heliosLine('field_notes', seed)).caption;
}
