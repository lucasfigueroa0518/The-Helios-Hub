/**
 * The story a single-story meme is made from: a carousel's Reporter brief
 * (social.posts.brief), read for that one post when Lucas clicks Generate. A
 * lookup, never a sweep. Every factual line in a meme cites the brief's IDs
 * (ME-32): facts F…, background B…, numbers N…, quotes Q….
 */
import type { Brief } from '@/lib/social/reporter/brief';
import { BLUE_CHIP_PLAYERS, type BluePlayer } from '@/lib/social-hub/blue-chip-players';

export type MemeStory = {
  postId: string;
  title: string;
  status: string;
  createdAt: string;
  brief: Brief;
  /** The photo the LFD slide used before a meme replaced it (cover mosaic). */
  originalPhoto?: { url: string; credit: string | null; kind: string | null } | null;
  /** Finished LFD post id, when this story came from one. */
  postRef?: string | null;
};

/** Every citable ID in the brief and what it says. */
export function factIndex(brief: Brief): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of [...(brief.facts ?? []), ...(brief.background ?? [])]) m.set(f.id, f.text);
  for (const n of brief.numbers ?? []) m.set(n.id, `${n.value} (${n.counts})`);
  for (const q of brief.quotes ?? []) m.set(q.id, `"${q.text}" (${q.speaker})`);
  return m;
}

/** All the brief's words, for checking which players the story is about. */
function briefText(brief: Brief): string {
  return [
    brief.the_news?.text,
    ...(brief.why_it_matters ?? []).map((w) => w.text),
    ...(brief.plot ?? []).map((p) => p.text),
    ...(brief.tensions ?? []).map((t) => t.text),
    ...[...factIndex(brief).values()],
    ...(brief.subjects ?? []).map((s) => s.name),
  ]
    .filter(Boolean)
    .join('\n');
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Is this player in the story? Their name, a former name, or a headline token appears in the brief. */
export function playerInStory(p: BluePlayer, brief: Brief): boolean {
  const text = briefText(brief);
  return [p.name, ...(p.aka ?? []), ...p.tokens].some((n) => new RegExp(`\\b${escape(n)}\\b`).test(text));
}

/** The blue-chip players a story names: the only ones a single-story meme may put on a label (ME-10, ME-32). */
export const playersInStory = (brief: Brief): BluePlayer[] => BLUE_CHIP_PLAYERS.filter((p) => playerInStory(p, brief));

/** The story as the writer reads it: what happened, its shape, and every citable fact by ID. */
export function storyForPrompt(story: MemeStory): string {
  const b = story.brief;
  const lines: string[] = [`HEADLINE: ${story.title}`, `THE NEWS: ${b.the_news?.text ?? ''}`];
  const list = (title: string, items: string[]) => {
    if (items.length) lines.push('', `${title}:`, ...items.map((x) => `- ${x}`));
  };
  list('WHY IT MATTERS', (b.why_it_matters ?? []).map((w) => w.text));
  list('PLOT', (b.plot ?? []).map((p) => `${p.beat}: ${p.text}`));
  list('TENSIONS', (b.tensions ?? []).map((t) => t.text));
  list('FACTS (cite by ID)', [...(b.facts ?? []), ...(b.background ?? [])].map((f) => `${f.id}: ${f.text}${f.claim_by ? ` [CLAIM: ${f.claim_by} says]` : ''}`));
  list('NUMBERS (cite by ID; quote the value exactly as written)', (b.numbers ?? []).map((n) => `${n.id}: ${n.value} (${n.counts})`));
  list('QUOTES (cite by ID; never change the words)', (b.quotes ?? []).map((q) => `${q.id}: "${q.text}" (${q.speaker}${q.where ? `, ${q.where}` : ''})`));
  list('SUBJECTS', (b.subjects ?? []).map((s) => `${s.name}${s.role ? ` (${s.role})` : ''}`));
  const players = playersInStory(b);
  list('BLUE-CHIP PLAYERS IN THIS STORY (the only player_ids you may use)', players.map((p) => `${p.id}: ${p.name}`));
  return lines.join('\n');
}
