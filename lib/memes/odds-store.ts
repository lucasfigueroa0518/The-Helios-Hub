/**
 * Where the gate's evidence lives (LFD lab plan §2, §3, §6): Jev story tags,
 * fault scores, the lab's knobs, and the graded rows the odds are counted
 * from. Server only.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { Queryable } from './db';
import { MEME_FAULTS, type FaultScore } from './faults';
import { DEFAULT_GATE_THRESHOLD, type OddsRow } from './odds';
import { evidenceRegimes } from './regime';
import { TAGGER_VERSION, type StoryTags } from './story-tags';

/** The tagger's seed file (scripts/memes_story_tags.ts writes it; the lab loads it on open). */
export const storyTagsSeedPath = (version: string) =>
  path.join(process.cwd(), '.memes-local', 'predict', `story-tags-${version.replace(/@/g, '-')}.json`);

/**
 * Load the seed tags for the current tagger version into memes.story_tags. The seed wins: these are the tags the
 * graded stories were counted under, so a later tagging of the same story (a simulation) must not move them.
 */
export async function loadSeedTags(db: Queryable, file = storyTagsSeedPath(TAGGER_VERSION)): Promise<number> {
  if (!fs.existsSync(file)) return 0;
  const seed = JSON.parse(fs.readFileSync(file, 'utf8')) as { version: string; tags: Record<string, StoryTags> };
  if (seed.version !== TAGGER_VERSION) return 0;
  let n = 0;
  for (const [id, tags] of Object.entries(seed.tags)) {
    const { rows } = await db.query<{ story_id: string }>(
      `INSERT INTO memes.story_tags (story_id, tagger_version, tags) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (story_id, tagger_version) DO UPDATE SET tags = EXCLUDED.tags WHERE memes.story_tags.tags IS DISTINCT FROM EXCLUDED.tags
       RETURNING story_id`,
      [id, seed.version, JSON.stringify(tags)],
    );
    n += rows.length;
  }
  return n;
}

/**
 * Save a story's tags. A story keeps its first tags for a tagger version: re-tagging can come out differently
 * (other text, Jev's own variance), and a graded story's tags must not move it between cells after the fact.
 */
export async function saveStoryTags(db: Queryable, storyId: string, tags: StoryTags): Promise<void> {
  await db.query(
    `INSERT INTO memes.story_tags (story_id, tagger_version, tags) VALUES ($1, $2, $3::jsonb) ON CONFLICT (story_id, tagger_version) DO NOTHING`,
    [storyId, tags.version, JSON.stringify(tags)],
  );
}

export async function loadStoryTags(db: Queryable, ids: string[], version = TAGGER_VERSION): Promise<Map<string, StoryTags>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ story_id: string; tags: StoryTags }>(
    `SELECT story_id, tags FROM memes.story_tags WHERE tagger_version = $1 AND story_id = ANY($2::text[])`,
    [version, ids],
  );
  return new Map(rows.map((r) => [r.story_id, r.tags]));
}

/**
 * One row per graded single run of `regime` (or a regime declared equivalent: regime.ts EQUIVALENT_REGIMES) whose
 * story has tags of `taggerVersion`.
 * A run counts as good when any slate meme is rated 3 or 4, as not good when every slate meme is graded and none
 * is, and not at all while it is partly graded with no good meme yet.
 */
export async function oddsRows(db: Queryable, regime: string, taggerVersion = TAGGER_VERSION): Promise<OddsRow[]> {
  const { rows } = await db.query<{ story_id: string; tags: StoryTags; any_good: boolean; slate_n: number; graded_n: number }>(
    `SELECT r.post_id AS story_id, st.tags,
            COALESCE(bool_or(p.rating >= 3), false) AS any_good,
            count(*)::int AS slate_n,
            count(p.rating)::int AS graded_n
       FROM memes.requests r
       JOIN memes.slates s ON s.request_id = r.id
       JOIN memes.memes m ON m.slate_id = s.id AND m.in_slate
       LEFT JOIN memes.picks p ON p.meme_id = m.id
       JOIN memes.story_tags st ON st.story_id = r.post_id AND st.tagger_version = $2
      WHERE r.kind = 'single' AND r.status = 'ok' AND s.shape->>'regime' = ANY($1::text[])
      GROUP BY r.id, r.post_id, st.tags`,
    [evidenceRegimes(regime), taggerVersion],
  );
  return rows.flatMap((r) => (r.any_good || (r.graded_n > 0 && r.graded_n === r.slate_n) ? [{ storyId: r.story_id, tags: r.tags, anyGood: r.any_good }] : []));
}

/**
 * Stories on their way into the evidence: a single run of `regime` (or still queued) whose story has tags of
 * `taggerVersion`, that oddsRows doesn't count yet (not generated, or not graded enough). The lab shows them so
 * Lucas can see a short cell filling.
 */
export async function pendingRows(db: Queryable, regime: string, taggerVersion = TAGGER_VERSION): Promise<Array<{ storyId: string; tags: StoryTags }>> {
  const counted = new Set((await oddsRows(db, regime, taggerVersion)).map((r) => r.storyId));
  const { rows } = await db.query<{ story_id: string; tags: StoryTags }>(
    `SELECT DISTINCT r.post_id AS story_id, st.tags
       FROM memes.requests r
       JOIN memes.story_tags st ON st.story_id = r.post_id AND st.tagger_version = $2
       LEFT JOIN memes.slates s ON s.request_id = r.id
      WHERE r.kind = 'single' AND r.status IN ('requested', 'running', 'ok')
        AND (s.id IS NULL OR s.shape->>'regime' = ANY($1::text[]))`,
    [evidenceRegimes(regime), taggerVersion],
  );
  return rows.filter((r) => !counted.has(r.story_id)).map((r) => ({ storyId: r.story_id, tags: r.tags }));
}

export type LabSettings = { gateThreshold: number };
export const DEFAULT_SETTINGS: LabSettings = { gateThreshold: DEFAULT_GATE_THRESHOLD };

export async function getSettings(db: Queryable): Promise<LabSettings> {
  const { rows } = await db.query<{ value: { threshold?: number } }>(`SELECT value FROM memes.lab_settings WHERE key = 'gate'`);
  const t = rows[0]?.value?.threshold;
  return { gateThreshold: typeof t === 'number' ? t : DEFAULT_SETTINGS.gateThreshold };
}

/** Validate and save; returns the settings now in force. Throws on an out-of-range value. */
export async function saveSettings(db: Queryable, input: { gateThreshold?: unknown }): Promise<LabSettings> {
  const cur = await getSettings(db);
  if (input.gateThreshold !== undefined) {
    const t = input.gateThreshold;
    if (typeof t !== 'number' || !(t > 0 && t <= 1)) throw new Error('The gate threshold must be between 0 and 1.');
    cur.gateThreshold = t;
  }
  await db.query(
    `INSERT INTO memes.lab_settings (key, value) VALUES ('gate', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ threshold: cur.gateThreshold })],
  );
  return cur;
}

export async function saveFaults(db: Queryable, memeId: string, f: FaultScore): Promise<void> {
  await db.query(
    `INSERT INTO memes.meme_faults (meme_id, version, faults, count, sum) VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (meme_id, version) DO UPDATE SET faults = EXCLUDED.faults, count = EXCLUDED.count, sum = EXCLUDED.sum, created_at = now()`,
    [memeId, f.version, JSON.stringify({ probs: f.faults, flagged: f.flagged }), f.count, f.sum],
  );
}

export type StoredFaults = { memeId: string; count: number; sum: number; flagged: string[]; probs: Record<string, number> };

export async function loadFaults(db: Queryable, memeIds: string[], version = MEME_FAULTS.version): Promise<Map<string, StoredFaults>> {
  if (!memeIds.length) return new Map();
  const { rows } = await db.query<{ meme_id: string; count: number; sum: number; faults: { probs: Record<string, number>; flagged: string[] } }>(
    `SELECT meme_id::text, count, sum, faults FROM memes.meme_faults WHERE version = $1 AND meme_id = ANY($2::uuid[])`,
    [version, memeIds],
  );
  return new Map(rows.map((r) => [r.meme_id, { memeId: r.meme_id, count: r.count, sum: Number(r.sum), flagged: r.faults.flagged, probs: r.faults.probs }]));
}
