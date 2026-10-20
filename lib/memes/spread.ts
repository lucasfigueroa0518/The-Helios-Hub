/**
 * A spread meme covers every story in one Last Few Days set (the cover
 * candidate). Unlike landscape, Jev does not pick a pair: the writer gets
 * the whole set and must draw on every lettered story.
 */
import { templateCard } from './catalog';
import { CostMeter, MEME_SPEND_CAP_USD } from './cost';
import { availableTemplates } from './gate';
import { mergeStories, storiesUsed, type Relation } from './landscape';
import { finish, produceSlate, stage, type RequestRow, type RunDeps } from './run';
import type { MemeStory } from './story';
import type { Mapping } from './writer';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function spreadNote(stories: MemeStory[]): string {
  return [
    'SPREAD MEME (Last Few Days cover)',
    `These are ${stories.length} stories from one Last Few Days post. Make memes that cover the whole set, not any one of them.`,
    'HARD CONSTRAINT: every turn and every meme draws on EVERY story, through the facts it cites (IDs start with the story letter) or the players it labels.',
    stories.map((s, n) => `${LETTERS[n]}: ${s.title}`).join('\n'),
  ].join('\n');
}

export function coversAll(m: Mapping, stories: MemeStory[]): boolean {
  return storiesUsed(m, { stories, relation: 'same_move' as Relation, strength: 1 }).size >= stories.length;
}

export async function runSpreadRequest(deps: RunDeps, req: RequestRow): Promise<void> {
  const meter = new CostMeter(MEME_SPEND_CAP_USD);
  try {
    const ids = req.storyIds ?? [];
    if (ids.length < 2) throw new Error('a spread needs at least two stories with briefs');
    if (!deps.loadStories) throw new Error('no story loader is wired for spread memes');
    await stage(deps.db, req.id, 'reading the set');
    const stories = await deps.loadStories(ids);
    if (stories.length < 2) throw new Error('pick stories that already have a brief');
    if (stories.length !== ids.length) throw new Error('every selected story needs a brief first');
    const now = deps.now?.() ?? new Date();
    const gate = await availableTemplates(deps.db, now);
    const free = gate.free.filter((id) => templateCard(id)?.landscape);
    if (!free.length) throw new Error('every landscape template is on its 90-day cooldown');
    const merged = mergeStories({ stories, relation: 'same_move', strength: 1 });
    await produceSlate(deps, req, {
      story: merged,
      free,
      blocked: gate.blocked,
      meter,
      kind: 'spread',
      slateStories: stories.map((s, n) => ({ letter: LETTERS[n], postId: s.postId, title: s.title, postRef: s.postRef })),
      note: spreadNote(stories),
      extraShape: { spread: true, storyCount: stories.length },
      filterMapping: (m) => (coversAll(m, stories) ? null : 'spread: does not cover every story'),
      coverage: { letters: stories.map((_, n) => LETTERS[n]!), need: 'all' },
    });
  } catch (err) {
    await finish(deps.db, req.id, 'failed', meter.spent, err instanceof Error ? err.message : String(err), {}).catch(() => {});
  }
}
