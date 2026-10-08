import { dbQuery } from '@/lib/db';
import { EARLIER_COPY_LINES_MAX } from '@/lib/reels/config';
import type { CopyMember, EarlierCopyLine } from '@/lib/reels/copy/assemble';
import type { CopyVariants } from '@/lib/reels/copy/pick';
import type { CopyChecks, CopyReport } from '@/lib/reels/copy/report';
import type { BucketId, FrameworkId } from '@/lib/reels/scoring/decide';
import type { MemberRole } from '@/lib/reels/types';

export type CopyTarget = {
  postIdeaId: string;
  rank: number | null;
  bucket: BucketId;
  framework: FrameworkId;
  members: CopyMember[];
  /** D-242. Copies tried on earlier New York dates, most recent first. Empty for a new idea. */
  earlierLines?: EarlierCopyLine[];
};

/**
 * Ideas to write, with the winning pair and every member's full body.
 * Nightly copy asks for every ranked idea, so a knowledge-lane story below
 * the top of the slate can still be written. A canary can ask for the top
 * ranks instead, including ideas that were not selected.
 */
export async function loadCopyTargets(
  slateId: string,
  options?: { topRanks?: number; postIdeaId?: string; all?: boolean },
): Promise<CopyTarget[]> {
  const { rows } = await dbQuery<{
    post_idea_id: string;
    rank: number | null;
    chosen_bucket: BucketId;
    chosen_framework: FrameworkId;
    role: MemberRole;
    source_name: string;
    headline: string;
    body: string;
    canonical_url: string;
    citation_urls: string[] | null;
    author: string | null;
    byline: string | null;
    publish_time: string | null;
  }>(
    `SELECT s.post_idea_id, s.rank, s.chosen_bucket, s.chosen_framework,
            m.role, src.source_name, src.headline, src.body, src.canonical_url,
            src.citation_urls, src.author, src.byline, src.publish_time::text AS publish_time
       FROM reels.idea_scores s
       JOIN reels.post_idea_members m ON m.post_idea_id = s.post_idea_id
       JOIN reels.sources src ON src.id = m.source_id
      WHERE s.slate_id = $1
        AND s.chosen_bucket IS NOT NULL
        AND s.chosen_framework IS NOT NULL
        AND (
          ($2::int IS NULL AND $3::uuid IS NULL AND $4::boolean IS NOT TRUE AND s.selected)
          OR ($2::int IS NOT NULL AND $3::uuid IS NULL AND s.rank BETWEEN 1 AND $2)
          OR ($3::uuid IS NOT NULL AND s.post_idea_id = $3)
          OR ($4::boolean IS TRUE AND s.rank IS NOT NULL)
        )
      ORDER BY s.rank NULLS LAST, s.post_idea_id,
               CASE m.role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END,
               m.joined_at`,
    [
      slateId,
      options?.postIdeaId || options?.all ? null : (options?.topRanks ?? null),
      options?.postIdeaId ?? null,
      options?.all === true,
    ],
  );

  const byId = new Map<string, CopyTarget>();
  for (const row of rows) {
    const target = byId.get(row.post_idea_id) ?? {
      postIdeaId: row.post_idea_id,
      rank: row.rank,
      bucket: row.chosen_bucket,
      framework: row.chosen_framework,
      members: [],
      earlierLines: [],
    };
    target.members.push({
      role: row.role,
      sourceName: row.source_name,
      headline: row.headline,
      body: row.body,
      url: row.canonical_url,
      citationUrls: row.citation_urls ?? [],
      author: row.author,
      byline: row.byline,
      publishTime: row.publish_time,
    });
    byId.set(row.post_idea_id, target);
  }
  const earlier = await loadEarlierLines(slateId, [...byId.keys()]);
  for (const [postIdeaId, lines] of earlier) {
    const target = byId.get(postIdeaId);
    if (target) target.earlierLines = lines;
  }
  return [...byId.values()];
}

/**
 * D-242. Every judged on-screen copy each idea was given on a New York date
 * before this slate's, most recent first. Repeats collapse to their latest
 * appearance, and each idea keeps at most EARLIER_COPY_LINES_MAX.
 */
export async function loadEarlierLines(
  slateId: string,
  postIdeaIds: readonly string[],
): Promise<Map<string, EarlierCopyLine[]>> {
  const out = new Map<string, EarlierCopyLine[]>();
  if (postIdeaIds.length === 0) return out;
  const { rows } = await dbQuery<{
    post_idea_id: string;
    ny_date: string;
    copy: string;
    plain: number;
    stake: number;
  }>(
    `SELECT h.post_idea_id, s.ny_date::text AS ny_date, line->>'onScreenCopy' AS copy,
            (line->>'plain')::float8 AS plain, (line->>'stake')::float8 AS stake
       FROM reels.idea_copy_history h
       JOIN reels.score_slates s ON s.id = h.slate_id
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(h.variants->'lines', '[]'::jsonb)) AS line
      WHERE h.post_idea_id = ANY($2::uuid[])
        AND s.ny_date < (SELECT ny_date FROM reels.score_slates WHERE id = $1::uuid)
        AND line->>'onScreenCopy' IS NOT NULL
        AND jsonb_typeof(line->'plain') = 'number'
        AND jsonb_typeof(line->'stake') = 'number'
      ORDER BY h.created_at DESC`,
    [slateId, [...postIdeaIds]],
  );
  for (const row of rows) {
    const lines = out.get(row.post_idea_id) ?? [];
    const key = row.copy.replace(/\s+/g, ' ').trim().toLowerCase();
    if (lines.length >= EARLIER_COPY_LINES_MAX) continue;
    if (lines.some((line) => line.onScreenCopy.replace(/\s+/g, ' ').trim().toLowerCase() === key)) continue;
    lines.push({ nyDate: row.ny_date, onScreenCopy: row.copy.trim(), plain: Number(row.plain), stake: Number(row.stake) });
    out.set(row.post_idea_id, lines);
  }
  return out;
}

const COPY_COLUMNS = `slate_id, post_idea_id, run_id, prompt_version, model, bucket, framework,
       status, on_screen_copy, viewer_stake, caption, call_to_action, hashtags, sources, checks,
       working, variants, error, full_story_below, full_story_cue, input_tokens, output_tokens, usd`;

const COPY_VALUES = `$1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb,
       $16::jsonb, $17::jsonb, $18, $19, $20, $21, $22, $23`;

/**
 * D-220. One statement: append the attempt to the history, then upsert the
 * current row. The update is skipped when the stored row is ok and this
 * attempt failed, so a failure never replaces good copy.
 */
export const SAVE_IDEA_COPY_SQL = `WITH attempt AS (
       INSERT INTO reels.idea_copy_history (${COPY_COLUMNS})
       VALUES (${COPY_VALUES})
     )
     INSERT INTO reels.idea_copy (${COPY_COLUMNS})
     VALUES (${COPY_VALUES})
     ON CONFLICT (slate_id, post_idea_id) DO UPDATE SET
       run_id = EXCLUDED.run_id,
       prompt_version = EXCLUDED.prompt_version,
       model = EXCLUDED.model,
       bucket = EXCLUDED.bucket,
       framework = EXCLUDED.framework,
       status = EXCLUDED.status,
       on_screen_copy = EXCLUDED.on_screen_copy,
       viewer_stake = EXCLUDED.viewer_stake,
       caption = EXCLUDED.caption,
       call_to_action = EXCLUDED.call_to_action,
       hashtags = EXCLUDED.hashtags,
       sources = EXCLUDED.sources,
       checks = EXCLUDED.checks,
       working = EXCLUDED.working,
       variants = EXCLUDED.variants,
       error = EXCLUDED.error,
       full_story_below = EXCLUDED.full_story_below,
       full_story_cue = EXCLUDED.full_story_cue,
       input_tokens = EXCLUDED.input_tokens,
       output_tokens = EXCLUDED.output_tokens,
       usd = EXCLUDED.usd,
       created_at = now()
     WHERE reels.idea_copy.status <> 'ok' OR EXCLUDED.status = 'ok'
     RETURNING status`;

/** Returns false when an earlier ok row was kept in place of this failed attempt. */
export async function saveIdeaCopy(input: {
  slateId: string;
  postIdeaId: string;
  runId: string | null;
  promptVersion: string;
  model: string;
  bucket: BucketId;
  framework: FrameworkId;
  report: CopyReport | null;
  checks: CopyChecks | null;
  variants: CopyVariants | null;
  error: string | null;
  fullStoryBelow?: boolean;
  fullStoryCue?: string | null;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}): Promise<boolean> {
  const report = input.report;
  const { rows } = await dbQuery<{ status: string }>(SAVE_IDEA_COPY_SQL, [
    input.slateId,
    input.postIdeaId,
    input.runId,
    input.promptVersion,
    input.model,
    input.bucket,
    input.framework,
    report ? 'ok' : 'failed',
    report?.onScreenCopy ?? null,
    report?.viewerStake ?? null,
    report?.caption ?? null,
    report?.callToAction ?? null,
    report?.hashtags ?? [],
    JSON.stringify(report?.sources ?? []),
    input.checks ? JSON.stringify(input.checks) : null,
    report ? JSON.stringify(report.working) : null,
    input.variants ? JSON.stringify(input.variants) : null,
    input.error,
    input.fullStoryBelow ?? false,
    input.fullStoryCue ?? null,
    input.inputTokens,
    input.outputTokens,
    input.usd,
  ]);
  return rows.length > 0;
}

export type StoredCopy = {
  postIdeaId: string;
  status: 'ok' | 'failed';
  promptVersion: string;
  bucket: string;
  framework: string;
  onScreenCopy: string | null;
  caption: string | null;
  callToAction: string | null;
  hashtags: string[];
  sources: Array<{ name: string; url: string }>;
  checks: CopyChecks | null;
  error: string | null;
  usd: number;
  createdAt: string;
};

export async function loadSlateCopy(slateId: string): Promise<Record<string, StoredCopy>> {
  const { rows } = await dbQuery<{
    post_idea_id: string;
    status: 'ok' | 'failed';
    prompt_version: string;
    bucket: string;
    framework: string;
    on_screen_copy: string | null;
    caption: string | null;
    call_to_action: string | null;
    hashtags: string[] | null;
    sources: Array<{ name: string; url: string }> | null;
    checks: CopyChecks | null;
    error: string | null;
    usd: string;
    created_at: string;
  }>(
    `SELECT post_idea_id, status, prompt_version, bucket, framework, on_screen_copy,
            caption, call_to_action, hashtags, sources, checks, error, usd::text AS usd,
            created_at
       FROM reels.idea_copy
      WHERE slate_id = $1`,
    [slateId],
  );
  const out: Record<string, StoredCopy> = {};
  for (const row of rows) {
    out[row.post_idea_id] = {
      postIdeaId: row.post_idea_id,
      status: row.status,
      promptVersion: row.prompt_version,
      bucket: row.bucket,
      framework: row.framework,
      onScreenCopy: row.on_screen_copy,
      caption: row.caption,
      callToAction: row.call_to_action,
      hashtags: row.hashtags ?? [],
      sources: row.sources ?? [],
      checks: row.checks,
      error: row.error,
      usd: Number(row.usd),
      createdAt: row.created_at,
    };
  }
  return out;
}
