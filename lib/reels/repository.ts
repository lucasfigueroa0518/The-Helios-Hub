import type { PoolClient } from 'pg';

import { dbQuery, dbTransaction } from '@/lib/db';
import {
  GROUP_SIZE_CAP,
  IDEA_MERGE_MAX_PAIRS,
  IDEA_MERGE_SIMILARITY_FLOOR,
  REFERENCE_POOL_HOURS,
  RETENTION_DAYS,
  SHORTLIST_LIMIT,
  SHORTLIST_SIMILARITY_FLOOR,
  STALE_RUN_MINUTES,
} from '@/lib/reels/config';
import { monthStart } from '@/lib/reels/schedule';
import type {
  Bucket,
  DropReason,
  Engagement,
  GroupingAction,
  MemberRole,
  ReviewFlagKind,
  RunStats,
  RunStatus,
  RunTrigger,
  SourceResult,
  SourceType,
} from '@/lib/reels/types';

export type RunRow = {
  id: string;
  trigger: RunTrigger;
  status: RunStatus;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  note: string | null;
  source_results: SourceResult[];
  stats: Partial<RunStats>;
};

/**
 * Queue a run for the worker. The partial unique index on status = 'requested'
 * makes a double click a no-op rather than two nights of ingestion.
 */
export async function requestRun(trigger: RunTrigger): Promise<RunRow | null> {
  const { rows } = await dbQuery<RunRow>(
    `INSERT INTO reels.runs (trigger, status)
     VALUES ($1, 'requested')
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [trigger],
  );
  return rows[0] ?? null;
}

export async function pendingRun(): Promise<RunRow | null> {
  const { rows } = await dbQuery<RunRow>(
    `SELECT * FROM reels.runs
      WHERE status IN ('requested', 'running')
      ORDER BY requested_at
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

/**
 * Move the queued run to `running`, but only when nothing else is in flight.
 * The unique index on status = 'running' is the lock, so two workers cannot
 * both claim the same night.
 */
export async function claimRequestedRun(): Promise<RunRow | null> {
  const { rows } = await dbQuery<RunRow>(
    `UPDATE reels.runs
        SET status = 'running', started_at = now()
      WHERE id = (
        SELECT id FROM reels.runs
         WHERE status = 'requested'
           AND NOT EXISTS (SELECT 1 FROM reels.runs r WHERE r.status = 'running')
         ORDER BY requested_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING *`,
  );
  return rows[0] ?? null;
}

/** Queue a run and claim it in one step, for the scheduler and the CLI. */
export async function startRun(trigger: RunTrigger): Promise<RunRow | null> {
  await requestRun(trigger);
  return claimRequestedRun();
}

export async function finishRun(
  runId: string,
  status: Exclude<RunStatus, 'running'>,
  sourceResults: SourceResult[],
  stats: Partial<RunStats>,
  note?: string,
): Promise<void> {
  await dbQuery(
    `UPDATE reels.runs
        SET status = $2,
            finished_at = now(),
            source_results = $3::jsonb,
            stats = $4::jsonb,
            note = $5
      WHERE id = $1`,
    [runId, status, JSON.stringify(sourceResults), JSON.stringify(stats), note ?? null],
  );
}

export async function recordSkippedRun(
  trigger: RunTrigger,
  note: string,
  runId?: string,
): Promise<void> {
  if (runId) {
    await dbQuery(
      `UPDATE reels.runs SET status = 'skipped', finished_at = now(), note = $2 WHERE id = $1`,
      [runId, note],
    );
    return;
  }
  await dbQuery(
    `INSERT INTO reels.runs (trigger, status, started_at, finished_at, note)
     VALUES ($1, 'skipped', now(), now(), $2)`,
    [trigger, note],
  );
}

/** A run whose process died leaves a 'running' row that blocks the next night. */
export async function releaseStaleRuns(
  olderThanMinutes = STALE_RUN_MINUTES,
): Promise<number> {
  const { rowCount } = await dbQuery(
    `UPDATE reels.runs
        SET status = 'failed',
            finished_at = now(),
            note = COALESCE(note, 'Run did not report a result; released as stale.')
      WHERE status = 'running'
        AND started_at < now() - ($1 || ' minutes')::interval`,
    [String(olderThanMinutes)],
  );
  return rowCount ?? 0;
}

export async function listRuns(limit = 14): Promise<RunRow[]> {
  const { rows } = await dbQuery<RunRow>(
    `SELECT * FROM reels.runs ORDER BY requested_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

// ── Watermarks ───────────────────────────────────────────────────────────────

export async function getWatermark(adapterId: string): Promise<Date | null> {
  const { rows } = await dbQuery<{ last_success_at: string | null }>(
    `SELECT last_success_at FROM reels.watermarks WHERE adapter_id = $1`,
    [adapterId],
  );
  const value = rows[0]?.last_success_at;
  return value ? new Date(value) : null;
}

export async function markWatermarkAttempt(adapterId: string): Promise<void> {
  await dbQuery(
    `INSERT INTO reels.watermarks (adapter_id, last_attempt_at)
     VALUES ($1, now())
     ON CONFLICT (adapter_id) DO UPDATE SET last_attempt_at = now()`,
    [adapterId],
  );
}

/** Only a successful pull advances the window, so the next night backfills (D-038). */
export async function markWatermarkSuccess(adapterId: string, at: Date): Promise<void> {
  await dbQuery(
    `INSERT INTO reels.watermarks (adapter_id, last_success_at, last_attempt_at)
     VALUES ($1, $2, now())
     ON CONFLICT (adapter_id) DO UPDATE SET last_success_at = EXCLUDED.last_success_at,
                                            last_attempt_at = now()`,
    [adapterId, at.toISOString()],
  );
}

// ── Fingerprints ─────────────────────────────────────────────────────────────

export type FingerprintRow = { canonical_url: string; first_seen: string };

export async function findFingerprints(urls: string[]): Promise<Map<string, Date>> {
  if (urls.length === 0) return new Map();
  const { rows } = await dbQuery<FingerprintRow>(
    `SELECT canonical_url, first_seen FROM reels.fingerprints WHERE canonical_url = ANY($1::text[])`,
    [urls],
  );
  return new Map(rows.map((row) => [row.canonical_url, new Date(row.first_seen)]));
}

export async function touchFingerprint(url: string, adapterId: string): Promise<void> {
  await dbQuery(
    `INSERT INTO reels.fingerprints (canonical_url, adapter_id)
     VALUES ($1, $2)
     ON CONFLICT (canonical_url) DO UPDATE SET last_seen = now()`,
    [url, adapterId],
  );
}

// ── Sources ──────────────────────────────────────────────────────────────────

export type InsertSourceInput = {
  runId: string;
  canonicalUrl: string;
  headline: string;
  body: string;
  author: string | null;
  byline: string | null;
  sourceName: string;
  sourceType: SourceType;
  adapterId: string;
  bucket: Bucket;
  publishTime: Date | null;
  language: string | null;
  engagement: Engagement;
  mediaUrls: string[];
  citationUrls: string[];
  rawPayload: unknown;
  dropReason: DropReason | null;
};

export async function insertSource(input: InsertSourceInput): Promise<string | null> {
  const { rows } = await dbQuery<{ id: string }>(
    `INSERT INTO reels.sources (
        run_id, canonical_url, headline, body, author, byline, source_name,
        source_type, adapter_id, bucket, publish_time, language, engagement,
        media_urls, citation_urls, raw_payload, drop_reason
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::text[],$15::text[],$16::jsonb,$17)
     ON CONFLICT (canonical_url, adapter_id, run_id) DO NOTHING
     RETURNING id`,
    [
      input.runId,
      input.canonicalUrl,
      input.headline,
      input.body,
      input.author,
      input.byline,
      input.sourceName,
      input.sourceType,
      input.adapterId,
      input.bucket,
      input.publishTime?.toISOString() ?? null,
      input.language,
      JSON.stringify(input.engagement ?? {}),
      input.mediaUrls ?? [],
      input.citationUrls ?? [],
      input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload),
      input.dropReason,
    ],
  );
  return rows[0]?.id ?? null;
}

/**
 * A ranked item still on the list refreshes its signals only; the body is left
 * as first stored (D-032).
 */
export async function refreshEngagement(
  canonicalUrl: string,
  engagement: Engagement,
): Promise<boolean> {
  const { rowCount } = await dbQuery(
    `UPDATE reels.sources
        SET engagement = $2::jsonb
      WHERE id = (
        SELECT id FROM reels.sources
         WHERE canonical_url = $1
         ORDER BY ingest_time DESC
         LIMIT 1
      )`,
    [canonicalUrl, JSON.stringify(engagement)],
  );
  return (rowCount ?? 0) > 0;
}

export type PoolSource = {
  id: string;
  canonical_url: string;
  headline: string;
  body: string;
  source_name: string;
  source_type: SourceType;
  adapter_id: string;
  bucket: Bucket;
  publish_time: string | null;
  ingest_time: string;
  engagement: Engagement;
  drop_reason: DropReason | null;
  post_idea_id: string | null;
};

export async function listRunSources(runId: string): Promise<PoolSource[]> {
  const { rows } = await dbQuery<PoolSource>(
    `SELECT s.id, s.canonical_url, s.headline, s.body, s.source_name, s.source_type,
            s.adapter_id, s.bucket, s.publish_time, s.ingest_time, s.engagement,
            s.drop_reason, m.post_idea_id
       FROM reels.sources s
       LEFT JOIN reels.post_idea_members m ON m.source_id = s.id
      WHERE s.run_id = $1
      ORDER BY s.drop_reason NULLS FIRST, s.ingest_time DESC`,
    [runId],
  );
  return rows;
}

/**
 * Kept sources inside the reference window that no post idea holds yet.
 *
 * Scoped by time rather than by run so a night that died partway does not
 * strand its sources: the next run picks them up instead of leaving them
 * ungrouped forever.
 */
export async function listUngroupedSources(withinHours = REFERENCE_POOL_HOURS): Promise<PoolSource[]> {
  const { rows } = await dbQuery<PoolSource>(
    `SELECT s.id, s.canonical_url, s.headline, s.body, s.source_name, s.source_type,
            s.adapter_id, s.bucket, s.publish_time, s.ingest_time, s.engagement,
            s.drop_reason, NULL::uuid AS post_idea_id
       FROM reels.sources s
       LEFT JOIN reels.post_idea_members m ON m.source_id = s.id
      WHERE s.drop_reason IS NULL
        AND m.source_id IS NULL
        AND s.ingest_time > now() - ($1 || ' hours')::interval
      ORDER BY s.ingest_time`,
    [String(withinHours)],
  );
  return rows;
}

export async function listRecentSources(limit = 400): Promise<PoolSource[]> {
  const { rows } = await dbQuery<PoolSource>(
    `SELECT s.id, s.canonical_url, s.headline, s.body, s.source_name, s.source_type,
            s.adapter_id, s.bucket, s.publish_time, s.ingest_time, s.engagement,
            s.drop_reason, m.post_idea_id
       FROM reels.sources s
       LEFT JOIN reels.post_idea_members m ON m.source_id = s.id
      ORDER BY s.ingest_time DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/** Headlines the B6 generator must not repeat (D-064). */
export async function recentB6Headlines(nights: number): Promise<string[]> {
  const { rows } = await dbQuery<{ headline: string }>(
    `SELECT headline FROM reels.sources
      WHERE source_type = 'B6'
        AND ingest_time > now() - ($1 || ' days')::interval
      ORDER BY ingest_time DESC`,
    [String(nights)],
  );
  return rows.map((row) => row.headline);
}

// ── Candidate shortlist (GRP-01 / D-055) ─────────────────────────────────────

export type ShortlistCandidate = {
  source_id: string;
  canonical_url: string;
  headline: string;
  body: string;
  source_type: SourceType;
  source_name: string;
  publish_time: string | null;
  post_idea_id: string | null;
  similarity: number;
};

/**
 * Trigram neighbours drawn only from the 72-hour reference pool: post ideas
 * that took a source recently, plus sources still unattached. Postgres does the
 * narrowing so Jev only sees a handful of pairs per new item.
 *
 * Scored on the better of `similarity` and `word_similarity` in both
 * directions. Plain `similarity` is length-sensitive, which is the wrong shape
 * for this data: a wire headline and an outlet's longer version of the same
 * story score low on it ("Claude Opus 5.5" against "Anthropic releases Opus 5.5
 * with lower prices and Fable-level performance" scores 0.095, under any useful
 * floor, while word_similarity scores it 0.50). Measured on the first real
 * night, that miss was real and 96% of the pairs that did reach Jev came back
 * as obvious noes.
 */
const HEADLINE_SIMILARITY = `greatest(
  similarity(s.headline, $2),
  word_similarity(s.headline, $2),
  word_similarity($2, s.headline)
)`;

export async function shortlistCandidates(
  sourceId: string,
  headline: string,
  limit = SHORTLIST_LIMIT,
  floor = SHORTLIST_SIMILARITY_FLOOR,
): Promise<ShortlistCandidate[]> {
  const { rows } = await dbQuery<ShortlistCandidate>(
    `SELECT s.id AS source_id, s.canonical_url, s.headline, s.body, s.source_type,
            s.source_name, s.publish_time, m.post_idea_id,
            ${HEADLINE_SIMILARITY} AS similarity
       FROM reels.sources s
       LEFT JOIN reels.post_idea_members m ON m.source_id = s.id
       LEFT JOIN reels.post_ideas i ON i.id = m.post_idea_id
      WHERE s.id <> $1
        AND s.drop_reason IS NULL
        AND s.ingest_time > now() - ($3 || ' hours')::interval
        AND (m.post_idea_id IS NULL OR i.last_joined > now() - ($3 || ' hours')::interval)
        AND ${HEADLINE_SIMILARITY} > $5
      ORDER BY similarity DESC
      LIMIT $4`,
    [sourceId, headline, String(REFERENCE_POOL_HOURS), limit, floor],
  );
  return rows;
}

/** Exact canonical-URL match inside the reference pool is an automatic merge. */
export async function findUrlTwin(
  sourceId: string,
  canonicalUrl: string,
): Promise<ShortlistCandidate | null> {
  const { rows } = await dbQuery<ShortlistCandidate>(
    `SELECT s.id AS source_id, s.canonical_url, s.headline, s.body, s.source_type,
            s.source_name, s.publish_time, m.post_idea_id, 1.0 AS similarity
       FROM reels.sources s
       LEFT JOIN reels.post_idea_members m ON m.source_id = s.id
      WHERE s.id <> $1
        AND s.canonical_url = $2
        AND s.drop_reason IS NULL
        AND s.ingest_time > now() - ($3 || ' hours')::interval
      ORDER BY s.ingest_time DESC
      LIMIT 1`,
    [sourceId, canonicalUrl, String(REFERENCE_POOL_HOURS)],
  );
  return rows[0] ?? null;
}

// ── Post ideas ───────────────────────────────────────────────────────────────

async function snapshot(
  client: PoolClient,
  postIdeaId: string,
  reason: string,
  runId: string | null,
): Promise<void> {
  await client.query(
    `WITH bumped AS (
        UPDATE reels.post_ideas
           SET version_n = version_n + 1, updated_at = now()
         WHERE id = $1
        RETURNING version_n
     ), members AS (
        SELECT COALESCE(
                 jsonb_agg(jsonb_build_object(
                   'source_id', m.source_id,
                   'role', m.role,
                   'canonical_url', s.canonical_url,
                   'headline', s.headline,
                   'joined_at', m.joined_at
                 ) ORDER BY m.joined_at),
                 '[]'::jsonb
               ) AS payload
          FROM reels.post_idea_members m
          JOIN reels.sources s ON s.id = m.source_id
         WHERE m.post_idea_id = $1
     )
     INSERT INTO reels.post_idea_versions (post_idea_id, version_n, reason, members, run_id)
     SELECT $1, bumped.version_n, $2, members.payload, $3 FROM bumped, members`,
    [postIdeaId, reason, runId],
  );
}

export async function createPostIdea(
  sourceId: string,
  runId: string | null,
  reason: string,
): Promise<string> {
  return dbTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO reels.post_ideas DEFAULT VALUES RETURNING id`,
    );
    const postIdeaId = rows[0].id;
    await client.query(
      `INSERT INTO reels.post_idea_members (source_id, post_idea_id, role)
       VALUES ($1, $2, 'primary')
       ON CONFLICT (source_id) DO NOTHING`,
      [sourceId, postIdeaId],
    );
    await snapshot(client, postIdeaId, reason, runId);
    return postIdeaId;
  });
}

export async function addMember(
  postIdeaId: string,
  sourceId: string,
  role: MemberRole,
  runId: string | null,
  reason: string,
): Promise<void> {
  await dbTransaction(async (client) => {
    await client.query(
      `INSERT INTO reels.post_idea_members (source_id, post_idea_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_id) DO NOTHING`,
      [sourceId, postIdeaId, role],
    );
    await client.query(
      `UPDATE reels.post_ideas SET last_joined = now(), timely = true WHERE id = $1`,
      [postIdeaId],
    );
    await snapshot(client, postIdeaId, reason, runId);
  });
}

/**
 * Undo a grouping by hand (GRP-05 / D-058). The source leaves the idea, gets an
 * idea of its own, and a sticky `leave` is recorded against every member it was
 * grouped with so the next run does not put it back.
 */
export async function detachMember(
  postIdeaId: string,
  sourceId: string,
): Promise<{ newPostIdeaId: string } | null> {
  const { rows: members } = await dbQuery<{ canonical_url: string }>(
    `SELECT s.canonical_url
       FROM reels.post_idea_members m
       JOIN reels.sources s ON s.id = m.source_id
      WHERE m.post_idea_id = $1 AND m.source_id <> $2`,
    [postIdeaId, sourceId],
  );

  const { rows: subject } = await dbQuery<{ canonical_url: string }>(
    `SELECT canonical_url FROM reels.sources WHERE id = $1`,
    [sourceId],
  );
  if (subject.length === 0) return null;

  await dbTransaction(async (client) => {
    await client.query(
      `DELETE FROM reels.post_idea_members WHERE post_idea_id = $1 AND source_id = $2`,
      [postIdeaId, sourceId],
    );
    await snapshot(client, postIdeaId, 'override: detached by reviewer', null);
  });

  for (const member of members) {
    await recordDecision({
      a: subject[0].canonical_url,
      b: member.canonical_url,
      action: 'leave',
      sameEventP: null,
      confidence: null,
      runId: null,
      override: true,
    });
  }

  const newPostIdeaId = await createPostIdea(sourceId, null, 'override: split out by reviewer');
  return { newPostIdeaId };
}

export type IdeaMergeCandidate = {
  left_id: string;
  right_id: string;
  similarity: number;
};

/**
 * Idea pairs worth asking about (D-071). Code does the proposing: two ideas in
 * the reference pool whose members include a similar-enough headline pair.
 * Jev decides whether they are actually one event.
 */
export async function shortlistIdeaMerges(
  limit = IDEA_MERGE_MAX_PAIRS,
  floor = IDEA_MERGE_SIMILARITY_FLOOR,
): Promise<IdeaMergeCandidate[]> {
  const { rows } = await dbQuery<IdeaMergeCandidate>(
    `WITH pool AS (
        SELECT m.post_idea_id, s.headline
          FROM reels.post_idea_members m
          JOIN reels.sources s ON s.id = m.source_id
          JOIN reels.post_ideas i ON i.id = m.post_idea_id
         WHERE s.drop_reason IS NULL
           AND i.last_joined > now() - ($3 || ' hours')::interval
     )
     SELECT a.post_idea_id AS left_id,
            b.post_idea_id AS right_id,
            max(greatest(
              similarity(a.headline, b.headline),
              word_similarity(a.headline, b.headline),
              word_similarity(b.headline, a.headline)
            )) AS similarity
       FROM pool a
       JOIN pool b ON a.post_idea_id < b.post_idea_id
      GROUP BY a.post_idea_id, b.post_idea_id
     HAVING max(greatest(
              similarity(a.headline, b.headline),
              word_similarity(a.headline, b.headline),
              word_similarity(b.headline, a.headline)
            )) > $2
      ORDER BY similarity DESC
      LIMIT $1`,
    [limit, floor, String(REFERENCE_POOL_HOURS)],
  );
  return rows;
}

export type IdeaSummary = {
  id: string;
  primary_url: string | null;
  member_count: number;
  headlines: string[];
  excerpt: string | null;
};

export async function summarizeIdea(postIdeaId: string): Promise<IdeaSummary | null> {
  const { rows } = await dbQuery<IdeaSummary>(
    `SELECT i.id,
            (SELECT s.canonical_url
               FROM reels.post_idea_members m
               JOIN reels.sources s ON s.id = m.source_id
              WHERE m.post_idea_id = i.id
              ORDER BY CASE m.role WHEN 'primary' THEN 0 ELSE 1 END, m.joined_at
              LIMIT 1) AS primary_url,
            (SELECT count(*)::int FROM reels.post_idea_members m WHERE m.post_idea_id = i.id) AS member_count,
            COALESCE((SELECT array_agg(s.headline ORDER BY m.joined_at)
                        FROM reels.post_idea_members m
                        JOIN reels.sources s ON s.id = m.source_id
                       WHERE m.post_idea_id = i.id), ARRAY[]::text[]) AS headlines,
            (SELECT s.body
               FROM reels.post_idea_members m
               JOIN reels.sources s ON s.id = m.source_id
              WHERE m.post_idea_id = i.id
              ORDER BY CASE m.role WHEN 'primary' THEN 0 ELSE 1 END, m.joined_at
              LIMIT 1) AS excerpt
       FROM reels.post_ideas i
      WHERE i.id = $1`,
    [postIdeaId],
  );
  return rows[0] ?? null;
}

/**
 * Fuse `sourceIdeaId` into `targetIdeaId`. The absorbed idea's primary becomes
 * a supporting member, since the target already has one, and anything past the
 * size cap folds into the primary as a duplicate rather than adding a further
 * distinct angle (GRP-06 / D-058).
 */
export async function mergeIdeas(
  targetIdeaId: string,
  sourceIdeaId: string,
  runId: string | null,
  reason: string,
): Promise<number> {
  return dbTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE reels.post_idea_members
          SET post_idea_id = $1,
              role = CASE WHEN role = 'primary' THEN 'supporting' ELSE role END
        WHERE post_idea_id = $2`,
      [targetIdeaId, sourceIdeaId],
    );

    await client.query(
      `WITH ranked AS (
         SELECT source_id,
                row_number() OVER (ORDER BY joined_at) AS position
           FROM reels.post_idea_members
          WHERE post_idea_id = $1 AND role <> 'merged_duplicate'
       )
       UPDATE reels.post_idea_members m
          SET role = 'merged_duplicate'
         FROM ranked
        WHERE m.source_id = ranked.source_id
          AND ranked.position > $2`,
      [targetIdeaId, GROUP_SIZE_CAP],
    );

    await client.query(
      `UPDATE reels.post_ideas
          SET last_joined = greatest(
                last_joined,
                (SELECT last_joined FROM reels.post_ideas WHERE id = $2)
              ),
              first_seen = least(
                first_seen,
                (SELECT first_seen FROM reels.post_ideas WHERE id = $2)
              ),
              timely = true
        WHERE id = $1`,
      [targetIdeaId, sourceIdeaId],
    );

    await snapshot(client, targetIdeaId, reason, runId);
    // The absorbed idea is now empty. Published rows are keyed separately and
    // survive on purpose (D-045, D-061).
    await client.query(`DELETE FROM reels.post_ideas WHERE id = $1`, [sourceIdeaId]);

    return rowCount ?? 0;
  });
}

export async function countMembers(postIdeaId: string): Promise<number> {
  const { rows } = await dbQuery<{ count: string }>(
    `SELECT count(*)::text AS count FROM reels.post_idea_members WHERE post_idea_id = $1`,
    [postIdeaId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Build 2 scores what this run touched; everything else goes cold (D-059).
 * Keyed on when a source last joined rather than on run_id, so an idea that
 * took an orphaned source from a failed night still counts as timely.
 */
export async function resetTimelyFlags(runStartedAt: Date): Promise<void> {
  await dbQuery(
    `UPDATE reels.post_ideas SET timely = (last_joined >= $1)`,
    [runStartedAt.toISOString()],
  );
}

export type PostIdeaView = {
  id: string;
  first_seen: string;
  last_joined: string;
  timely: boolean;
  version_n: number;
  published: boolean;
  published_at: string | null;
  members: Array<{
    source_id: string;
    role: MemberRole;
    headline: string;
    canonical_url: string;
    source_name: string;
    source_type: SourceType;
    joined_at: string;
  }>;
  decisions: Array<{
    left_url: string;
    right_url: string;
    action: GroupingAction;
    same_event_p: number | null;
    confidence: number | null;
    override: boolean;
  }>;
  flags: Array<{ kind: ReviewFlagKind; created_at: string }>;
};

export async function listPostIdeas(limit = 120): Promise<PostIdeaView[]> {
  const { rows } = await dbQuery<PostIdeaView>(
    `SELECT i.id, i.first_seen, i.last_joined, i.timely, i.version_n,
            COALESCE(p.published, false) AS published,
            p.published_at,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'source_id', m.source_id,
                       'role', m.role,
                       'headline', s.headline,
                       'canonical_url', s.canonical_url,
                       'source_name', s.source_name,
                       'source_type', s.source_type,
                       'joined_at', m.joined_at
                     ) ORDER BY
                       CASE m.role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END,
                       m.joined_at)
                FROM reels.post_idea_members m
                JOIN reels.sources s ON s.id = m.source_id
               WHERE m.post_idea_id = i.id
            ), '[]'::jsonb) AS members,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'left_url', d.left_url,
                       'right_url', d.right_url,
                       'action', d.action,
                       'same_event_p', d.same_event_p,
                       'confidence', d.confidence,
                       'override', d.override
                     ) ORDER BY d.decided_at)
                FROM reels.grouping_decisions d
               WHERE d.action <> 'leave'
                 AND d.right_url IN (
                       SELECT s2.canonical_url
                         FROM reels.post_idea_members m2
                         JOIN reels.sources s2 ON s2.id = m2.source_id
                        WHERE m2.post_idea_id = i.id
                     )
            ), '[]'::jsonb) AS decisions,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object('kind', f.kind, 'created_at', f.created_at)
                     ORDER BY f.created_at DESC)
                FROM reels.review_flags f
               WHERE f.post_idea_id = i.id
            ), '[]'::jsonb) AS flags
       FROM reels.post_ideas i
       LEFT JOIN reels.published_status p ON p.post_idea_id = i.id
      ORDER BY i.last_joined DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

// ── Grouping decisions (sticky; GRP-07 / D-058) ──────────────────────────────

export type DecisionRow = {
  left_url: string;
  right_url: string;
  action: GroupingAction;
  same_event_p: number | null;
  confidence: number | null;
  override: boolean;
};

function orderPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

export async function findDecision(a: string, b: string): Promise<DecisionRow | null> {
  const [left, right] = orderPair(a, b);
  const { rows } = await dbQuery<DecisionRow>(
    `SELECT left_url, right_url, action, same_event_p, confidence, override
       FROM reels.grouping_decisions
      WHERE left_url = $1 AND right_url = $2`,
    [left, right],
  );
  return rows[0] ?? null;
}

export async function recordDecision(input: {
  a: string;
  b: string;
  action: GroupingAction;
  sameEventP: number | null;
  confidence: number | null;
  runId: string | null;
  override?: boolean;
}): Promise<void> {
  const [left, right] = orderPair(input.a, input.b);
  await dbQuery(
    `INSERT INTO reels.grouping_decisions
       (left_url, right_url, action, same_event_p, confidence, run_id, override)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (left_url, right_url) DO UPDATE
        SET action = EXCLUDED.action,
            same_event_p = EXCLUDED.same_event_p,
            confidence = EXCLUDED.confidence,
            run_id = EXCLUDED.run_id,
            override = EXCLUDED.override,
            decided_at = now()
      -- A reviewer's override outranks the model and is never silently
      -- replaced by a later run (GRP-05 / D-058).
      WHERE reels.grouping_decisions.override = false OR EXCLUDED.override = true`,
    [
      left,
      right,
      input.action,
      input.sameEventP,
      input.confidence,
      input.runId,
      input.override ?? false,
    ],
  );
}

// ── Jev logs and spend ───────────────────────────────────────────────────────

export async function insertJevLog(input: {
  runId: string | null;
  component: string;
  questionSetId: string;
  questionSetVersion: string;
  resolvedModel: string | null;
  state: unknown;
  answers: unknown;
  inputTokens: number;
  sourceId?: string | null;
  postIdeaId?: string | null;
}): Promise<void> {
  await dbQuery(
    `INSERT INTO reels.jev_logs (
        run_id, component, question_set_id, question_set_version, resolved_model,
        state, answers, input_tokens, source_id, post_idea_id
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)`,
    [
      input.runId,
      input.component,
      input.questionSetId,
      input.questionSetVersion,
      input.resolvedModel,
      JSON.stringify(input.state),
      JSON.stringify(input.answers),
      input.inputTokens,
      input.sourceId ?? null,
      input.postIdeaId ?? null,
    ],
  );
}

export async function recordCost(input: {
  runId: string | null;
  vendor: 'jev' | 'anthropic' | 'openai';
  component: string;
  inputTokens: number;
  outputTokens?: number;
  usd: number;
}): Promise<void> {
  await dbQuery(
    `INSERT INTO reels.cost_events (run_id, vendor, component, input_tokens, output_tokens, usd)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.runId,
      input.vendor,
      input.component,
      input.inputTokens,
      input.outputTokens ?? 0,
      input.usd,
    ],
  );
}

export async function monthToDateUsd(now = new Date()): Promise<number> {
  const { rows } = await dbQuery<{ total: string | null }>(
    `SELECT COALESCE(sum(usd), 0)::text AS total
       FROM reels.cost_events
      WHERE created_at >= $1`,
    [monthStart(now).toISOString()],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function runCostUsd(runId: string): Promise<number> {
  const { rows } = await dbQuery<{ total: string | null }>(
    `SELECT COALESCE(sum(usd), 0)::text AS total FROM reels.cost_events WHERE run_id = $1`,
    [runId],
  );
  return Number(rows[0]?.total ?? 0);
}

// ── Review flags ─────────────────────────────────────────────────────────────

export async function addReviewFlag(input: {
  kind: ReviewFlagKind;
  postIdeaId?: string | null;
  sourceId?: string | null;
  note?: string | null;
  createdBy: string;
}): Promise<void> {
  await dbQuery(
    `INSERT INTO reels.review_flags (kind, post_idea_id, source_id, source_url, note, created_by)
     VALUES (
       $1, $2, $3,
       (SELECT canonical_url FROM reels.sources WHERE id = $3),
       $4, $5
     )`,
    [input.kind, input.postIdeaId ?? null, input.sourceId ?? null, input.note ?? null, input.createdBy],
  );
}

// ── Published status (D-061) ─────────────────────────────────────────────────

export async function setPublished(postIdeaId: string, published: boolean): Promise<void> {
  await dbQuery(
    `INSERT INTO reels.published_status (post_idea_id, published, published_at, last_updated)
     VALUES ($1, $2, CASE WHEN $2 THEN now() ELSE NULL END, now())
     ON CONFLICT (post_idea_id) DO UPDATE
        SET published = EXCLUDED.published,
            published_at = CASE WHEN EXCLUDED.published
                                THEN COALESCE(reels.published_status.published_at, now())
                                ELSE NULL END,
            last_updated = now()`,
    [postIdeaId, published],
  );
}

// ── A4 catalog (D-066) ───────────────────────────────────────────────────────

export type CatalogEntry = {
  id: string;
  list_id: string;
  entry_name: string;
  entry_url: string;
  repo_full_name: string | null;
  description: string | null;
  last_ingested: string | null;
  last_considered: string | null;
};

export async function upsertCatalogEntries(
  entries: Array<{
    listId: string;
    name: string;
    url: string;
    repoFullName: string | null;
    description: string | null;
  }>,
): Promise<void> {
  if (entries.length === 0) return;
  await dbQuery(
    `INSERT INTO reels.list_catalog (list_id, entry_name, entry_url, repo_full_name, description)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
     ON CONFLICT (list_id, entry_url) DO UPDATE
        SET entry_name = EXCLUDED.entry_name,
            repo_full_name = COALESCE(EXCLUDED.repo_full_name, reels.list_catalog.repo_full_name),
            description = COALESCE(EXCLUDED.description, reels.list_catalog.description)`,
    [
      entries.map((entry) => entry.listId),
      entries.map((entry) => entry.name),
      entries.map((entry) => entry.url),
      entries.map((entry) => entry.repoFullName),
      entries.map((entry) => entry.description),
    ],
  );
}

/**
 * The `_lists` partition holds awesome-lists discovered through the list of
 * lists, not tools, so it never reaches the editor's shortlist.
 */
function toolsOnly(alias: string): string {
  return `${alias}.list_id <> '_lists' AND ${alias}.repo_full_name IS NOT NULL`;
}

/**
 * Rotation half of the A4 shortlist: entries we have not looked at in a while
 * and have not ingested inside the fingerprint window.
 */
export async function catalogRotation(limit: number, repeatDays: number): Promise<CatalogEntry[]> {
  const { rows } = await dbQuery<CatalogEntry>(
    `SELECT c.* FROM reels.list_catalog c
      WHERE ${toolsOnly('c')}
        AND (c.last_ingested IS NULL OR c.last_ingested < now() - ($2 || ' days')::interval)
      ORDER BY c.last_considered NULLS FIRST, random()
      LIMIT $1`,
    [limit, String(repeatDays)],
  );
  return rows;
}

/** Discovered lists due for expansion, oldest look first. */
export async function discoveredListsDue(limit: number): Promise<CatalogEntry[]> {
  const { rows } = await dbQuery<CatalogEntry>(
    `SELECT * FROM reels.list_catalog
      WHERE list_id = '_lists'
        AND repo_full_name IS NOT NULL
      ORDER BY last_considered NULLS FIRST
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/** News-peg half: catalog entries named in tonight's other headlines. */
export async function catalogMatchingHeadlines(
  runId: string,
  limit: number,
): Promise<CatalogEntry[]> {
  const { rows } = await dbQuery<CatalogEntry>(
    `SELECT DISTINCT c.*
       FROM reels.list_catalog c
       JOIN reels.sources s
         ON s.run_id = $1
        AND s.drop_reason IS NULL
        AND s.source_type <> 'A4'
        AND length(c.entry_name) >= 4
        AND s.headline ILIKE '%' || c.entry_name || '%'
      WHERE ${toolsOnly('c')}
      LIMIT $2`,
    [runId, limit],
  );
  return rows;
}

export async function markCatalogConsidered(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await dbQuery(
    `UPDATE reels.list_catalog SET last_considered = now() WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

export async function markCatalogIngested(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await dbQuery(
    `UPDATE reels.list_catalog SET last_ingested = now(), last_considered = now()
      WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

// ── Retention (RET / D-044, D-045, D-046) ────────────────────────────────────

export type RetentionResult = {
  sourcesDeleted: number;
  ideasDeleted: number;
  jevLogsDeleted: number;
};

export async function runRetention(retentionDays = RETENTION_DAYS): Promise<RetentionResult> {
  // Fingerprints are written at ingest and never deleted here, so a URL that
  // ages out cannot be re-ingested as new.
  const sources = await dbQuery(
    `DELETE FROM reels.sources
      WHERE ingest_time < now() - ($1 || ' days')::interval`,
    [String(retentionDays)],
  );

  // Members cascade with their sources, so an idea can be left with none.
  // Published ideas keep their row (D-045) even once empty.
  const ideas = await dbQuery(
    `DELETE FROM reels.post_ideas i
      WHERE NOT EXISTS (SELECT 1 FROM reels.post_idea_members m WHERE m.post_idea_id = i.id)
        AND NOT EXISTS (
              SELECT 1 FROM reels.published_status p
               WHERE p.post_idea_id = i.id AND p.published
            )`,
  );

  // Logs outlive the idea by the retention window (D-030).
  const logs = await dbQuery(
    `DELETE FROM reels.jev_logs
      WHERE expires_at < now()
        AND (post_idea_id IS NULL
             OR NOT EXISTS (SELECT 1 FROM reels.post_ideas i WHERE i.id = jev_logs.post_idea_id))`,
  );

  return {
    sourcesDeleted: sources.rowCount ?? 0,
    ideasDeleted: ideas.rowCount ?? 0,
    jevLogsDeleted: logs.rowCount ?? 0,
  };
}

/** Keep a live idea's logs alive while the idea itself is alive. */
export async function extendLogRetention(): Promise<void> {
  await dbQuery(
    `UPDATE reels.jev_logs l
        SET expires_at = now() + ($1 || ' days')::interval
      WHERE l.post_idea_id IS NOT NULL
        AND l.expires_at < now() + interval '1 day'
        AND EXISTS (SELECT 1 FROM reels.post_ideas i WHERE i.id = l.post_idea_id)`,
    [String(RETENTION_DAYS)],
  );
}
