/**
 * Stories repository (plan §4). The app inserts and reads rows; the worker
 * claims and advances them. Every status change names the status it expects
 * and fails loudly when the row is elsewhere, so two workers (or a click and
 * a worker) can never both move a set.
 *
 *   requested → building → ready → approved → scheduled → publishing → published
 *                   ↘ failed / skipped     ↘ rejected            ↘ failed
 */
import type { Queryable, StoriesDb } from '@/lib/stories/db';
import type { Backdrop, FrameData, FrameRole, Photo, Series, Style } from '@/lib/stories/render/types';
import { projectSet } from '@/lib/stories/spine';

export type SetStatus = 'requested' | 'building' | 'ready' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'rejected' | 'failed' | 'skipped';

export type StorySet = {
  id: string;
  series: Series;
  ny_date: string;
  status: SetStatus;
  trigger: 'click' | 'auto';
  style: Style;
  payload: Record<string, unknown>;
  publish_at: string | null;
  flagged: boolean;
  error: string | null;
  spend_usd: number;
  created_at: string;
  updated_at: string;
};

export type FrameRow = {
  id: string;
  set_id: string;
  seq: number;
  role: FrameRole;
  template: string | null;
  backdrop: Backdrop;
  copy: FrameData;
  photo: Photo | null;
  storage_path: string | null;
  jpeg_bytes: number | null;
  review: Record<string, unknown> | null;
  flagged: boolean;
  ig_container_id: string | null;
  ig_media_id: string | null;
  published_at: string | null;
};

export type NewFrame = { seq: number; role: FrameRole; template?: string | null; backdrop: Backdrop; copy: FrameData; photo?: Photo | null };
export type NewCandidate = {
  origin: 'reels' | 'carousel' | 'catalog' | 'github' | 'generated';
  ref: string;
  payload?: Record<string, unknown>;
  jev?: Record<string, unknown> | null;
  score?: number | null;
  chosen?: boolean;
  reason?: string | null;
};

const SET_COLS = `id, series, to_char(ny_date, 'YYYY-MM-DD') AS ny_date, status, trigger, style, payload, publish_at, flagged, error,
  spend_usd::float8 AS spend_usd, created_at, updated_at`;
const FRAME_COLS = `id, set_id, seq, role, template, backdrop, copy, photo, storage_path, jpeg_bytes, review, flagged,
  ig_container_id, ig_media_id, published_at`;

/** The New York calendar date of an instant (posting windows are New York time, S-20). */
export function nyDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export class StaleStatusError extends Error {
  constructor(setId: string, expected: SetStatus[], to: SetStatus) {
    super(`set ${setId} is not ${expected.join(' or ')}; cannot move it to ${to}`);
    this.name = 'StaleStatusError';
  }
}

async function move(db: Queryable, setId: string, from: SetStatus[], to: SetStatus, extra = '', params: unknown[] = []): Promise<StorySet> {
  const { rows } = await db.query<StorySet>(
    `UPDATE stories.sets SET status = $2, updated_at = now()${extra ? `, ${extra}` : ''}
      WHERE id = $1 AND status = ANY($3::text[]) RETURNING ${SET_COLS}`,
    [setId, to, from, ...params],
  );
  if (!rows[0]) throw new StaleStatusError(setId, from, to);
  // Every transition re-projects the set onto the lifecycle spine (D44), in the same transaction when there is one.
  await projectSet(db, setId);
  return rows[0];
}

/** Re-project a frame's set after a frame or capture changes (D44). */
async function projectFrameSet(db: Queryable, frameId: string): Promise<void> {
  const { rows } = await db.query<{ set_id: string }>(`SELECT set_id::text AS set_id FROM stories.frames WHERE id = $1`, [frameId]);
  if (rows[0]) await projectSet(db, rows[0].set_id);
}

/* ── Sets ─────────────────────────────────────────────────────────── */

/**
 * Ask for a set (Generate, or the scheduler for an auto series). One live set
 * per series per day: a second request returns the existing one, `created: false`.
 */
export async function requestSet(
  db: Queryable,
  input: { series: Series; nyDate: string; trigger: 'click' | 'auto'; style: Style; requestedBy?: string },
): Promise<{ set: StorySet; created: boolean }> {
  const { rows } = await db.query<StorySet>(
    `INSERT INTO stories.sets (series, ny_date, trigger, style, requested_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (series, ny_date) WHERE status NOT IN ('rejected', 'failed', 'skipped') DO NOTHING
     RETURNING ${SET_COLS}`,
    [input.series, input.nyDate, input.trigger, input.style, input.requestedBy ?? null],
  );
  if (rows[0]) return { set: rows[0], created: true };
  const existing = await db.query<StorySet>(
    `SELECT ${SET_COLS} FROM stories.sets WHERE series = $1 AND ny_date = $2 AND status NOT IN ('rejected', 'failed', 'skipped')`,
    [input.series, input.nyDate],
  );
  return { set: existing.rows[0]!, created: false };
}

/** The worker takes the oldest requested set (skipping any another worker holds). */
export async function claimNextRequested(db: StoriesDb): Promise<StorySet | null> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM stories.sets WHERE status = 'requested' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!rows[0]) return null;
    return move(tx, rows[0].id, ['requested'], 'building', 'claimed_at = now()');
  });
}

/** A build that died mid-way stays `building` and blocks the day. Hand it back so the next pass tries again. */
export async function releaseStaleBuilds(db: StoriesDb, olderThanMinutes = 45): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE stories.sets
        SET status = 'requested', error = 'the previous build stopped before it finished; trying again', updated_at = now()
      WHERE status = 'building' AND claimed_at < now() - ($1::int * interval '1 minute')
      RETURNING id`,
    [olderThanMinutes],
  );
  return rows.map((r) => r.id);
}

export async function getSet(db: Queryable, setId: string): Promise<{ set: StorySet; frames: FrameRow[] } | null> {
  const { rows } = await db.query<StorySet>(`SELECT ${SET_COLS} FROM stories.sets WHERE id = $1`, [setId]);
  if (!rows[0]) return null;
  const frames = await db.query<FrameRow>(`SELECT ${FRAME_COLS} FROM stories.frames WHERE set_id = $1 ORDER BY seq`, [setId]);
  return { set: rows[0], frames: frames.rows };
}

export async function listSets(db: Queryable, opts: { series?: Series; statuses?: SetStatus[]; since?: string; limit?: number } = {}): Promise<StorySet[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.series) where.push(`series = $${params.push(opts.series)}`);
  if (opts.statuses?.length) where.push(`status = ANY($${params.push(opts.statuses)}::text[])`);
  if (opts.since) where.push(`ny_date >= $${params.push(opts.since)}`);
  const { rows } = await db.query<StorySet>(
    `SELECT ${SET_COLS} FROM stories.sets ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ny_date DESC, created_at DESC LIMIT $${params.push(opts.limit ?? 50)}`,
    params,
  );
  return rows;
}

/** A finished build: its payload, frames and every candidate considered, in one transaction. */
export async function saveBuild(
  db: StoriesDb,
  setId: string,
  build: { payload: Record<string, unknown>; frames: NewFrame[]; candidates: NewCandidate[] },
): Promise<FrameRow[]> {
  if (!build.frames.length) throw new Error('a set needs at least one frame');
  return db.transaction(async (tx) => {
    const { rows: current } = await tx.query<{ status: SetStatus }>(`SELECT status FROM stories.sets WHERE id = $1 FOR UPDATE`, [setId]);
    if (current[0]?.status !== 'building') throw new StaleStatusError(setId, ['building'], 'building');
    await tx.query(`DELETE FROM stories.frames WHERE set_id = $1`, [setId]);
    await tx.query(`DELETE FROM stories.candidates WHERE set_id = $1`, [setId]);
    const frames: FrameRow[] = [];
    for (const f of build.frames) {
      const { rows } = await tx.query<FrameRow>(
        `INSERT INTO stories.frames (set_id, seq, role, template, backdrop, copy, photo)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING ${FRAME_COLS}`,
        [setId, f.seq, f.role, f.template ?? null, f.backdrop, JSON.stringify(f.copy), f.photo ? JSON.stringify(f.photo) : null],
      );
      frames.push(rows[0]!);
    }
    for (const c of build.candidates) {
      await tx.query(
        `INSERT INTO stories.candidates (set_id, origin, ref, payload, jev, score, chosen, reason)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)`,
        [setId, c.origin, c.ref, JSON.stringify(c.payload ?? {}), c.jev ? JSON.stringify(c.jev) : null, c.score ?? null, c.chosen ?? false, c.reason ?? null],
      );
    }
    await tx.query(`UPDATE stories.sets SET payload = $2::jsonb, updated_at = now() WHERE id = $1`, [setId, JSON.stringify(build.payload)]);
    return frames;
  });
}

/**
 * After render and review: the stored JPEG, the review's verdict, and the
 * frame as rendered. The review may move settings that live inside the frame
 * data (layout family, photo focus, whether the photo shows); the caller
 * checks the words are unchanged (render-stage.ts) before saving.
 */
export async function saveFrameRender(
  db: Queryable,
  frameId: string,
  r: { storagePath: string; jpegBytes: number; review?: Record<string, unknown> | null; flagged?: boolean; backdrop?: Backdrop; template?: string | null; copy?: FrameData; photo?: Photo | null },
): Promise<void> {
  await db.query(
    `UPDATE stories.frames SET storage_path = $2, jpeg_bytes = $3, review = $4::jsonb, flagged = $5,
            backdrop = COALESCE($6, backdrop), template = COALESCE($7, template), copy = COALESCE($8::jsonb, copy),
            photo = CASE WHEN $10 THEN $9::jsonb ELSE photo END
      WHERE id = $1`,
    [frameId, r.storagePath, r.jpegBytes, r.review ? JSON.stringify(r.review) : null, r.flagged ?? false, r.backdrop ?? null, r.template ?? null,
      r.copy ? JSON.stringify(r.copy) : null, r.photo ? JSON.stringify(r.photo) : null, r.photo !== undefined],
  );
}

export const markReady = (db: Queryable, setId: string, flagged: boolean) => move(db, setId, ['building'], 'ready', 'built_at = now(), flagged = $4', [flagged]);
export const markSkipped = (db: Queryable, setId: string, reason: string) => move(db, setId, ['requested', 'building'], 'skipped', 'error = $4', [reason]);
export const failSet = (db: Queryable, setId: string, error: string) =>
  move(db, setId, ['requested', 'building', 'ready', 'approved', 'scheduled', 'publishing'], 'failed', 'error = $4', [error.slice(0, 4000)]);

/** Lucas approves a built set (or an auto series approves itself). */
export const approveSet = (db: Queryable, setId: string) => move(db, setId, ['ready'], 'approved', 'approved_at = now()');

/** Lucas rejects a set; the reason is kept as feedback (plan §8). */
export async function rejectSet(db: StoriesDb, setId: string, fb: { tags?: string[]; note?: string; by?: string }): Promise<StorySet> {
  return db.transaction(async (tx) => {
    const set = await move(tx, setId, ['ready', 'approved', 'scheduled'], 'rejected');
    await tx.query(`INSERT INTO stories.feedback (set_id, verdict, tags, note, created_by) VALUES ($1, 'reject', $2::text[], $3, $4)`, [setId, fb.tags ?? [], fb.note ?? null, fb.by ?? null]);
    return set;
  });
}

/** The minute it posts (S-20). Publish now is a schedule at now(). */
export const scheduleSet = (db: Queryable, setId: string, publishAt: Date) => move(db, setId, ['approved', 'scheduled'], 'scheduled', 'publish_at = $4', [publishAt.toISOString()]);

/**
 * A person puts an approved set on another day or minute (Social Hub
 * Schedule here / move, D50). Its day moves with it, so the series' one
 * live set per day still holds (a clash is the unique index's 23505).
 * Never a set that is posting or posted. Re-projected like every move.
 */
export const rescheduleSet = (db: Queryable, setId: string, nyDate: string, publishAt: Date) =>
  move(db, setId, ['approved', 'scheduled'], 'scheduled', 'ny_date = $4::date, publish_at = $5', [nyDate, publishAt.toISOString()]);

/** Scheduled sets whose minute has come, oldest first. */
export async function dueSets(db: Queryable, now: Date = new Date()): Promise<StorySet[]> {
  const { rows } = await db.query<StorySet>(`SELECT ${SET_COLS} FROM stories.sets WHERE status = 'scheduled' AND publish_at <= $1 ORDER BY publish_at`, [now.toISOString()]);
  return rows;
}

export const markPublishing = (db: Queryable, setId: string) => move(db, setId, ['scheduled'], 'publishing');
export const markPublished = (db: Queryable, setId: string) => move(db, setId, ['publishing'], 'published', 'published_at = now()');

export async function recordFrameContainer(db: Queryable, frameId: string, containerId: string): Promise<void> {
  await db.query(`UPDATE stories.frames SET ig_container_id = $2 WHERE id = $1`, [frameId, containerId]);
  await projectFrameSet(db, frameId);
}

export async function recordFramePublished(db: Queryable, frameId: string, mediaId: string, at: Date = new Date()): Promise<void> {
  await db.query(`UPDATE stories.frames SET ig_media_id = $2, published_at = $3 WHERE id = $1`, [frameId, mediaId, at.toISOString()]);
  await projectFrameSet(db, frameId);
}

/* ── History (repeat checks) ──────────────────────────────────────── */

export async function recordHistory(db: Queryable, series: Series, keys: string[], setId: string | null): Promise<void> {
  for (const key of new Set(keys.map((k) => k.trim()).filter(Boolean))) {
    await db.query(`INSERT INTO stories.history (series, key, set_id) VALUES ($1, $2, $3)`, [series, key, setId]);
  }
}

/** Keys shown in the last `days` days for a series (3 Morning Download, 30 Guess the Number, 90 Free vs. Paid). */
export async function recentKeys(db: Queryable, series: Series, days: number, now: Date = new Date()): Promise<Set<string>> {
  const { rows } = await db.query<{ key: string }>(
    `SELECT DISTINCT key FROM stories.history WHERE series = $1 AND shown_at > $2::timestamptz - make_interval(days => $3)`,
    [series, now.toISOString(), days],
  );
  return new Set(rows.map((r) => r.key));
}

/* ── Costs and Jev logs ───────────────────────────────────────────── */

export type CostEvent = {
  setId?: string | null;
  vendor: 'anthropic' | 'jev' | 'web_search';
  component: string;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  usd: number;
};

/** One cost event; the set's running spend moves with it. */
export async function recordCost(db: StoriesDb, e: CostEvent): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO stories.cost_events (set_id, vendor, component, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [e.setId ?? null, e.vendor, e.component, e.model ?? null, e.inputTokens ?? 0, e.outputTokens ?? 0, e.cacheReadTokens ?? 0, e.cacheWriteTokens ?? 0, e.usd],
    );
    if (e.setId) await tx.query(`UPDATE stories.sets SET spend_usd = spend_usd + $2, updated_at = now() WHERE id = $1`, [e.setId, e.usd]);
  });
}

/** Spend this New York calendar month, for the monthly watch (plan §9). */
/** Spend on one New York day (the daily cap, docs/social-overnight.md). */
export async function daySpendUsd(db: Queryable, now: Date = new Date()): Promise<number> {
  const { rows } = await db.query<{ usd: number }>(
    `SELECT COALESCE(sum(usd), 0)::float8 AS usd FROM stories.cost_events
      WHERE (created_at AT TIME ZONE 'America/New_York')::date = $1::date`,
    [nyDate(now)],
  );
  return rows[0]?.usd ?? 0;
}

export async function monthSpendUsd(db: Queryable, now: Date = new Date()): Promise<number> {
  const month = nyDate(now).slice(0, 7);
  const { rows } = await db.query<{ usd: number }>(
    `SELECT COALESCE(sum(usd), 0)::float8 AS usd FROM stories.cost_events
      WHERE to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM') = $1`,
    [month],
  );
  return rows[0]?.usd ?? 0;
}

export async function recordJevLog(
  db: Queryable,
  log: { setId?: string | null; component: string; questionSetId: string; questionSetVersion: string; resolvedModel?: string | null; state: unknown; answers: unknown; inputTokens?: number },
): Promise<void> {
  await db.query(
    `INSERT INTO stories.jev_logs (set_id, component, question_set_id, question_set_version, resolved_model, state, answers, input_tokens)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [log.setId ?? null, log.component, log.questionSetId, log.questionSetVersion, log.resolvedModel ?? null, JSON.stringify(log.state), JSON.stringify(log.answers), log.inputTokens ?? 0],
  );
}

/* ── Insights (plan §7) ───────────────────────────────────────────── */

export type FrameMetrics = {
  reach?: number | null;
  views?: number | null;
  replies?: number | null;
  shares?: number | null;
  follows?: number | null;
  profile_visits?: number | null;
  total_interactions?: number | null;
  taps_forward?: number | null;
  taps_back?: number | null;
  exits?: number | null;
  swipe_forward?: number | null;
};

const METRIC_COLS: Array<keyof FrameMetrics> = ['reach', 'views', 'replies', 'shares', 'follows', 'profile_visits', 'total_interactions', 'taps_forward', 'taps_back', 'exits', 'swipe_forward'];

export async function recordInsights(db: Queryable, frameId: string, m: FrameMetrics, raw: unknown, final: boolean, at: Date = new Date()): Promise<void> {
  await db.query(
    `INSERT INTO stories.insights (frame_id, captured_at, final, ${METRIC_COLS.join(', ')}, raw)
     VALUES ($1, $2, $3, ${METRIC_COLS.map((_, i) => `$${i + 4}`).join(', ')}, $${METRIC_COLS.length + 4}::jsonb)`,
    [frameId, at.toISOString(), final, ...METRIC_COLS.map((c) => m[c] ?? null), JSON.stringify(raw ?? {})],
  );
  await projectFrameSet(db, frameId);
}

/**
 * Published frames still worth polling: live (under 24 hours), no final
 * capture yet, and either never captured or not captured in `everyMinutes`.
 */
export async function framesDueForInsights(db: Queryable, opts: { now?: Date; everyMinutes?: number } = {}): Promise<Array<{ id: string; ig_media_id: string; published_at: string }>> {
  const now = (opts.now ?? new Date()).toISOString();
  const { rows } = await db.query<{ id: string; ig_media_id: string; published_at: string }>(
    `SELECT f.id, f.ig_media_id, f.published_at FROM stories.frames f
      WHERE f.ig_media_id IS NOT NULL
        AND f.published_at > $1::timestamptz - interval '24 hours'
        AND NOT EXISTS (SELECT 1 FROM stories.insights i WHERE i.frame_id = f.id AND i.final)
        -- Due every everyMinutes, and once more as soon as it is 23 hours old: the final
        -- capture must land before the 24-hour cutoff above drops the frame.
        AND (
          NOT EXISTS (SELECT 1 FROM stories.insights i WHERE i.frame_id = f.id AND i.captured_at > $1::timestamptz - make_interval(mins => $2))
          OR f.published_at <= $1::timestamptz - interval '23 hours'
        )
      ORDER BY f.published_at`,
    [now, opts.everyMinutes ?? 120],
  );
  return rows;
}
