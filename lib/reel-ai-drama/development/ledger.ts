import type { Queryable } from '@/lib/explainers/db';
import { BLUE_CHIP_PLAYERS } from '@/lib/social-hub/blue-chip-players';
import type { ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import { ERAS, STORY_TYPES, type Era, type StoryType } from '@/lib/reel-ai-drama/types';
import { DAY_MS, toIso } from '@/lib/reel-ai-drama/development/util';

/**
 * The search ledger (MD-27, PROCESS.md D1): one cell per blue-chip player × story type × era. The
 * producer searches one cell per call; a searched cell is due again after `cell_due_days`, unless news
 * touching its player reopens it first.
 */

export type CellRow = {
  id: string;
  player_id: string;
  story_type: StoryType;
  era: Era;
  searches: number;
  pitches_made: number;
  last_searched_at: string | null;
  due_at: string | null;
  reopen_reason: string | null;
  created_at: string;
};

/** Last year each era covers (ERAS in types.ts). */
const ERA_LAST_YEAR: Record<Era, number> = { origins: 2014, early_labs: 2019, scale_up: 2022, race: 2024, now: 9999 };

/**
 * Founding years of the companies on the list that are younger than the eras: a cell in an era that
 * ended before the company existed can only come back empty, so it is never seeded. People and older
 * companies get every era.
 */
const FOUNDED: Record<string, number> = {
  anthropic: 2021,
  openai: 2015,
  'hugging-face': 2016,
  xai: 2023,
  higgsfield: 2023,
  deepseek: 2023,
  mistral: 2023,
  perplexity: 2022,
};

export function cellIsPossible(playerId: string, era: Era): boolean {
  const founded = FOUNDED[playerId];
  return founded === undefined || ERA_LAST_YEAR[era] >= founded;
}

export function allCells(): { player_id: string; story_type: StoryType; era: Era }[] {
  const out: { player_id: string; story_type: StoryType; era: Era }[] = [];
  for (const p of BLUE_CHIP_PLAYERS) {
    for (const era of Object.keys(ERAS) as Era[]) {
      if (!cellIsPossible(p.id, era)) continue;
      for (const story_type of Object.keys(STORY_TYPES) as StoryType[]) out.push({ player_id: p.id, story_type, era });
    }
  }
  return out;
}

/** Insert every cell not yet in the ledger; returns how many were new. Idempotent. */
export async function seedCells(db: Queryable): Promise<number> {
  const cells = allCells();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.cells (player_id, story_type, era)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
     ON CONFLICT (player_id, story_type, era) DO NOTHING
     RETURNING id`,
    [cells.map((c) => c.player_id), cells.map((c) => c.story_type), cells.map((c) => c.era)],
  );
  return rows.length;
}

export function cellFromRow(r: Record<string, unknown>): CellRow {
  return {
    id: String(r.id),
    player_id: String(r.player_id),
    story_type: r.story_type as StoryType,
    era: r.era as Era,
    searches: Number(r.searches),
    pitches_made: Number(r.pitches_made),
    last_searched_at: toIso(r.last_searched_at),
    due_at: toIso(r.due_at),
    reopen_reason: (r.reopen_reason as string | null) ?? null,
    created_at: toIso(r.created_at) ?? '',
  };
}

export type ReopenRequest = {
  playerId: string;
  reason: string;
  /** When the news appeared: only cells searched before it reopen, so one item reopens a cell once. */
  since?: string;
};

/** Why a cell is a candidate: 0 never searched, 1 due, 2 reopened by news (the pick order). */
export function cellTier(c: CellRow, now: Date): 0 | 1 | 2 | null {
  if (!c.last_searched_at) return 0;
  if (c.due_at && new Date(c.due_at).getTime() <= now.getTime()) return 1;
  if (c.reopen_reason) return 2;
  return null;
}

/**
 * The cells to search this session: never searched first, then due, then reopened by news. Picks
 * spread across players and story types: each pass takes at most one cell per player and one per
 * story type; later passes relax the type rule, then the player rule, only when cells are short.
 */
export async function pickCells(
  db: Queryable,
  settings: Pick<ReelAiDramaSettings, 'cells_per_session'>,
  now: Date,
  opts: { reopen?: ReopenRequest[]; count?: number; random?: () => number } = {},
): Promise<CellRow[]> {
  for (const r of opts.reopen ?? []) {
    await db.query(
      `UPDATE reel_ai_drama.cells SET reopen_reason = $2
       WHERE player_id = $1 AND last_searched_at IS NOT NULL AND due_at > $3
         AND reopen_reason IS NULL AND ($4::timestamptz IS NULL OR last_searched_at < $4::timestamptz)`,
      [r.playerId, r.reason.slice(0, 500), now.toISOString(), r.since ?? null],
    );
  }
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM reel_ai_drama.cells
     WHERE last_searched_at IS NULL OR due_at <= $1 OR reopen_reason IS NOT NULL`,
    [now.toISOString()],
  );
  const random = opts.random ?? Math.random;
  const tiers: CellRow[][] = [[], [], []];
  for (const row of rows) {
    const cell = cellFromRow(row);
    const tier = cellTier(cell, now);
    if (tier !== null) tiers[tier].push(cell);
  }
  // Within a tier: due cells oldest-searched first; otherwise a shuffle so no player is always first.
  const ordered = tiers.flatMap((tier, i) => {
    const keyed = tier.map((c) => ({ c, k: random() }));
    keyed.sort((a, b) =>
      i === 1 ? new Date(a.c.due_at!).getTime() - new Date(b.c.due_at!).getTime() || a.k - b.k : a.k - b.k,
    );
    return keyed.map((x) => x.c);
  });

  const count = opts.count ?? settings.cells_per_session;
  const picked: CellRow[] = [];
  const taken = new Set<string>();
  const players = new Set<string>();
  const types = new Set<string>();
  // One slot is kept for a cell that news reopened (MD-27); otherwise reopens never run while
  // thousands of cells are still unexplored.
  const reopened = ordered.find((c) => c.reopen_reason !== null);
  if (reopened && count > 0) {
    picked.push(reopened);
    taken.add(reopened.id);
    players.add(reopened.player_id);
    types.add(reopened.story_type);
  }
  for (const pass of [{ player: true, type: true }, { player: true, type: false }, { player: false, type: false }]) {
    for (const c of ordered) {
      if (picked.length >= count) return picked;
      if (taken.has(c.id)) continue;
      if (pass.player && players.has(c.player_id)) continue;
      if (pass.type && types.has(c.story_type)) continue;
      picked.push(c);
      taken.add(c.id);
      players.add(c.player_id);
      types.add(c.story_type);
    }
  }
  return picked;
}

/** A cell was searched (even when it came back empty, which is information too). */
export async function markSearched(
  db: Queryable,
  cellId: string,
  { pitchesMade, now, dueDays }: { pitchesMade: number; now: Date; dueDays: number },
): Promise<void> {
  await db.query(
    `UPDATE reel_ai_drama.cells
     SET searches = searches + 1, pitches_made = pitches_made + $2, last_searched_at = $3,
         due_at = $4, reopen_reason = NULL
     WHERE id = $1`,
    [cellId, pitchesMade, now.toISOString(), new Date(now.getTime() + dueDays * DAY_MS).toISOString()],
  );
}

// ── News touching a player (the Hub's news pool, read only) ──────────────────

export type NewsItem = { playerId: string; headline: string; url: string; publishedAt: string };

export type NewsCandidate = { headline: string; url: string; publishedAt: string | null };

/** Reads the Hub news pool (lib/stories). A dep so tests never touch the shared database. */
export type NewsPoolRead = (db: Queryable, now: Date) => Promise<NewsCandidate[]>;

export const liveNewsPoolRead: NewsPoolRead = async (db, now) => {
  const { livePoolReads } = await import('@/lib/stories/pool');
  const { reels, carousel } = await livePoolReads(db, now).morning();
  return [...carousel, ...reels].map((c) => ({ headline: c.headline, url: c.url, publishedAt: c.publishedAt }));
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A player's headline matcher: exact-case tokens and names, on word boundaries. */
const PLAYER_MATCHERS: ReadonlyArray<[string, RegExp]> = BLUE_CHIP_PLAYERS.map((p) => [
  p.id,
  new RegExp(`\\b(?:${[...new Set([...p.tokens, p.name, ...(p.aka ?? [])])].map(escape).join('|')})\\b`),
]);

export function playersInHeadline(headline: string): string[] {
  return PLAYER_MATCHERS.filter(([, re]) => re.test(headline)).map(([id]) => id);
}

/**
 * News from the last `days` that names a blue-chip player, one row per player and story. `db` is the
 * shared (stories) connection the Hub news pool lives on; `read` is stubbed in tests.
 */
export async function newsTouching(
  db: Queryable,
  now: Date,
  days: number,
  read: NewsPoolRead = liveNewsPoolRead,
): Promise<NewsItem[]> {
  const since = now.getTime() - days * DAY_MS;
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  for (const c of await read(db, now)) {
    if (!c.publishedAt) continue;
    const at = new Date(c.publishedAt).getTime();
    if (!Number.isFinite(at) || at < since || at > now.getTime()) continue;
    for (const playerId of playersInHeadline(c.headline)) {
      const key = `${playerId}|${c.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ playerId, headline: c.headline, url: c.url, publishedAt: new Date(at).toISOString() });
    }
  }
  return out;
}
