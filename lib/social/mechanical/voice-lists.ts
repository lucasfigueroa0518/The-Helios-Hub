/**
 * Banned words, phrases and punctuation derived from VOICE_BLOCK's "Never
 * use" list (spec §6; the derived lists come back in M7). Plain matching,
 * no judgment: only items that can be found by text alone are here.
 * Not checkable by code, so left to the prompts: "Not X, it's Y" phrasing,
 * fake-depth endings, rhythm, slide openings.
 */

/** "These words:" from VOICE_BLOCK, matched as whole words in any form (reshapes, leveraging…). */
export const BANNED_WORDS = [
  'landscape', 'ecosystem', 'game-changer', 'paradigm', 'revolutionary', 'seismic', 'watershed', 'pivotal', 'robust',
  'groundbreaking', 'unprecedented', 'delve', 'testament', 'reshape', 'unlock', 'leverage', 'empower', 'elevate',
  'transform', 'redefine', 'reimagine',
] as const;

/** Phrases from VOICE_BLOCK, case-insensitive. */
export const BANNED_PHRASES = [
  'at its core', 'the real question is', "it's worth noting", 'moving forward',
  "let's dive in", "here's what you need to know", "here's the kicker", "here's why",
  'serves as', 'boasts', 'experts say',
  // "space" only as in "AI space".
  'AI space',
] as const;

/** Glue words, banned as a sentence opener ("Meanwhile, …"). */
export const BANNED_OPENERS = ['Meanwhile', 'Additionally', 'Furthermore', 'That said'] as const;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]");

const WORD_RE = new RegExp(`\\b(${BANNED_WORDS.map((w) => `${esc(w)}(?:s|es|d|ed|ing|al|ary)?`).join('|')})\\b`, 'i');
const PHRASE_RE = new RegExp(`(?:^|\\W)(${BANNED_PHRASES.map(esc).join('|')})(?=\\W|$)`, 'i');
const OPENER_RE = new RegExp(`(?:^|[.!?]\\s+)(${BANNED_OPENERS.map(esc).join('|')}),`);
/** Emoji (pictographs and symbols). */
const EMOJI_RE = /\p{Extended_Pictographic}/u;

export type VoiceHit = { kind: 'word' | 'phrase' | 'opener' | 'exclamation' | 'emoji'; match: string };

/** Voice-list hits in one piece of text the stage wrote (never a filled quote). */
export function voiceHits(text: string): VoiceHit[] {
  const hits: VoiceHit[] = [];
  const w = WORD_RE.exec(text);
  if (w) hits.push({ kind: 'word', match: w[1]! });
  const p = PHRASE_RE.exec(text);
  if (p) hits.push({ kind: 'phrase', match: p[1]! });
  const o = OPENER_RE.exec(text);
  if (o) hits.push({ kind: 'opener', match: o[1]! });
  if (text.includes('!')) hits.push({ kind: 'exclamation', match: '!' });
  const e = EMOJI_RE.exec(text);
  if (e) hits.push({ kind: 'emoji', match: e[0] });
  return hits;
}
