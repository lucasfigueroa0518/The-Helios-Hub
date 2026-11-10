/**
 * field_notes.runs, tips and posts reads and writes (the lib/ai-events/store.ts patterns). Every
 * statement touches one run, one tip or one post, or counts; nothing here walks a table to
 * enrich it (CLAUDE.md Rule 2).
 */
import type { HubQuery } from '@/lib/social-hub/db';

import { canonicalSourceUrl, type TipCandidate } from './sources/candidate';
import { FIELD_NOTES_SCORE } from './sources/questions';
import type { TipTags } from './sources/score';
import { RECENT_WANT_POSTS } from './sources/select';
import type { ContentLeaf, Slide, Tip, TipStatus, Want } from './types';
import { CONTENT_LEAVES, KNOW_HOW_TIERS, PURPOSES, TIP_SOURCE_KINDS, TIP_STATUSES, WANTS } from './types';

export type RunTrigger = 'scheduled' | 'manual';
export type RunKind = 'build' | 'rebuild';

export type ClaimedRun = { id: string; trigger: RunTrigger; kind: RunKind; requestedBy: string | null; seedTipId: string | null };

/** A run still 'running' after this long died without finishing (crash, killed process); it must not block new runs forever. */
export const ABANDONED_AFTER = '2 hours';

const ABANDON_SQL = `UPDATE field_notes.runs SET status = 'failed', finished_at = now(), stop_reason = 'abandoned'
  WHERE status = 'running' AND started_at < now() - interval '${ABANDONED_AFTER}'`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Runs ────────────────────────────────────────────────────────────────────

/**
 * Queue a run: a person's Generate (with the seeded tip it should use, if any). Null when one is
 * already queued (the single-requested index). Only the worker runs it. The seed rides in the
 * run's `record` (there is no column for it) until the run finishes and writes its own record.
 */
export async function requestRun(
  q: HubQuery,
  trigger: RunTrigger,
  capUsd: number,
  o: { kind?: RunKind; requestedBy?: string | null; seedTipId?: string | null } = {},
): Promise<string | null> {
  const record = o.seedTipId ? { seedTipId: o.seedTipId } : {};
  const { rows } = await q<{ id: string }>(
    `INSERT INTO field_notes.runs (trigger, kind, status, cap_usd, requested_by, record)
     VALUES ($1, $2, 'requested', $3, $4, $5::jsonb) ON CONFLICT DO NOTHING RETURNING id::text AS id`,
    [trigger, o.kind ?? 'build', capUsd, o.requestedBy ?? null, JSON.stringify(record)],
  );
  return rows[0]?.id ?? null;
}

/** Whether a scheduled run was already queued for this New York date (the clock's no-double-run guard, fix 8). */
export async function scheduledRunToday(q: HubQuery, nyDate: string): Promise<boolean> {
  const { rows } = await q<{ id: string }>(
    `SELECT id::text AS id FROM field_notes.runs
      WHERE trigger = 'scheduled'
        AND (ny_date = $1::date OR (requested_at AT TIME ZONE 'America/New_York')::date = $1::date)
      LIMIT 1`,
    [nyDate],
  );
  return rows.length > 0;
}

/** Claim the queued run when none is running. A run left running past ABANDONED_AFTER is failed first. */
export async function claimRun(q: HubQuery, now = new Date()): Promise<ClaimedRun | null> {
  await q(ABANDON_SQL);
  try {
    const { rows } = await q<{ id: string; trigger: RunTrigger; kind: RunKind; requested_by: string | null; seed: string | null }>(
      `UPDATE field_notes.runs SET status = 'running', started_at = $1::timestamptz
        WHERE id = (
          SELECT id FROM field_notes.runs
           WHERE status = 'requested'
             AND NOT EXISTS (SELECT 1 FROM field_notes.runs r WHERE r.status = 'running')
           ORDER BY requested_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1)
        RETURNING id::text AS id, trigger, kind, requested_by, record->>'seedTipId' AS seed`,
      [now.toISOString()],
    );
    const r = rows[0];
    return r ? { id: r.id, trigger: r.trigger, kind: r.kind, requestedBy: r.requested_by, seedTipId: r.seed && UUID.test(r.seed) ? r.seed : null } : null;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return null;
    throw err;
  }
}

/** The claimed run's cap and day are set; nothing new is inserted. */
export async function adoptRun(q: HubQuery, id: string, o: { capUsd: number; nyDate: string }): Promise<void> {
  const { rows } = await q<{ id: string }>(
    `UPDATE field_notes.runs SET cap_usd = $2, ny_date = $3::date WHERE id = $1 AND status = 'running' RETURNING id::text AS id`,
    [id, o.capUsd, o.nyDate],
  );
  if (!rows[0]) throw new Error(`Field Notes run ${id} is not running: it was not claimed, or it already finished`);
}

/** Only a running run: one the worker already failed (the 30-minute timeout) keeps its failed row. */
export async function finishRun(
  q: HubQuery,
  id: string,
  o: { status: 'ok' | 'partial' | 'failed' | 'skipped'; stopReason?: string; error?: string; claudeUsd: number; jevUsd: number; record: unknown },
): Promise<boolean> {
  const { rows } = await q<{ id: string }>(
    `UPDATE field_notes.runs SET status = $2, finished_at = now(), stop_reason = $3, error = $4, claude_usd = $5, jev_usd = $6,
            total_usd = $5::double precision + $6::double precision, record = $7::jsonb
      WHERE id = $1 AND status = 'running' RETURNING id`,
    [id, o.status, o.stopReason ?? null, o.error ? o.error.slice(0, 2000) : null, o.claudeUsd, o.jevUsd, JSON.stringify(o.record ?? {})],
  );
  return rows.length > 0;
}

/** The worker's last word on a claimed run that threw before it was finished. */
export async function failRun(q: HubQuery, id: string, error: string): Promise<void> {
  await q(`UPDATE field_notes.runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1 AND status = 'running'`, [id, error.slice(0, 2000)]);
}

// ── Tips ────────────────────────────────────────────────────────────────────

type TipRow = {
  id: string;
  created_at: Date | string;
  source_kind: string;
  source_url: string | null;
  source_label: string | null;
  subject: string;
  leaf: string | null;
  want: string | null;
  tier: string | null;
  purposes: string[] | null;
  fresh: boolean | null;
  published_at: Date | string | null;
  use_with_result: string;
  untrusted_content: string | null;
  score: string | number | null;
  status: string;
  seeded_by: string | null;
  attempts?: number | string | null;
};

const TIP_COLUMNS = `id::text AS id, created_at, source_kind, source_url, source_label, subject, leaf, want, tier, purposes, fresh, published_at, use_with_result, untrusted_content, score, status, seeded_by, attempts`;

/** A tip is set aside after this many runs paid the Writer for it without a saved post (store.recordTipAttempt). */
export const MAX_TIP_ATTEMPTS = 2;

/** `v` when it is one of `options`, else null (an unknown stored value reads as untagged). */
const oneOf = <T extends string>(options: readonly T[], v: unknown): T | null => options.find((o) => o === v) ?? null;

/**
 * A stored tip plus the source's publish date, when the source gave one (`published_at`; null for seeds and for
 * rows saved before the column). Kept beside `Tip` (types.ts is shared) so scoring's `published` is real.
 */
export type StoredTip = Tip & { publishedAt: string | null; attempts: number };

export function rowToTip(r: TipRow): StoredTip {
  return {
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    sourceKind: TIP_SOURCE_KINDS.find((k) => k === r.source_kind) ?? 'seed',
    sourceUrl: r.source_url,
    sourceLabel: r.source_label,
    subject: r.subject,
    leaf: oneOf(CONTENT_LEAVES, r.leaf),
    want: oneOf(WANTS, r.want),
    tier: oneOf(KNOW_HOW_TIERS, r.tier),
    purposes: PURPOSES.filter((p) => (r.purposes ?? []).includes(p)),
    fresh: r.fresh === true,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    useWithResult: r.use_with_result,
    untrustedContent: r.untrusted_content,
    score: r.score === null || r.score === undefined ? null : Number(r.score),
    status: TIP_STATUSES.find((s) => s === r.status) ?? 'rejected',
    seededBy: r.seeded_by,
    attempts: Number(r.attempts ?? 0),
  };
}

export async function getTip(q: HubQuery, id: string): Promise<StoredTip | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await q<TipRow>(`SELECT ${TIP_COLUMNS} FROM field_notes.tips WHERE id = $1`, [id]);
  return rows[0] ? rowToTip(rows[0]) : null;
}

/** Placeholder text for a tip's required fields until a person (or the Writer) says more. Trusted: ours, never scraped. */
export { PLACEHOLDER_USE } from './types';
import { PLACEHOLDER_USE } from './types';

/**
 * One newly found candidate becomes a `candidate` tip row (no model: subject is our own source
 * label until a post names it, the use is a placeholder, the scraped text goes to untrusted_content only, the
 * source's publish date to published_at). The run saves a found candidate only once it is scored, so `score` and
 * `tags` come with it (one insert); without tags it is untagged. `tags.questionSetVersion` (a `ScoredCandidate`'s)
 * goes to `score_version`, which selection requires to be the current `FIELD_NOTES_SCORE.version`; without it the
 * row is NULL and never selectable. The same source URL is one tip: a repeat is ignored. Returns the new tip's id,
 * or null for a repeat.
 */
export async function saveCandidateTip(
  q: HubQuery,
  c: TipCandidate,
  score: number | null = null,
  tags?: TipTags & { questionSetVersion?: string },
): Promise<string | null> {
  const { rows } = await q<{ id: string }>(
    `INSERT INTO field_notes.tips (source_kind, source_url, source_label, subject, use_with_result, untrusted_content, score, status, published_at,
                                   leaf, want, tier, purposes, fresh, score_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'candidate', $8::timestamptz, $9, $10, $11, $12::text[], $13, $14)
     ON CONFLICT (source_url) WHERE source_url IS NOT NULL DO NOTHING RETURNING id::text AS id`,
    [
      c.sourceKind, c.sourceUrl, c.sourceLabel, (c.sourceLabel || 'Source').slice(0, 200), PLACEHOLDER_USE, c.untrustedContent, score, c.publishedAt,
      tags?.leaf ?? null, tags?.want ?? null, tags?.tier ?? null, tags?.purposes ?? [], tags?.fresh ?? false,
      score === null ? null : tags?.questionSetVersion ?? null,
    ],
  );
  return rows[0]?.id ?? null;
}

/**
 * Which of these links are already a tip (any status, any age): one lookup, so a run drops them before it pays to
 * score anything (the database is a lookup here, never swept).
 */
export async function storedSourceUrls(q: HubQuery, urls: readonly string[]): Promise<Set<string>> {
  if (!urls.length) return new Set();
  const { rows } = await q<{ source_url: string }>(`SELECT source_url FROM field_notes.tips WHERE source_url = ANY($1::text[])`, [[...new Set(urls)]]);
  return new Set(rows.map((r) => r.source_url));
}

/** Any handle that runs SQL (HubQuery, the media-library Query the seed API holds). */
type AnyQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type SeededLinkInput = {
  /** An http(s) link (the caller has checked it and dropped the fragment); stored in canonical form (canonicalSourceUrl). */
  sourceUrl: string;
  /** Our label for the source (the host), never scraped. */
  sourceLabel: string;
  subject: string;
  /** The seeder's required content leaf and want: stored as given, never overwritten by scoring. */
  leaf: ContentLeaf;
  want: Want;
  /** The person's note, or PLACEHOLDER_USE. */
  useWithResult: string;
  seededBy: string;
};

export type SeededLinkResult =
  | { kind: 'created'; tipId: string; subject: string; sourceUrl: string }
  /**
   * A rejected or expired tip, or a found tip still waiting as a candidate, made the person's seed: source_kind
   * 'seed', the seeder's leaf and want, seeded_by, and its age restarted (so expiry counts from this seeding).
   */
  | { kind: 'reopened'; tipId: string; subject: string; sourceUrl: string }
  /** Already a seed waiting, or a tip that is selected, drafted, approved or posted: nothing is changed (leaf and want included). */
  | { kind: 'duplicate'; tipId: string; subject: string; status: string; sourceUrl: string };

/**
 * The one way to save a seed (the seed API, app/api/field-notes/seed): a pasted link becomes a `seed` candidate
 * tip with the seeder's leaf and want. No model, no fetch, no scoring. The link is stored canonical, so the same
 * page is one tip. A rejected or expired tip, or a found (non-seed) candidate, with that link is taken over by the
 * seeder (its note replaced only when a new one is given) and its `created_at` restarts: expiry counts from when it
 * was last seeded, so the next run's expiry does not expire it again at once. Anything else is a duplicate.
 * One row, the one the person pasted (Rule 2). Throws on an unknown leaf or want (the API validates first; the
 * CHECKs back it up).
 */
export async function saveSeededLink(q: AnyQuery, s: SeededLinkInput): Promise<SeededLinkResult> {
  if (!oneOf(CONTENT_LEAVES, s.leaf)) throw new Error(`unknown content leaf: ${String(s.leaf)}`);
  if (!oneOf(WANTS, s.want)) throw new Error(`unknown want: ${String(s.want)}`);
  const sourceUrl = canonicalSourceUrl(s.sourceUrl);
  const made = await q(
    `INSERT INTO field_notes.tips (source_kind, source_url, source_label, subject, leaf, want, use_with_result, seeded_by)
     VALUES ('seed', $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (source_url) WHERE source_url IS NOT NULL DO NOTHING
     RETURNING id::text AS id`,
    [sourceUrl, s.sourceLabel, s.subject, s.leaf, s.want, s.useWithResult || PLACEHOLDER_USE, s.seededBy],
  );
  const id = made.rows[0]?.id as string | undefined;
  if (id) return { kind: 'created', tipId: id, subject: s.subject, sourceUrl };
  const { rows } = await q(`SELECT id::text AS id, subject, status, source_kind FROM field_notes.tips WHERE source_url = $1`, [sourceUrl]);
  const row = rows[0] as { id: string; subject: string; status: string; source_kind: string } | undefined;
  if (!row) throw new Error('The tip could not be saved.');
  const takeOver = row.status === 'rejected' || row.status === 'expired' || (row.status === 'candidate' && row.source_kind !== 'seed');
  if (!takeOver) return { kind: 'duplicate', tipId: row.id, subject: row.subject, status: row.status, sourceUrl };
  const note = s.useWithResult && s.useWithResult !== PLACEHOLDER_USE ? s.useWithResult : '';
  await q(
    `UPDATE field_notes.tips SET status = 'candidate', seeded_by = $2, source_kind = 'seed', leaf = $4, want = $5,
            created_at = now(), updated_at = now(), attempts = 0, reject_reason = NULL,
            use_with_result = CASE WHEN $3::text <> '' THEN $3 ELSE use_with_result END
      WHERE id = $1`,
    [row.id, s.seededBy, note, s.leaf, s.want],
  );
  return { kind: 'reopened', tipId: row.id, subject: row.subject, sourceUrl };
}

export async function setTipStatus(q: HubQuery, id: string, status: TipStatus): Promise<void> {
  await q(`UPDATE field_notes.tips SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
}

/**
 * The engine sets one tip aside for good (status rejected, with why): a tip the Writer skipped because its source
 * does not state exact usage, so no later run pays for it again. A person brings it back by seeding the link again
 * (saveSeededLink reopens a rejected tip and clears the reason and the attempts).
 */
export async function rejectTip(q: HubQuery, id: string, reason: string): Promise<void> {
  await q(`UPDATE field_notes.tips SET status = 'rejected', reject_reason = $2, updated_at = now() WHERE id = $1`, [id, reason.slice(0, 500)]);
}

/**
 * One run paid the Writer for this tip (it got a slide) and ended without a saved post: attempts + 1. At
 * MAX_TIP_ATTEMPTS the tip is set aside (rejected, reason 'attempts: ...'); before that it stays a candidate for one
 * more try. Only a waiting candidate counts. Returns the new count (null when the tip was not a candidate).
 */
export async function recordTipAttempt(q: HubQuery, id: string, why: string): Promise<number | null> {
  const { rows } = await q<{ attempts: number }>(
    `UPDATE field_notes.tips
        SET attempts = attempts + 1,
            status = CASE WHEN attempts + 1 >= $2 THEN 'rejected' ELSE status END,
            reject_reason = CASE WHEN attempts + 1 >= $2 THEN $3 ELSE reject_reason END,
            updated_at = now()
      WHERE id = $1 AND status IN ('candidate', 'selected') RETURNING attempts`,
    [id, MAX_TIP_ATTEMPTS, `attempts: ${MAX_TIP_ATTEMPTS} runs drafted it without a saved post (last: ${why})`.slice(0, 500)],
  );
  return rows[0] ? Number(rows[0].attempts) : null;
}

/**
 * The subject a post gave the tip: its slide's headline (whitespace collapsed, as written, so the review screen reads
 * it). Selection compares it normalized (postedSubjects), so the same feature found again elsewhere is not posted twice.
 */
export async function setTipSubject(q: HubQuery, id: string, headline: string): Promise<void> {
  const subject = headline.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!subject) return;
  await q(`UPDATE field_notes.tips SET subject = $2, updated_at = now() WHERE id = $1`, [id, subject]);
}

export async function setTipContent(q: HubQuery, id: string, text: string): Promise<void> {
  await q(`UPDATE field_notes.tips SET untrusted_content = $2, updated_at = now() WHERE id = $1`, [id, text]);
}

/**
 * The wants of the tips on the last `posts` posts (newest first, rejected posts left out), one entry per tagged
 * tip: selection's want-variety tie-break reads it. A bounded read of recent rows, never a sweep.
 */
export async function recentPostWants(q: HubQuery, posts = RECENT_WANT_POSTS): Promise<Want[]> {
  const { rows } = await q<{ want: string | null }>(
    `WITH recent AS (
       SELECT id, CASE WHEN cardinality(tip_ids) > 0 THEN tip_ids ELSE ARRAY[tip_id] END AS ids
         FROM field_notes.posts WHERE status <> 'rejected' ORDER BY seq DESC LIMIT $1)
     SELECT t.want FROM recent r CROSS JOIN LATERAL unnest(r.ids) AS u(tip_id) JOIN field_notes.tips t ON t.id = u.tip_id`,
    [posts],
  );
  return rows.map((r) => oneOf(WANTS, r.want)).filter((w): w is Want => w !== null);
}

/**
 * Unused candidates older than `days` expire (CONTRACT section 2), except evergreen `technique` tips (a guide section
 * is as good next month). A status change only: nothing is scored or enriched. Returns how many.
 */
export async function expireOldTips(q: HubQuery, now: Date, days: number): Promise<number> {
  const { rows } = await q(
    `UPDATE field_notes.tips SET status = 'expired', updated_at = now()
      WHERE status = 'candidate' AND leaf IS DISTINCT FROM 'technique'
        AND created_at < $1::timestamptz - make_interval(days => $2::int) RETURNING id`,
    [now.toISOString(), days],
  );
  return rows.length;
}

/** The person's pasted tip waiting for a run (oldest first), or null. */
export async function unusedSeedTip(q: HubQuery): Promise<StoredTip | null> {
  const { rows } = await q<TipRow>(
    `SELECT ${TIP_COLUMNS} FROM field_notes.tips WHERE source_kind = 'seed' AND status = 'candidate' ORDER BY created_at, id LIMIT 1`,
  );
  return rows[0] ? rowToTip(rows[0]) : null;
}

/** Unused seed tips, oldest first: a person's own links, which go before anything a source found. */
export async function listUnusedSeedTips(q: HubQuery, limit = 10): Promise<StoredTip[]> {
  const { rows } = await q<TipRow>(
    `SELECT ${TIP_COLUMNS} FROM field_notes.tips WHERE source_kind = 'seed' AND status = 'candidate' AND attempts < $2 ORDER BY created_at, id LIMIT $1`,
    [limit, MAX_TIP_ATTEMPTS],
  );
  return rows.map(rowToTip);
}

/**
 * Candidate tips from non-seed sources: the ones the engine found itself, under MAX_TIP_ATTEMPTS. A scored tip is
 * listed only when the current question set scored it (`score_version` = `FIELD_NOTES_SCORE.version`): one scored
 * by an older set (before the about_ai gate) or with no recorded version (NULL) is simply not listed, a read filter,
 * never a re-score or rewrite (Rule 2). Unscored rows are still listed; the run never selects a tip without a score.
 */
export async function listSelectableTips(q: HubQuery, scoreVersion: string = FIELD_NOTES_SCORE.version): Promise<StoredTip[]> {
  const { rows } = await q<TipRow>(
    `SELECT ${TIP_COLUMNS} FROM field_notes.tips
      WHERE source_kind <> 'seed' AND status = 'candidate' AND attempts < $1 AND (score IS NULL OR score_version = $2)
      ORDER BY created_at DESC, id`,
    [MAX_TIP_ATTEMPTS, scoreVersion],
  );
  return rows.map(rowToTip);
}

/** Source links that already made a post, so selection never repeats them (nor, for a GitHub link, its repo). */
export async function postedSourceUrls(q: HubQuery): Promise<string[]> {
  const { rows } = await q<{ source_url: string }>(`SELECT source_url FROM field_notes.tips WHERE status IN ('drafted', 'approved', 'posted') AND source_url IS NOT NULL`);
  return rows.map((r) => r.source_url);
}

/**
 * Subjects of tips already on a post (drafted, approved or posted; any age): one cheap query. A found tip's stored
 * subject is our source label until a post names it (setTipSubject), so a subject equal to the label is left out:
 * an older row's label must never block a whole source.
 */
export async function postedSubjects(q: HubQuery): Promise<string[]> {
  const { rows } = await q<{ subject: string }>(
    `SELECT DISTINCT subject FROM field_notes.tips
      WHERE status IN ('drafted', 'approved', 'posted') AND subject IS DISTINCT FROM source_label`,
  );
  return rows.map((r) => r.subject);
}

// ── Posts ───────────────────────────────────────────────────────────────────

/**
 * Posts waiting on a person: in review and not approved or rejected on the spine. An approved
 * post that publishing has not sent yet does not count (it is no longer waiting on anyone).
 * The spine tables are read only when they exist (a database without the hub schema counts every review post).
 */
export async function pendingDraftCount(q: HubQuery): Promise<number> {
  const spine = await q<{ ok: boolean }>(`SELECT to_regclass('social_hub.approvals') IS NOT NULL AS ok`);
  if (!spine.rows[0]?.ok) {
    const { rows } = await q<{ n: string | number }>(`SELECT count(*) AS n FROM field_notes.posts WHERE status = 'review'`);
    return Number(rows[0]?.n ?? 0);
  }
  const { rows } = await q<{ n: string | number }>(
    `SELECT count(*) AS n FROM field_notes.posts p
      WHERE p.status = 'review'
        AND NOT EXISTS (
          SELECT 1 FROM social_hub.approvals a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
           WHERE ci.vertical = 'field_notes' AND ci.native_ref = p.id::text AND a.decision IN ('approved', 'rejected'))`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** The `seq` the next post will get (the photo rest rule counts posts). Gaps from rolled back inserts only shorten a rest by a post. */
export async function nextPostSeq(q: HubQuery): Promise<number> {
  const { rows } = await q<{ n: string | number }>(`SELECT coalesce(max(seq), 0) + 1 AS n FROM field_notes.posts`);
  return Number(rows[0]?.n ?? 1);
}

/** A free slug for the day: `field-notes-2026-11-04`, then `-2`, `-3`. */
export async function freeSlug(q: HubQuery, nyDate: string): Promise<string> {
  const base = `field-notes-${nyDate}`;
  const { rows } = await q<{ slug: string }>(`SELECT slug FROM field_notes.posts WHERE slug = $1 OR slug LIKE $2`, [base, `${base}-%`]);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export type SavedPost = {
  runId: string | null;
  /** Every tip on the post in slide order; `tip_id` is stored as the first. */
  tipIds: string[];
  nyDate: string;
  slides: Slide[];
  photoIds: string[];
  caption: string;
  slideObjects: string[];
  fitProblems: string[];
  renderProblems: string[];
  softNotes: string[];
};

/** Inserts the review post; `seq` comes from the table's identity column. */
export async function insertPost(q: HubQuery, slug: string, p: SavedPost): Promise<{ id: string; seq: number }> {
  const { rows } = await q<{ id: string; seq: number }>(
    `INSERT INTO field_notes.posts (run_id, tip_id, tip_ids, slug, ny_date, status, slides, photo_ids, caption, render_version, slide_objects, fit_problems, render_problems, soft_notes)
     VALUES ($1, $2, $12::uuid[], $3, $4::date, 'review', $5::jsonb, $6::uuid[], $7, 1, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb) RETURNING id::text AS id, seq`,
    [p.runId, p.tipIds[0] ?? null, slug, p.nyDate, JSON.stringify(p.slides), p.photoIds, p.caption, JSON.stringify(p.slideObjects), JSON.stringify(p.fitProblems), JSON.stringify(p.renderProblems), JSON.stringify(p.softNotes), p.tipIds],
  );
  return { id: rows[0]!.id, seq: Number(rows[0]!.seq) };
}

/** The tips of a post as a sub-select (`$1` = post id): `tip_ids`, or the single `tip_id` of a row made before tip_ids existed. */
export const POST_TIP_IDS_SQL = `SELECT unnest(CASE WHEN cardinality(tip_ids) > 0 THEN tip_ids ELSE ARRAY[tip_id] END) FROM field_notes.posts WHERE id = $1`;

export async function getPost(q: HubQuery, id: string): Promise<{ id: string; tipId: string | null; tipIds: string[]; status: string; nyDate: string } | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await q<{ id: string; tip_id: string | null; tip_ids: string[] | null; status: string; ny_date: string }>(
    `SELECT id::text AS id, tip_id::text AS tip_id, tip_ids::text[] AS tip_ids, status, ny_date::text AS ny_date FROM field_notes.posts WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  return r ? { id: r.id, tipId: r.tip_id, tipIds: r.tip_ids?.length ? r.tip_ids : r.tip_id ? [r.tip_id] : [], status: r.status, nyDate: r.ny_date.slice(0, 10) } : null;
}
