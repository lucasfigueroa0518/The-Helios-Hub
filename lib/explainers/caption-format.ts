/**
 * Instagram caption shape for Explainer Reels.
 *
 * The writer stores the body only. Code prepends
 * `AI Brain Break Episode N:` when the reel actually publishes, so N is
 * how many explainers have gone out, plus this one.
 */

export const CAPTION_MAX_CHARS = 2200;
export const CAPTION_MIN_BODY_CHARS = 400;
export const CAPTION_HOOK_PREVIEW = 125;
export const CAPTION_MIN_PARAGRAPHS = 4;
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

/** The caption body, or a throw that names which rule it broke. */
export function parseCaption(raw: unknown): string {
  const text = stripEpisodePrefix(typeof raw === 'string' ? raw : '');
  if (!text) throw new Error('caption is empty');
  if (stampCaption(text, HOOK_EPISODE_BUDGET).length > CAPTION_MAX_CHARS) {
    throw new Error(`caption is over ${CAPTION_MAX_CHARS} characters`);
  }
  if (/https?:\/\//i.test(text)) throw new Error('caption contains a URL');
  if (/\p{Extended_Pictographic}/u.test(text)) throw new Error('caption contains an emoji');
  if (/\b(we|our|ours|us)\b/i.test(text) || /\bI\b/.test(text)) throw new Error('caption speaks as Helios');

  const tags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (tags.length < CAPTION_MIN_TAGS || tags.length > CAPTION_MAX_TAGS) {
    throw new Error(`caption needs ${CAPTION_MIN_TAGS} to ${CAPTION_MAX_TAGS} hashtags`);
  }
  const tagAt = text.indexOf(tags[0]!);
  const beforeTags = text.slice(0, tagAt);
  if (beforeTags.includes('#')) throw new Error('hashtags belong at the end');

  const body = beforeTags.trim();
  if (body.length < CAPTION_MIN_BODY_CHARS) {
    throw new Error(`caption body is ${body.length} characters; it needs at least ${CAPTION_MIN_BODY_CHARS}`);
  }

  const blocks = paragraphs(body);
  if (blocks.length < CAPTION_MIN_PARAGRAPHS) {
    throw new Error('caption needs a hook, at least two body paragraphs, and a call to action');
  }

  const hook = blocks[0] ?? '';
  if (!hook) throw new Error('caption is missing a hook');
  if (`${episodeLine(HOOK_EPISODE_BUDGET)}\n\n${hook}`.length > CAPTION_HOOK_PREVIEW) {
    throw new Error(
      `the episode line and the hook are over ${CAPTION_HOOK_PREVIEW} characters (hook must stay under ${hookPreviewLimit()} after the episode line)`,
    );
  }

  return text;
}
