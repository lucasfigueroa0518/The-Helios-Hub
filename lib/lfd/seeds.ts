// lib/lfd/seeds.ts
/**
 * Seeding a Last Few Days story (design 2026-10-26-last-few-days-queue-and-seeding): a person pastes the link to a story and the
 * next run takes it before the lanes. Adding one costs nothing (the page is read with the plain fetch, no model, no search).
 * Nothing is scored or made until a run.
 *
 * One lfd.settings row per seed (key `seed:<storyKey>`) so no schema changes, and the hub write and the worker's "mark made"
 * never overwrite each other. `parseLfdSettings` ignores the keys. Archived stories (social_hub.idea_adjustments rows with the
 * idea id `last_few_days:story:<key>`) are kept out of every run.
 */
import type { HubQuery } from '@/lib/social-hub/db';
import type { FetchBody } from '@/lib/social/ingest/select/enrich';
import { isPrivateHost, SeedError } from '@/lib/social/overnight/seeds';
import { storyKey } from '@/lib/stories/sources/reels';

import type { LfdCandidate } from './types';

export { SeedError };
export const SEED_PREFIX = 'seed:';
export const SEED_DAYS = 7;
export const MAX_OPEN_SEEDS = 10;
const MIN_PAGE_CHARS = 200;
const ARCHIVE_PREFIX = 'last_few_days:story:';

export type LfdSeed = {
  key: string;
  url: string;
  headline: string;
  outlet: string;
  body: string;
  addedAt: string;
  expiresAt: string;
  status: 'open' | 'made';
  /** The last run's word on it: `in the post`, a drop reason, or `waiting: this run already had 3`. */
  outcome?: string;
};

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const asValue = (v: unknown): Record<string, unknown> => {
  const parsed = typeof v === 'string' ? JSON.parse(v) : v;
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
};

/** The story keys a person archived. Throws on a read error (the run wraps it). */
export async function readArchivedKeys(q: HubQuery): Promise<Set<string>> {
  const { rows } = await q<{ idea_id: string }>(`SELECT idea_id FROM social_hub.idea_adjustments WHERE vertical = 'last_few_days' AND kind = 'archive'`);
  return new Set(rows.filter((r) => r.idea_id.startsWith(ARCHIVE_PREFIX)).map((r) => r.idea_id.slice(ARCHIVE_PREFIX.length)));
}

/** Seeds still waiting: open, not expired, not archived. Oldest first. Throws on a read error (the run wraps it). */
export async function readOpenSeeds(q: HubQuery, now: Date, archived: ReadonlySet<string> = new Set()): Promise<LfdSeed[]> {
  const { rows } = await q<{ key: string; value: unknown }>(`SELECT key, value FROM lfd.settings WHERE key LIKE 'seed:%'`);
  const seeds: LfdSeed[] = [];
  for (const r of rows) {
    const v = asValue(r.value);
    const key = r.key.slice(SEED_PREFIX.length);
    if (v.status !== 'open' || archived.has(key) || !(Date.parse(String(v.expiresAt)) > now.getTime())) continue;
    seeds.push({
      key,
      url: String(v.url ?? ''),
      headline: String(v.headline ?? ''),
      outlet: String(v.outlet ?? ''),
      body: String(v.body ?? ''),
      addedAt: String(v.addedAt ?? ''),
      expiresAt: String(v.expiresAt),
      status: 'open',
      ...(typeof v.outcome === 'string' ? { outcome: v.outcome } : {}),
    });
  }
  return seeds.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

/** A seed as a run candidate (origin 'seed', the person's own). */
export function seedCandidate(s: LfdSeed): LfdCandidate {
  return { key: s.key, refs: [s.key], origin: 'seed', headline: s.headline, sourceName: s.outlet, url: s.url, body: s.body, publishedAt: s.addedAt, net: null, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, yours: true };
}

/** Write what a run did with each seed: the outcome, and `made` for one that shipped. A failed seed stays open. */
export async function recordSeedOutcomes(q: HubQuery, outcomes: ReadonlyArray<{ key: string; outcome: string; made: boolean }>): Promise<void> {
  for (const o of outcomes) {
    await q(
      `UPDATE lfd.settings SET value = value || jsonb_build_object('outcome', $2::text, 'status', $3::text), updated_at = now() WHERE key = $1`,
      [`${SEED_PREFIX}${o.key}`, o.outcome, o.made ? 'made' : 'open'],
    );
  }
}

/** Add a story from its link. Throws SeedError with a plain message when it cannot. */
export async function addLfdSeed(q: HubQuery, input: { url?: unknown; headline?: unknown }, deps: { fetchBody: FetchBody; now?: Date }): Promise<{ id: string; title: string }> {
  const now = deps.now ?? new Date();
  const url = clean(input.url, 2000);
  if (!/^https?:\/\//i.test(url)) throw new SeedError(400, 'Paste the story’s link; it must start with http:// or https://');
  let outlet: string;
  try {
    const u = new URL(url);
    if (isPrivateHost(u.hostname)) throw new Error('private');
    outlet = u.hostname.replace(/^www\./, '');
  } catch {
    throw new SeedError(400, 'That link doesn’t look right, or points somewhere private.');
  }
  const key = storyKey(url);
  const archived = await readArchivedKeys(q).catch(() => new Set<string>());
  if (archived.has(key)) throw new SeedError(409, 'You archived that story, so it stays out of the runs.');
  const open = await readOpenSeeds(q, now, archived);
  if (open.some((s) => s.key === key)) throw new SeedError(409, 'That story is already waiting for the next run.');
  if (open.length >= MAX_OPEN_SEEDS) throw new SeedError(409, `You have ${MAX_OPEN_SEEDS} seeded stories waiting; archive one first.`);
  const latest = await q<{ stories: unknown }>(`SELECT stories FROM lfd.posts WHERE status <> 'rejected' ORDER BY ny_date DESC, created_at DESC LIMIT 1`).catch(() => ({ rows: [] }));
  const inLatest = (Array.isArray(latest.rows[0]?.stories) ? (latest.rows[0]!.stories as Array<{ url?: string }>) : []).some((s) => typeof s.url === 'string' && storyKey(s.url) === key);
  if (inLatest) throw new SeedError(409, 'That story is already in the latest Last Few Days post.');

  const body = await deps.fetchBody(url).catch(() => null);
  if (!body || body.trim().length < MIN_PAGE_CHARS) throw new SeedError(422, 'I couldn’t read that page (a paywall, or too little text). Nothing was added.');
  const headline = clean(input.headline, 200) || (body.split('\n').map((l) => l.trim()).find((l) => l.length > 15) ?? url).slice(0, 140);
  const value = { url, headline, outlet, body, addedAt: now.toISOString(), expiresAt: new Date(now.getTime() + SEED_DAYS * 86_400_000).toISOString(), status: 'open' };
  await q(
    `INSERT INTO lfd.settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [`${SEED_PREFIX}${key}`, JSON.stringify(value)],
  );
  return { id: key, title: headline };
}
