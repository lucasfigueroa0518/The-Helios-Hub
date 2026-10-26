import type { FetchBody } from '@/lib/social/ingest/select/enrich';
import { scoreGroups } from '@/lib/social/ingest/select/score';
import type { ScoredGroup, StoryGroup } from '@/lib/social/ingest/select/types';
import type { JevAsk } from '@/lib/social/jev/client';
import { loadPinnedCandidates } from '@/lib/social/overnight/pinned';
import type { Query } from '@/lib/social/store/pg';

/**
 * Seeding a Carousels story (design 2026-10-25-carousels-seeding-design): a person pastes the link to a story and it joins
 * the queue as a story of their own ("Yours"). The page text is read with a plain web request (no model), and the story is
 * scored once, as each nightly candidate is (story-scoring, one Jev call: a fraction of a cent). Nothing is made: a pin,
 * Run now or the night makes it, at the usual run cap.
 *
 * A seed is kept in social.settings (`carousel_seeds`, a JSON list of scored story groups) so no schema changes. Pins,
 * Run now and the night find it through loadPinnedCandidates, which reads these as well as the run shortlists.
 */

export const SEEDS_KEY = 'carousel_seeds';
/** A seed that nobody made waits this long, then goes (news goes stale). */
export const SEED_DAYS = 7;
export const MAX_OPEN_SEEDS = 10;
const MIN_PAGE_CHARS = 200;

export class SeedError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type StoredSeed = ScoredGroup & { seed: { addedAt: string; expiresAt: string } };

export type SeedDeps = {
  fetchBody: FetchBody;
  jev: JevAsk;
  now?: Date;
};

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const outletOf = (url: string) => new URL(url).hostname.replace(/^www\./, '');

/** The seeds still waiting: stored, not expired. Never throws (no table, bad JSON: none). */
export async function readOpenSeeds(query: Query, now = new Date()): Promise<StoredSeed[]> {
  try {
    const { rows } = await query(`SELECT value FROM social.settings WHERE key = $1`, [SEEDS_KEY]);
    const value = typeof rows[0]?.value === 'string' ? JSON.parse(rows[0].value) : rows[0]?.value;
    return Array.isArray(value) ? (value as StoredSeed[]).filter((s) => Date.parse(s.seed?.expiresAt) > now.getTime()) : [];
  } catch {
    return [];
  }
}

/** Seeds a person archived free their place. Never throws. */
async function archivedIds(query: Query): Promise<Set<string>> {
  try {
    const { rows } = await query(`SELECT idea_id FROM social_hub.idea_adjustments WHERE vertical = 'carousels' AND kind = 'archive'`);
    return new Set(rows.map((r: { idea_id: string }) => r.idea_id.replace(/^carousels:story:/, '')));
  } catch {
    return new Set();
  }
}

async function postedHeadlines(query: Query): Promise<string[]> {
  try {
    const { rows } = await query(`SELECT title FROM social.posts WHERE origin = 'pipeline' ORDER BY created_at DESC LIMIT 30`);
    return rows.map((r: { title: string }) => r.title).filter(Boolean);
  } catch {
    return [];
  }
}

/** Add a story to the Carousels queue from its link. Throws SeedError with a plain message when it cannot. */
export async function addCarouselSeed(query: Query, input: { url?: unknown; headline?: unknown }, deps: SeedDeps): Promise<{ id: string; title: string; score: number; status: string }> {
  const now = deps.now ?? new Date();
  const url = clean(input.url, 2000);
  if (!/^https?:\/\//i.test(url)) throw new SeedError(400, 'Paste the story’s link; it must start with http:// or https://');
  let outlet: string;
  try {
    outlet = outletOf(url);
  } catch {
    throw new SeedError(400, 'That link doesn’t look right.');
  }
  const open = await readOpenSeeds(query, now);
  const archived = await archivedIds(query);
  if (open.filter((s) => !archived.has(s.id)).length >= MAX_OPEN_SEEDS) {
    throw new SeedError(409, `You have ${MAX_OPEN_SEEDS} seeded stories waiting; make or archive one first.`);
  }
  // Already in the queue, as a shortlisted story or as a seed: say so rather than add it twice.
  const existing = await loadPinnedCandidates(query, [url]).then(() => true, () => false);
  if (existing) throw new SeedError(409, 'That story is already in the queue.');

  const body = await deps.fetchBody(url).catch(() => null);
  if (!body || body.trim().length < MIN_PAGE_CHARS) {
    throw new SeedError(422, 'I couldn’t read that page (a paywall, or too little text). Nothing was added.');
  }
  const headline = clean(input.headline, 200) || (body.split('\n').map((l) => l.trim()).find((l) => l.length > 15) ?? url).slice(0, 140);
  const article = { feedSlug: 'seed', feedKind: 'native' as const, source: outlet, sourceUrl: url, headline, byline: null, body, publishedAt: now };
  const group: StoryGroup = {
    id: url,
    members: [{ url, outlet, title: headline, publishedAt: now, feedSlug: 'seed' }],
    outlets: [outlet],
    outletCount: 1,
    publishedAt: now,
    representative: article,
    articles: [article],
    body,
    read: [{ url, outlet, chars: body.length }],
    tried: [url],
  };
  const [scored] = await scoreGroups([group], deps.jev, await postedHeadlines(query));
  if (!scored) throw new SeedError(500, 'The story could not be scored.');
  const seed: StoredSeed = { ...scored, seed: { addedAt: now.toISOString(), expiresAt: new Date(now.getTime() + SEED_DAYS * 86_400_000).toISOString() } };
  await query(
    `INSERT INTO social.settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SEEDS_KEY, JSON.stringify([...open, seed])],
  );
  return { id: url, title: headline, score: scored.probSum, status: scored.status };
}
