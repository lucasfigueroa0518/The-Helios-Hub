/**
 * Helios Social: Postgres storage (spec docs/superpowers/specs/2026-10-08-social-storage.md).
 *
 * The same interfaces the pipeline already uses (UsedPhotoLog, PostedStories,
 * SetAsideLog, FeedHealthLog), backed by the `social` schema
 * (db/social_schema.sql), plus run and post records and the reads other
 * systems use. Every function takes a `query` function, so tests pass a fake
 * and no database is touched; the runtime passes `dbQuery` from lib/db.ts.
 */
import type { FeedHealthEntry, FeedHealthLog } from '@/lib/social/ingest/select/feed-health';
import { POSTED_LOOKBACK_DAYS, type PostedRecord, type PostedStories } from '@/lib/social/ingest/select/posted';
import { NO_REPEAT_DAYS, type UsedPhoto, type UsedPhotoLog } from '@/lib/social/photos/used-photos';
import { dayKey, type SetAsideEntry, type SetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { REASON_KIND } from '@/lib/social/pipeline/types';
import type { Post as RenderPost } from '@/lib/social/render/types';

export type Query = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type PostStatus = 'preview' | 'review' | 'published' | 'rejected';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

// ── The pipeline's logs ────────────────────────────────────────────────────

export function createPgUsedPhotoLog(query: Query): UsedPhotoLog {
  return {
    async recent(now) {
      const { rows } = await query(
        `SELECT DISTINCT url FROM social.used_photos WHERE used_at <= $1 AND used_at > $1::timestamptz - make_interval(days => $2)`,
        [now.toISOString(), NO_REPEAT_DAYS],
      );
      return new Set(rows.map((r) => r.url as string));
    },
    async lastUsed() {
      const { rows } = await query(`SELECT url, max(used_at) AS used_at FROM social.used_photos GROUP BY url`);
      return new Map(rows.map((r) => [r.url as string, iso(r.used_at)]));
    },
    async record(entries) {
      for (const e of entries) await insertUsedPhoto(query, e);
    },
  };
}

export async function insertUsedPhoto(query: Query, e: UsedPhoto, postId: string | null = null): Promise<void> {
  await query(
    `INSERT INTO social.used_photos (url, used_at, story_id, slide, source, qid, subject, credit, scene, post_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (url, used_at, story_id, slide) DO NOTHING`,
    [e.url, e.usedAt, e.storyId, e.slide, e.source ?? null, e.qid ?? null, e.subject ?? null, e.credit ?? null, e.scene ?? null, postId],
  );
}

export function createPgPosted(query: Query): PostedStories {
  return {
    async recentHeadlines(now) {
      const { rows } = await query(
        `SELECT headline FROM social.posted_stories WHERE posted_at <= $1 AND posted_at >= $1::timestamptz - make_interval(days => $2) ORDER BY posted_at`,
        [now.toISOString(), POSTED_LOOKBACK_DAYS],
      );
      return rows.map((r) => r.headline as string);
    },
  };
}

export async function insertPosted(query: Query, r: PostedRecord & { storyId?: string | null; postId?: string | null }): Promise<void> {
  await query(
    `INSERT INTO social.posted_stories (headline, posted_at, story_id, post_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (headline, posted_at) DO NOTHING`,
    [r.headline, r.postedAt, r.storyId ?? null, r.postId ?? null],
  );
}

export function createPgSetAsideLog(query: Query): SetAsideLog {
  return {
    async record(input, now) {
      const entry: SetAsideEntry = {
        day: dayKey(now),
        storyId: input.storyId,
        stage: input.stage,
        reasonCode: input.reasonCode,
        kind: REASON_KIND[input.reasonCode],
        detail: input.detail,
        at: now.toISOString(),
      };
      await insertSetAside(query, entry);
      return entry;
    },
    async forDay(now) {
      const { rows } = await query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, story_id, stage, reason_code, kind, detail, at FROM social.set_asides WHERE day = $1 ORDER BY at, id`,
        [dayKey(now)],
      );
      return rows.map((r) => ({ day: r.day, storyId: r.story_id, stage: r.stage, reasonCode: r.reason_code, kind: r.kind, detail: r.detail, at: iso(r.at) }));
    },
  };
}

export async function insertSetAside(query: Query, e: SetAsideEntry): Promise<void> {
  await query(
    `INSERT INTO social.set_asides (day, story_id, stage, reason_code, kind, detail, at) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (story_id, stage, reason_code, at) DO NOTHING`,
    [e.day, e.storyId, e.stage, e.reasonCode, e.kind, e.detail, e.at],
  );
}

export function createPgFeedHealthLog(query: Query): FeedHealthLog {
  return {
    async append(entries) {
      for (const e of entries) await insertFeedHealth(query, e);
    },
  };
}

export async function insertFeedHealth(query: Query, e: FeedHealthEntry): Promise<void> {
  await query(
    `INSERT INTO social.feed_health (day, slug, name, fetched, in_window, flagged) VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.day, e.slug, e.name, e.fetched, e.inWindow, e.flagged],
  );
}

// ── Runs and posts ─────────────────────────────────────────────────────────

export type RunInsert = {
  kind: 'daily' | 'preview';
  startedAt: string;
  finishedAt: string;
  hookPass: boolean;
  capUsd: number;
  claudeUsd: number;
  totalUsd: number;
  stopReason: string | null;
  runDir: string | null;
  machine: string | null;
  record: unknown;
};

export async function insertRun(query: Query, r: RunInsert): Promise<string> {
  const { rows } = await query(
    `INSERT INTO social.runs (kind, started_at, finished_at, hook_pass, cap_usd, claude_usd, total_usd, stop_reason, run_dir, machine, record)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) RETURNING id`,
    [r.kind, r.startedAt, r.finishedAt, r.hookPass, r.capUsd, r.claudeUsd, r.totalUsd, r.stopReason, r.runDir, r.machine, JSON.stringify(r.record)],
  );
  return rows[0].id as string;
}

/** The worker's queued run (lib/social/overnight/runs.ts), finished by the daily script. */
export async function finishRun(query: Query, id: string, r: Omit<RunInsert, 'kind' | 'startedAt' | 'capUsd'> & { status: 'ok' | 'partial' | 'failed' }): Promise<void> {
  const { rows } = await query(
    `UPDATE social.runs SET status = $2, finished_at = $3, hook_pass = $4, claude_usd = $5, total_usd = $6, stop_reason = $7, run_dir = $8, machine = $9, record = $10::jsonb
      WHERE id = $1 AND status = 'running'
      RETURNING id`,
    [id, r.status, r.finishedAt, r.hookPass, r.claudeUsd, r.totalUsd, r.stopReason, r.runDir, r.machine, JSON.stringify(r.record)],
  );
  if (!rows[0]) throw new Error(`Run ${id} was not running, so it was not finished.`);
}

export type PostInsert = {
  runId: string | null;
  slug: string;
  storyId: string | null;
  title: string;
  status: PostStatus;
  brief: unknown;
  draft: unknown;
  render: RenderPost;
  createdAt?: string;
  /** `dev` for hand-started runs and re-render scripts; the worker's runs are `pipeline`. Default `pipeline`. */
  origin?: 'pipeline' | 'dev';
};

/** Insert or replace a post by slug (a re-run of the same slug overwrites it). Returns its id. */
export async function upsertPost(query: Query, p: PostInsert): Promise<string> {
  const { rows } = await query(
    `INSERT INTO social.posts (run_id, slug, story_id, title, status, brief, draft, render, caption, created_at, origin)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, coalesce($10::timestamptz, now()), $11)
     ON CONFLICT (slug) DO UPDATE SET run_id = excluded.run_id, story_id = excluded.story_id, title = excluded.title,
       status = excluded.status, brief = excluded.brief, draft = excluded.draft, render = excluded.render, caption = excluded.caption,
       origin = excluded.origin
     RETURNING id`,
    [p.runId, p.slug, p.storyId, p.title, p.status, p.brief == null ? null : JSON.stringify(p.brief), p.draft == null ? null : JSON.stringify(p.draft), JSON.stringify(p.render), p.render.caption ?? null, p.createdAt ?? null, p.origin ?? 'pipeline'],
  );
  return rows[0].id as string;
}

/**
 * The finished post a story already has (SH-60): its newest pipeline post in
 * review with slides stored. The newest version is the current one (SH-54),
 * so when that one was rejected the story runs again; nothing older is used.
 * A post with any publish try that may have reached Instagram (anything but
 * a clean failure, D41) is never reused: a worker that died mid-publish
 * leaves the post in review, possibly already live.
 */
export async function storedPostFor(query: Query, storyId: string): Promise<string | null> {
  const { rows } = await query(
    `SELECT p.id, p.status, p.slide_objects IS NOT NULL AS has_slides, a.decision,
            EXISTS (SELECT 1 FROM social_hub.publish_attempts t
                     WHERE t.content_item_id = ci.id
                       AND (t.status <> 'failed' OR t.media_id IS NOT NULL OR t.error LIKE 'The worker stopped%')) AS tried
       FROM social.posts p
       LEFT JOIN social_hub.content_items ci ON ci.vertical = 'carousels' AND ci.native_ref = p.id::text
       LEFT JOIN social_hub.approvals a ON a.content_item_id = ci.id
      WHERE p.story_id = $1 AND p.origin = 'pipeline' AND p.status IN ('review', 'published', 'rejected')
      ORDER BY p.created_at DESC
      LIMIT 1`,
    [storyId],
  );
  const newest = rows[0];
  if (!newest || newest.status !== 'review' || !newest.has_slides || newest.decision === 'rejected' || newest.tried) return null;
  return newest.id as string;
}

/**
 * True when any post of this story already holds a carousel slot that is
 * waiting or posting (a person placed it, or an earlier run did). The night
 * passes such a story over (daily fill, D54): it is already on the calendar,
 * and a person's placement for today is counted in the day's quota.
 */
export async function storyOnCalendar(query: Query, storyId: string): Promise<boolean> {
  const { rows } = await query(
    `SELECT EXISTS (
       SELECT 1 FROM social.posts p
         JOIN social_hub.content_items ci ON ci.vertical = 'carousels' AND ci.native_ref = p.id::text
         JOIN social_hub.schedule s ON s.content_item_id = ci.id
        WHERE p.story_id = $1 AND s.status IN ('scheduled', 'publishing')) AS placed`,
    [storyId],
  );
  return rows[0]?.placed === true;
}

/** The run's ship list, post ids best-ranked first (social.runs.ship_post_ids). */
export async function recordShipList(query: Query, runId: string, postIds: string[]): Promise<void> {
  await query(`UPDATE social.runs SET ship_post_ids = $2::jsonb WHERE id = $1`, [runId, JSON.stringify(postIds)]);
}

// ── Reads (the preview pages and other systems) ────────────────────────────

export type PostSummary = { id: string; slug: string; storyId: string | null; title: string; status: PostStatus; createdAt: string; runId: string | null };

export async function getPostRender(query: Query, slug: string): Promise<RenderPost | null> {
  const { rows } = await query(`SELECT render FROM social.posts WHERE slug = $1`, [slug]);
  return (rows[0]?.render as RenderPost | undefined) ?? null;
}

export async function getPost(query: Query, slug: string): Promise<(PostSummary & { brief: unknown; draft: unknown; render: RenderPost }) | null> {
  const { rows } = await query(`SELECT id, slug, story_id, title, status, created_at, run_id, brief, draft, render FROM social.posts WHERE slug = $1`, [slug]);
  const r = rows[0];
  return r ? { ...toSummary(r), brief: r.brief, draft: r.draft, render: r.render } : null;
}

export async function listPosts(query: Query, opts: { since?: Date; status?: PostStatus; limit?: number } = {}): Promise<PostSummary[]> {
  const { rows } = await query(
    `SELECT id, slug, story_id, title, status, created_at, run_id FROM social.posts
     WHERE ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::text IS NULL OR status = $2)
     ORDER BY created_at DESC LIMIT $3`,
    [opts.since?.toISOString() ?? null, opts.status ?? null, opts.limit ?? 100],
  );
  return rows.map(toSummary);
}

export async function listUsedPhotos(query: Query, opts: { days?: number; now?: Date } = {}): Promise<UsedPhoto[]> {
  const { rows } = await query(
    `SELECT url, used_at, story_id, slide, source, qid, subject, credit, scene FROM social.used_photos
     WHERE used_at > $1::timestamptz - make_interval(days => $2) ORDER BY used_at DESC`,
    [(opts.now ?? new Date()).toISOString(), opts.days ?? NO_REPEAT_DAYS],
  );
  return rows.map((r) => ({
    url: r.url, usedAt: iso(r.used_at), storyId: r.story_id, slide: r.slide,
    ...(r.source ? { source: r.source } : {}), qid: r.qid, subject: r.subject, ...(r.credit ? { credit: r.credit } : {}), ...(r.scene ? { scene: r.scene } : {}),
  }));
}

function toSummary(r: any): PostSummary {
  return { id: r.id, slug: r.slug, storyId: r.story_id, title: r.title, status: r.status, createdAt: iso(r.created_at), runId: r.run_id };
}
