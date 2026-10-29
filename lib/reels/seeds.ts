import { dbQuery } from '@/lib/db';
import { REFERENCE_POOL_HOURS } from '@/lib/reels/config';
import { loadPublishedStoryKeys, storyUrlKey } from '@/lib/reels/copy/held-out';
import type { JevRunner } from '@/lib/reels/jev/runner';
import { fetchPageFollowingRedirects, canonicalizeUrl } from '@/lib/reels/net/http';
import { parsePage } from '@/lib/reels/net/html';
import { scoreOneIdea } from '@/lib/reels/pipeline/scoring';
import { createPostIdea, insertSource } from '@/lib/reels/repository';
import { loadIdeaMaterial } from '@/lib/reels/scoring/store';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';
import { isPrivateHost } from '@/lib/net/private-host';

/**
 * Seeding a Text on Screen idea (design 2026-10-26-text-on-screen-seeding-design): a person types an idea into the queue.
 * It is an ordinary source and post idea, marked by its source (`adapter_id = 'seed'`, `drop_reason = 'seed'` so no
 * grouping read ever returns it), scored once with the pass 1 and pass 2 calls every nightly idea gets, and written as ONE
 * `carryover` row on the newest slate: exactly the row `putOnSlate` writes, so a pin can copy it onto tonight's slate.
 * No slate and no run row are created. Nothing is made: a pin, Run now, or the night as a carryover makes it.
 */

export const SEED_ADAPTER = 'seed';
export const SEED_DAYS = 7;
export const MAX_HEADLINE_CHARS = 200;
export const MAX_TEXT_CHARS = 10_000;
/** The same headline typed again inside this window is the first click's seed (a double-click). */
const DOUBLE_CLICK_SECONDS = 60;
const MIN_PAGE_CHARS = 200;
const HEADLINE_FLOOR = 0.6;

export class SeedError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type ReelSeedDeps = {
  jev: JevRunner;
  /** The page's text, or null when it cannot be read. Default: the plain page reader the night uses (no model). */
  readPage?: (url: string) => Promise<string | null>;
};

export type ReelSeedResult = {
  id: string;
  title: string;
  /** False when the model call failed: the idea is kept and shown "not scored yet". */
  scored: boolean;
  net: number | null;
  /** Read-only notes (never rejections): the idea was added anyway. */
  flags: string[];
  /** True when this was a repeat click and the first seed is returned. */
  repeat?: boolean;
};

/** What a seed click comes to. Only `added` wrote anything; the others stop before any write (and, but for `no_match` after a search, before any spend). */
export type ReelSeedOutcome =
  | (ReelSeedResult & { status: 'added'; substitute?: { url: string; title: string; why: 'link_unreadable' | 'headline_only' } })
  | { status: 'duplicate'; existing: { id: string; headline: string; net: number | null; yours: boolean } }
  | { status: 'needs_paid_confirm'; estimateUsd: number; maxUsd: number }
  | { status: 'no_match'; reason: 'nothing_found' | 'scoring_unavailable' };

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

async function defaultReadPage(url: string): Promise<string | null> {
  const page = await fetchPageFollowingRedirects(url, { retries: 0, timeoutMs: 15_000 });
  return parsePage(page.html).text;
}

const OPEN_SEEDS_SQL = `
SELECT m.post_idea_id::text AS id, so.headline, so.ingest_time::text AS added_at
  FROM reels.sources so
  JOIN reels.post_idea_members m ON m.source_id = so.id
 WHERE so.adapter_id = '${SEED_ADAPTER}' AND so.drop_reason = '${SEED_ADAPTER}'
   AND so.ingest_time > now() - interval '${SEED_DAYS} days'
   AND NOT EXISTS (SELECT 1 FROM reels.video_jobs j WHERE j.post_idea_id = m.post_idea_id AND j.status = 'ok')
   AND NOT EXISTS (SELECT 1 FROM reels.published_status p WHERE p.post_idea_id = m.post_idea_id AND p.published)`;
const NOT_ARCHIVED = `
   AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a
                    WHERE a.vertical = 'reels' AND a.kind = 'archive' AND a.idea_id = 'reels:idea:' || m.post_idea_id::text)`;

/** The seeds still waiting: under a week old, not made, not archived. A database without the moves table counts archives as none. */
export async function readOpenSeeds(): Promise<Array<{ id: string; headline: string; addedAt: string }>> {
  const rows = await dbQuery<{ id: string; headline: string; added_at: string }>(`${OPEN_SEEDS_SQL}${NOT_ARCHIVED} ORDER BY so.ingest_time DESC`).catch(() =>
    dbQuery<{ id: string; headline: string; added_at: string }>(`${OPEN_SEEDS_SQL} ORDER BY so.ingest_time DESC`),
  );
  return rows.rows.map((r) => ({ id: r.id, headline: r.headline, addedAt: r.added_at }));
}

/** The "No bucket cleared its bar" guard: true when the idea is a person's seed that has no net score to copy onto a slate. */
export async function isUnscoredSeed(postIdeaId: string): Promise<boolean> {
  try {
    const { rows } = await dbQuery(
      `SELECT 1
         FROM reels.post_idea_members m JOIN reels.sources so ON so.id = m.source_id
        WHERE m.post_idea_id = $1::uuid AND so.adapter_id = '${SEED_ADAPTER}' AND so.drop_reason = '${SEED_ADAPTER}'
          AND NOT EXISTS (SELECT 1 FROM reels.idea_scores s
                           WHERE s.post_idea_id = m.post_idea_id AND s.net IS NOT NULL AND s.chosen_bucket IS NOT NULL AND s.chosen_framework IS NOT NULL)`,
      [postIdeaId],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Notes shown beside the result. Each read is read-only and never throws. */
async function warningsFor(canonical: string | null): Promise<string[]> {
  const flags: string[] = [];
  if (canonical) {
    try {
      const key = storyUrlKey(canonical);
      if (key && (await loadPublishedStoryKeys()).urls.has(key)) flags.push('This story already posted recently.');
    } catch { /* a note, not a gate */ }
  }
  return flags;
}

const QUEUE_DUPLICATE_SQL = (archived: boolean) => `
WITH latest AS (SELECT id FROM reels.score_slates ORDER BY scored_at DESC LIMIT 1),
queued AS (
  SELECT s.post_idea_id FROM reels.idea_scores s JOIN latest ON s.slate_id = latest.id
  UNION
  SELECT m.post_idea_id FROM reels.post_idea_members m JOIN reels.sources so ON so.id = m.source_id
   WHERE so.adapter_id = '${SEED_ADAPTER}' AND so.drop_reason = '${SEED_ADAPTER}' AND so.ingest_time > now() - interval '${SEED_DAYS} days'
),
hits AS (
  SELECT q.post_idea_id, s.headline,
         CASE WHEN $1::text IS NOT NULL AND s.canonical_url = $1 THEN 1.0
              ELSE greatest(similarity(s.headline, $2), word_similarity(s.headline, $2), word_similarity($2, s.headline)) END AS sim
    FROM queued q
    JOIN reels.post_idea_members m ON m.post_idea_id = q.post_idea_id
    JOIN reels.sources s ON s.id = m.source_id
   WHERE true${archived ? `
     AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a
                      WHERE a.vertical = 'reels' AND a.kind = 'archive' AND a.idea_id = 'reels:idea:' || q.post_idea_id::text)` : ''}
)
SELECT h.post_idea_id::text AS id, h.headline,
       (SELECT s2.net FROM reels.idea_scores s2 JOIN reels.score_slates sl ON sl.id = s2.slate_id
         WHERE s2.post_idea_id = h.post_idea_id ORDER BY sl.scored_at DESC LIMIT 1) AS net,
       EXISTS (SELECT 1 FROM reels.post_idea_members m2 JOIN reels.sources so2 ON so2.id = m2.source_id
                WHERE m2.post_idea_id = h.post_idea_id AND so2.adapter_id = '${SEED_ADAPTER}' AND so2.drop_reason = '${SEED_ADAPTER}') AS yours
  FROM hits h
 WHERE h.sim >= $3
 ORDER BY h.sim DESC
 LIMIT 1`;

/**
 * The idea already in the queue (on the newest slate, or an open seed) that has this link or a headline close to this one.
 * Read-only, and null when the read fails: a duplicate check is a courtesy, never a gate on the write.
 */
export async function findQueueDuplicate(canonical: string | null, headline: string): Promise<Extract<ReelSeedOutcome, { status: 'duplicate' }> | null> {
  type Row = { id: string; headline: string; net: number | null; yours: boolean };
  const args = [canonical, headline, HEADLINE_FLOOR];
  try {
    const { rows } = await dbQuery<Row>(QUEUE_DUPLICATE_SQL(true), args).catch(() => dbQuery<Row>(QUEUE_DUPLICATE_SQL(false), args));
    const hit = rows[0];
    if (!hit) return null;
    return { status: 'duplicate', existing: { id: hit.id, headline: hit.headline, net: hit.net == null ? null : Number(hit.net), yours: hit.yours } };
  } catch {
    return null;
  }
}

/** Write the scored idea as one `carryover` row on the newest slate (what putOnSlate writes). False when no slate exists. */
async function writeSeedRow(postIdeaId: string, result: InterpretedScore): Promise<boolean> {
  const { rows } = await dbQuery(
    `WITH newest AS (SELECT id FROM reels.score_slates ORDER BY scored_at DESC LIMIT 1)
     INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework,
                                    psychology, bucket_score, value_score, blockbuster, confidence, components)
     SELECT newest.id, $1::uuid, 'carryover', $2, (SELECT COALESCE(max(rank), 0) + 1 FROM reels.idea_scores WHERE slate_id = newest.id), false,
            $3, $4, $5, $6, $7, $8, $9, $10::jsonb
       FROM newest
     ON CONFLICT (slate_id, post_idea_id) DO NOTHING
     RETURNING post_idea_id::text`,
    [
      postIdeaId, result.net, result.chosenBucket, result.chosenFramework, result.psychologyTerm, result.bucketScore,
      result.value, result.blockbuster, result.bucketConfidence, JSON.stringify(result),
    ],
  );
  return rows.length > 0;
}

/**
 * Add a typed idea to the Text on Screen queue. Throws SeedError (with a plain message) when it is refused; nothing is spent
 * or written in that case. A failed model call is not a refusal: the idea is kept, `scored: false`.
 */
export async function addReelSeed(input: { headline?: unknown; text?: unknown; url?: unknown; seedAnyway?: boolean; confirmPaid?: boolean }, deps: ReelSeedDeps): Promise<ReelSeedOutcome> {
  const headline = clean(input.headline);
  const text = clean(input.text);
  const link = clean(input.url);
  if (!headline) throw new SeedError(400, 'Write the idea’s headline.');
  if (headline.length > MAX_HEADLINE_CHARS) throw new SeedError(400, `The headline is ${headline.length - MAX_HEADLINE_CHARS} characters over the ${MAX_HEADLINE_CHARS} limit. Cut that much.`);
  if (text.length > MAX_TEXT_CHARS) throw new SeedError(400, `Your text is ${text.length - MAX_TEXT_CHARS} characters over the ${MAX_TEXT_CHARS.toLocaleString('en-US')} limit. Cut that much; nothing was trimmed for you.`);
  let canonical: string | null = null;
  if (link) {
    try {
      const parsed = new URL(link);
      if (!/^https?:$/.test(parsed.protocol) || isPrivateHost(parsed.hostname)) throw new Error('bad');
      canonical = canonicalizeUrl(link);
    } catch {
      throw new SeedError(400, 'That link doesn’t look right, or points somewhere private. It must start with http:// or https://');
    }
  }

  // A double-click: the same headline inside a minute is the first seed.
  const again = await dbQuery<{ id: string; headline: string; net: number | null }>(
    `SELECT m.post_idea_id::text AS id, so.headline,
            (SELECT s.net FROM reels.idea_scores s WHERE s.post_idea_id = m.post_idea_id ORDER BY s.rank DESC NULLS LAST LIMIT 1) AS net
       FROM reels.sources so JOIN reels.post_idea_members m ON m.source_id = so.id
      WHERE so.adapter_id = '${SEED_ADAPTER}' AND so.headline = $1 AND so.ingest_time > now() - ($2 || ' seconds')::interval
      ORDER BY so.ingest_time DESC LIMIT 1`,
    [headline, String(DOUBLE_CLICK_SECONDS)],
  );
  if (again.rows[0]) return { status: 'added', id: again.rows[0].id, title: again.rows[0].headline, scored: again.rows[0].net != null, net: again.rows[0].net, flags: [], repeat: true };

  // Refuse before spending anything: no scored night to sit on.
  const slate = await dbQuery(`SELECT 1 FROM reels.score_slates LIMIT 1`);
  if (slate.rows.length === 0) throw new SeedError(409, 'No night has been scored yet, so the idea has no queue to join. Nothing was spent.');

  if (!input.seedAnyway) {
    const duplicate = await findQueueDuplicate(canonical, headline);
    if (duplicate) return duplicate;
  }

  const flags: string[] = [];
  let body = text;
  if (!body && link) {
    const page = await (deps.readPage ?? defaultReadPage)(link).catch(() => null);
    if (page && page.trim().length >= MIN_PAGE_CHARS) body = page.trim().slice(0, MAX_TEXT_CHARS);
    else flags.push('I couldn’t read that page, so the idea uses just your headline as its text. A line or two of your own would give the writer more to work with.');
  }
  if (!body) body = headline;
  if (body === headline && !link) flags.push('A one-line idea gives thin copy. Paste a few lines of the story if you have them.');

  // The source, then the idea. The source is deleted again if the idea cannot be made, so nothing half-exists.
  const sourceId = await insertSource({
    runId: null as unknown as string, // run_id is nullable; a seed belongs to no night
    canonicalUrl: canonical ?? `seed://${crypto.randomUUID()}`,
    headline,
    body,
    author: null,
    byline: null,
    sourceName: 'Your seed',
    sourceType: 'A1',
    adapterId: SEED_ADAPTER,
    bucket: 'A',
    publishTime: null,
    language: null,
    engagement: {},
    mediaUrls: [],
    citationUrls: [],
    rawPayload: { seed: true },
    dropReason: 'seed',
  });
  if (!sourceId) throw new SeedError(500, 'The idea could not be saved.');
  let ideaId: string;
  try {
    ideaId = await createPostIdea(sourceId, null, 'seed: typed in by a person');
    // Not timely: the night scores a seed only as a carryover or by pin, never as tonight's new material.
    await dbQuery(`UPDATE reels.post_ideas SET timely = false WHERE id = $1`, [ideaId]);
  } catch (error) {
    await dbQuery(`DELETE FROM reels.sources WHERE id = $1`, [sourceId]).catch(() => undefined);
    throw error;
  }

  flags.push(...(await warningsFor(canonical)));

  // Score it once (pass 1, then pass 2 when a framework and bucket survive). A failure keeps the idea, unscored.
  try {
    const [material] = await loadIdeaMaterial([ideaId]);
    if (!material) throw new Error('idea not found');
    const result = await scoreOneIdea(null as unknown as string, deps.jev, material);
    const written = await writeSeedRow(ideaId, result);
    return { status: 'added', id: ideaId, title: headline, scored: written, net: written ? result.net : null, flags };
  } catch (error) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), component: 'reels-seed', message: 'scoring_failed', postIdeaId: ideaId, error: error instanceof Error ? error.message : String(error) }));
    flags.push('Scoring failed, so the idea is kept but shows “Not scored yet”.');
    return { status: 'added', id: ideaId, title: headline, scored: false, net: null, flags };
  }
}
