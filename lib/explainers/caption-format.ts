/**
 * Instagram caption shape for Explainer Reels (caption voice, 2026-11-24).
 *
 * The writer stores its text and hashtags; code puts the Helios line (helios-line.ts) between them
 * (`withHeliosLine`). There is no episode line any more: Lucas dropped "AI 101 Episode N:" as too hard to
 * track. `stripEpisodePrefix` still removes one from captions written before.
 */

import { CAPTION_EMOJI_MAX, countEmoji } from '@/lib/social/captions/emoji';
import { heliosLine, heliosLines, longestHeliosLine } from '@/lib/social/captions/helios-line';

export const CAPTION_MAX_CHARS = 2200;
/** Room the writer leaves for the Helios line code adds (the longest one, plus its blank line). */
export const CAPTION_WRITER_MAX_CHARS = CAPTION_MAX_CHARS - longestHeliosLine('explainers').length - 2;
/** v14: lowered from 200, since a caption only has to answer one question (Lucas: "Not all captions need to be long"). */
export const CAPTION_MIN_BODY_CHARS = 120;
export const CAPTION_HOOK_PREVIEW = 125;
/** The hook and at least one paragraph that answers the viewer's question. */
export const CAPTION_MIN_PARAGRAPHS = 2;
export const CAPTION_MIN_TAGS = 3;
export const CAPTION_MAX_TAGS = 5;

const EPISODE_PREFIX =
  /^(?:AI BRAIN BREAK\s*[-–—]?\s*EPISODE\s+\d+:|AI Brain Break Episode\s+\d+:|AI 101 Episode\s+\d+:|AI 101 Episode\s+—:)\s*/i;

/** Drop an episode line baked into an older caption (any wording). */
export function stripEpisodePrefix(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');
  const first = lines[0] ?? '';
  const match = first.match(EPISODE_PREFIX);
  if (!match) return normalized;
  const restOfLine = first.slice(match[0].length).trim();
  return [restOfLine, ...lines.slice(1)].join('\n').replace(/^\n+/, '').trim();
}

/** Review drawer: the caption exactly as it posts. */
export function reviewCaption(body: string): string {
  return stripEpisodePrefix(body);
}

/**
 * The writer's text with the Helios line inserted before the hashtags. `seed` (the job id) picks the
 * line. A caption that already carries a Helios line is returned as it is.
 */
export function withHeliosLine(text: string, seed: string): string {
  const clean = stripEpisodePrefix(text);
  if (heliosLines('explainers').some((line) => clean.includes(line))) return clean;
  const at = clean.search(/#[\p{L}\p{N}_]/u);
  const body = (at >= 0 ? clean.slice(0, at) : clean).trim();
  const tags = at >= 0 ? clean.slice(at).trim() : '';
  return [body, heliosLine('explainers', seed), tags].filter(Boolean).join('\n\n');
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The caption text, or a throw that names which rule it broke. Holds for the writer's text and for a caption with its Helios line. */
export function parseCaption(raw: unknown): string {
  const text = stripEpisodePrefix(typeof raw === 'string' ? raw : '');
  if (!text) throw new Error('caption is empty');
  if (text.length > CAPTION_MAX_CHARS) throw new Error(`caption is over ${CAPTION_MAX_CHARS} characters`);
  if (/https?:\/\//i.test(text)) throw new Error('caption contains a URL');
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
  if (blocks.length < CAPTION_MIN_PARAGRAPHS) throw new Error('caption needs a hook and at least one paragraph after it');
  const hook = blocks[0] ?? '';
  if (hook.length > CAPTION_HOOK_PREVIEW) throw new Error(`the hook is over ${CAPTION_HOOK_PREVIEW} characters`);
  return text;
}
