/**
 * Instagram caption shape for Explainer Reels (caption voice, 2026-11-24).
 *
 * The writer stores a short explanation and hashtags, plus the parts of a learn-more prompt; code
 * assembles the prompt after the explanation (`learnMoreBlock`, `withLearnMore`, caption v15), then puts
 * the Helios line (helios-line.ts) before the hashtags (`withHeliosLine`). There is no episode line any more: Lucas dropped "AI 101 Episode N:" as too hard to
 * track. `stripEpisodePrefix` still removes one from captions written before.
 */

import { CAPTION_EMOJI_MAX, countEmoji } from '@/lib/social/captions/emoji';
import { hash, heliosLine, heliosLines, longestHeliosLine } from '@/lib/social/captions/helios-line';

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

/**
 * v15 (Lucas, 2026-11-24): the explanation stays but is short, "because we're pointing them to a treasure trove of
 * additional knowledge": a "want to learn more?" line and a prompt the viewer gives their own AI, naming the ideas
 * around the reel's term. The writer's text before the hashtags stays within this.
 */
export const CAPTION_BODY_MAX_CHARS = 450;
export const LEARN_MORE_TOPICS_MIN = 3;
export const LEARN_MORE_TOPICS_MAX = 5;
export const LEARN_MORE_TOPIC_MAX_CHARS = 40;
export const LEARN_MORE_SO_I_MAX_CHARS = 160;
export const LEARN_MORE_OPENERS: readonly string[] = ['Want to learn more?', 'Want to go deeper?', 'Curious to learn more?'];
export const LEARN_MORE_HANDOFFS: readonly string[] = ['Screenshot this prompt for your AI:', 'Give this prompt to your AI:'];

/** The writer's parts of the prompt: "Teach me about {topic}. Dive into {diveInto}, so I {soI}." */
export type LearnMore = { topic: string; diveInto: string[]; soI: string };

function promptPart(value: unknown, field: string, max: number): string {
  const text = (typeof value === 'string' ? value : '').replace(/\s+/g, ' ').trim().replace(/[.,;:!]+$/, '');
  if (!text) throw new Error(`The prompt's ${field} is empty.`);
  if (text.length > max) throw new Error(`The prompt's ${field} "${text}" is over ${max} characters.`);
  if (/["“”#]|https?:\/\//i.test(text)) throw new Error(`The prompt's ${field} "${text}" has a quote mark, a hashtag or a URL.`);
  if (countEmoji(text) > 0) throw new Error(`The prompt's ${field} "${text}" has an emoji.`);
  return text;
}

/**
 * The writer's prompt parts, cleaned, or a throw the retry can use. `names` are the reel's term and its other
 * names (empty when the term is unknown); "Teach me about" must name one of them.
 */
export function parseLearnMore(raw: { topic: unknown; diveInto: unknown; soI: unknown }, names: readonly string[]): LearnMore {
  const topic = promptPart(raw.topic, 'teach_me_about', LEARN_MORE_TOPIC_MAX_CHARS);
  const said = names.map((name) => name.trim().toLowerCase()).filter(Boolean);
  if (said.length && !said.some((name) => topic.toLowerCase().includes(name))) {
    throw new Error(`teach_me_about is "${topic}"; it must name the reel's term, ${names[0]}.`);
  }
  const list = Array.isArray(raw.diveInto) ? raw.diveInto : [];
  if (list.length < LEARN_MORE_TOPICS_MIN || list.length > LEARN_MORE_TOPICS_MAX) {
    throw new Error(`dive_into has ${list.length} topics; give ${LEARN_MORE_TOPICS_MIN} to ${LEARN_MORE_TOPICS_MAX}.`);
  }
  const diveInto = list.map((item) => promptPart(item, 'dive_into topic', LEARN_MORE_TOPIC_MAX_CHARS));
  const keys = diveInto.map((item) => item.toLowerCase());
  if (new Set(keys).size !== keys.length) throw new Error('dive_into names the same topic twice.');
  if (keys.some((key) => key === topic.toLowerCase() || said.includes(key))) throw new Error("dive_into repeats the reel's own term; name the ideas around it.");
  const soI = promptPart(String(raw.soI ?? '').replace(/^\s*so\s+I\s+/i, ''), 'so_i', LEARN_MORE_SO_I_MAX_CHARS);
  return { topic, diveInto, soI };
}

function joinList(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The learn-more paragraphs code writes: an opener and a hand-off line, then the quoted prompt. `seed` picks the wording. */
export function learnMoreBlock(learn: LearnMore, seed: string): string {
  const opener = LEARN_MORE_OPENERS[hash(`learn-more:${seed}`) % LEARN_MORE_OPENERS.length]!;
  const handoff = LEARN_MORE_HANDOFFS[hash(`handoff:${seed}`) % LEARN_MORE_HANDOFFS.length]!;
  const prompt = `"Teach me about ${learn.topic}. Dive into ${joinList(learn.diveInto)}, so I ${learn.soI}."`;
  return `${opener}\n${handoff}\n\n${prompt}`;
}

/** The writer's text before its hashtags. */
export function captionBody(text: string): string {
  const at = text.search(/#[\p{L}\p{N}_]/u);
  return (at >= 0 ? text.slice(0, at) : text).trim();
}

/** The writer's text with the learn-more block placed after the explanation, before the hashtags. */
export function withLearnMore(text: string, block: string): string {
  const at = text.search(/#[\p{L}\p{N}_]/u);
  const tags = at >= 0 ? text.slice(at).trim() : '';
  return [captionBody(text), block, tags].filter(Boolean).join('\n\n');
}

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
