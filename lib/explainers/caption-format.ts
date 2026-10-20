/**
 * Instagram caption shape for Explainer Reels.
 *
 * The writer stores the body only. Code prepends
 * `AI Brain Break Episode N:` when the reel actually publishes, so N is
 * how many explainers have gone out, plus this one.
 */

import { CAPTION_EMOJI_MAX, countEmoji } from '@/lib/social/captions/emoji';

export const CAPTION_MAX_CHARS = 2200;
/** v4: loosened from 400 and 4 so the writer stops padding (social captions redesign, 2026-10-19). Counts the Helios line. */
export const CAPTION_MIN_BODY_CHARS = 200;
export const CAPTION_HOOK_PREVIEW = 125;
/** The hook, the save prompt or question, and the Helios line (v5). */
export const CAPTION_MIN_PARAGRAPHS = 3;
export const CAPTION_MIN_TAGS = 3;
export const CAPTION_MAX_TAGS = 5;

/** Longest episode line we size the hook against, so 1–999 stay inside the preview. */
const HOOK_EPISODE_BUDGET = 999;

const EPISODE_PREFIX =
  /^(?:AI BRAIN BREAK\s*[-–—]?\s*EPISODE\s+\d+:|AI Brain Break Episode\s+\d+:)\s*/i;

export function episodeLine(episode: number): string {
  if (!Number.isInteger(episode) || episode < 1) throw new Error('episode must be a positive integer');
  return `AI Brain Break Episode ${episode}:`;
}

/** Drop a baked-in episode line (old or new wording) so publish can stamp the real number. */
export function stripEpisodePrefix(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');
  const first = lines[0] ?? '';
  const match = first.match(EPISODE_PREFIX);
  if (!match) return normalized;
  const restOfLine = first.slice(match[0].length).trim();
  return [restOfLine, ...lines.slice(1)].join('\n').replace(/^\n+/, '').trim();
}

export function stampCaption(body: string, episode: number): string {
  const cleaned = stripEpisodePrefix(body);
  if (!cleaned) throw new Error('caption is empty');
  return `${episodeLine(episode)}\n\n${cleaned}`;
}

/** Review drawer: the number is a dash until publish fills it in. */
export function reviewCaption(body: string): string {
  return `AI Brain Break Episode —:\n\n${stripEpisodePrefix(body)}`;
}

export function hookPreviewLimit(episode = HOOK_EPISODE_BUDGET): number {
  return CAPTION_HOOK_PREVIEW - `${episodeLine(episode)}\n\n`.length;
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The caption's paragraphs before the hashtags. */
function bodyParagraphs(text: string): string[] {
  const at = text.search(/#[\p{L}\p{N}_]/u);
  return paragraphs(at >= 0 ? text.slice(0, at) : text);
}

/** v5. The Helios line: the last paragraph before the hashtags. Empty when there is none. */
export function heliosLine(text: string): string {
  return bodyParagraphs(text).at(-1) ?? '';
}

/** The caption body, or a throw that names which rule it broke. */
export function parseCaption(raw: unknown): string {
  const text = stripEpisodePrefix(typeof raw === 'string' ? raw : '');
  if (!text) throw new Error('caption is empty');
  if (stampCaption(text, HOOK_EPISODE_BUDGET).length > CAPTION_MAX_CHARS) {
    throw new Error(`caption is over ${CAPTION_MAX_CHARS} characters`);
  }
  if (/https?:\/\//i.test(text)) throw new Error('caption contains a URL');
  // v5 (2026-10-19): at most two emoji, one leading the hook and one after the ask; none in the Helios line or hashtags.
  const emoji = countEmoji(text);
  if (emoji > CAPTION_EMOJI_MAX) throw new Error(`caption has ${emoji} emoji; at most ${CAPTION_EMOJI_MAX}`);

  const tags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (tags.length < CAPTION_MIN_TAGS || tags.length > CAPTION_MAX_TAGS) {
    throw new Error(`caption needs ${CAPTION_MIN_TAGS} to ${CAPTION_MAX_TAGS} hashtags`);
  }
  const tagAt = text.indexOf(tags[0]!);
  const beforeTags = text.slice(0, tagAt);
  if (beforeTags.includes('#')) throw new Error('hashtags belong at the end');
  if (countEmoji(text.slice(tagAt)) > 0) throw new Error('no emoji in the hashtags');

  const body = beforeTags.trim();
  if (body.length < CAPTION_MIN_BODY_CHARS) {
    throw new Error(`caption body is ${body.length} characters; it needs at least ${CAPTION_MIN_BODY_CHARS}`);
  }

  const blocks = paragraphs(body);
  if (blocks.length < CAPTION_MIN_PARAGRAPHS) {
    throw new Error('caption needs at least the hook, the save prompt or question, and the Helios line');
  }
  // v5 (per-format comps, 2026-10-19): every caption ends on the Helios line, just before the hashtags.
  if (!/\bHelios\b/.test(blocks.at(-1) ?? '')) {
    throw new Error('the paragraph before the hashtags does not name Helios. End on the Helios line, with Helios named once.');
  }
  if (countEmoji(blocks.at(-1) ?? '') > 0) throw new Error('no emoji in the Helios line');

  const hook = blocks[0] ?? '';
  if (!hook) throw new Error('caption is missing a hook');
  if (`${episodeLine(HOOK_EPISODE_BUDGET)}\n\n${hook}`.length > CAPTION_HOOK_PREVIEW) {
    throw new Error(
      `the episode line and the hook are over ${CAPTION_HOOK_PREVIEW} characters (hook must stay under ${hookPreviewLimit()} after the episode line)`,
    );
  }

  return text;
}
