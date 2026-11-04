// lib/lfd/pins.ts
/**
 * Pins on Last Few Days (the shared idea pool standard, lib/social-hub/queue.ts). A pin is a row in social_hub.idea_adjustments
 * like every other type's; what the NIGHT does with it is this file. LFD has no standing pool (a run rebuilds its candidates),
 * so a pinned story is made a candidate of its own and taken before the lanes, as a person's seed is (Selector.forced, up to
 * MAX_SEEDS a post, bypassing the company cap and the repeat check). The run needs the story's link and page text:
 * the link comes from what the hub shows (the latest run's recorded queues, or a recent post's story), the text from the plain
 * fetch (no model, no search). A pin the run cannot honor gets a recorded reason, so the hub says why instead of promising.
 */
import { readMoves, type MovesQuery } from '@/lib/social-hub/moves-store';
import { tonightMoves } from '@/lib/social-hub/views/moves';
import type { FetchBody } from '@/lib/social/ingest/select/enrich';
import { storyKey } from '@/lib/stories/sources/reels';

import type { LfdSeed } from './seeds';

export const PIN_VERTICAL = 'last_few_days' as const;
const ID_PREFIX = 'last_few_days:story:';
const MIN_PAGE_CHARS = 200;

export const ideaIdOf = (key: string) => `${ID_PREFIX}${key}`;
export const keyOfIdea = (ideaId: string): string | null => (ideaId.startsWith(ID_PREFIX) && ideaId.length > ID_PREFIX.length ? ideaId.slice(ID_PREFIX.length) : null);

type StoryRef = { key?: string; url?: string; headline?: string };
const asRecord = (v: unknown): Record<string, unknown> => {
  const parsed = typeof v === 'string' ? JSON.parse(v) : v;
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
};
const list = (v: unknown): StoryRef[] => (Array.isArray(v) ? (v as StoryRef[]) : []);

/** The link and headline the hub showed for a story: the latest run's queues (their rows carry `url`), else a recent post's story. */
export async function findStoryLink(q: MovesQuery, key: string): Promise<{ url: string; headline: string } | null> {
  const ok = (e: StoryRef | undefined) => (e && typeof e.url === 'string' && /^https?:\/\//i.test(e.url) ? { url: e.url, headline: String(e.headline ?? e.url).slice(0, 200) } : null);
  const seed = await q(`SELECT value FROM lfd.settings WHERE key = $1`, [`seed:${key}`]);
  const seeded = seed.rows[0] ? asRecord(seed.rows[0].value) : null;
  const fromSeed = ok(seeded ? { url: String(seeded.url ?? ''), headline: String(seeded.headline ?? '') } : undefined);
  if (fromSeed) return fromSeed;
  const runs = await q(`SELECT record FROM lfd.runs WHERE record IS NOT NULL ORDER BY COALESCE(started_at, requested_at) DESC LIMIT 3`);
  for (const r of runs.rows) {
    const rec = asRecord(r.record);
    const queues = asRecord(rec.queues);
    const hit = ok([...list(queues.major), ...list(queues.rundown), ...list(rec.picks), ...list(rec.drops)].find((e) => e.key === key));
    if (hit) return hit;
  }
  const posts = await q(`SELECT stories FROM lfd.posts WHERE status <> 'rejected' ORDER BY ny_date DESC, created_at DESC LIMIT 4`);
  for (const p of posts.rows) {
    const hit = ok(list(p.stories).find((s) => typeof s.url === 'string' && storyKey(s.url) === key));
    if (hit) return hit;
  }
  return null;
}

export type PinnedStories = {
  /** Pinned stories the run can take, in the order pinned, shaped as seeds (not stored; the run takes them like seeds). */
  stories: LfdSeed[];
  /** Every active pinned key (including ones already seeds), for consuming the pin once the story is made. */
  keys: string[];
  /** Pins the run could not even start on (no link recorded, page unreadable): the reason is recorded on the pin. */
  failed: Array<{ key: string; reason: string }>;
};

/** The active pins of Last Few Days as candidates for this run. Archived and already-skipped pins are not active. `skip`: keys that are seeds already. Throws on a read error (the run wraps it). */
export async function readPinnedStories(q: MovesQuery, deps: { fetchBody: FetchBody }, skip: ReadonlySet<string> = new Set()): Promise<PinnedStories> {
  const pins = tonightMoves(await readMoves(q, PIN_VERTICAL), PIN_VERTICAL).pins;
  const out: PinnedStories = { stories: [], keys: [], failed: [] };
  for (const pin of pins) {
    const key = keyOfIdea(pin.ideaId);
    if (!key) continue;
    out.keys.push(key);
    if (skip.has(key)) continue;
    const link = await findStoryLink(q, key);
    if (!link) { out.failed.push({ key, reason: 'no link was recorded for this story' }); continue; }
    const body = await deps.fetchBody(link.url).catch(() => null);
    if (!body || body.trim().length < MIN_PAGE_CHARS) { out.failed.push({ key, reason: 'its page could not be read' }); continue; }
    out.stories.push({ key, url: link.url, headline: link.headline, outlet: new URL(link.url).hostname.replace(/^www\./, ''), body, addedAt: pin.createdAt, expiresAt: '', status: 'open' });
  }
  return out;
}
