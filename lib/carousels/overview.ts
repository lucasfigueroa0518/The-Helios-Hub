import { dbQuery } from '@/lib/db';
import { DEFAULT_RUN_CAP_USD } from '@/lib/social/overnight/config';
import * as runs from '@/lib/social/overnight/runs';
import { getSocialSetting, setSocialSetting } from '@/lib/social/overnight/settings';

/**
 * The Carousels page's reads and writes: the run queue and the posts in
 * schema `social`, plus the three switches the worker reads. Review and
 * approval of a single carousel stay in the Social Hub post page.
 */

export type CarouselRunRow = {
  id: string;
  trigger: string;
  status: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  total_usd: number;
  cap_usd: number;
  stop_reason: string | null;
  error: string | null;
  post_count: number;
};

export type CarouselPostCard = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  published_at: string | null;
  slide_count: number;
  run_id: string | null;
};

export type CarouselSettings = {
  autoRun: boolean;
  requireApproval: boolean;
  publishingLive: boolean;
  runCapUsd: number;
};

export type CarouselsOverview = {
  runs: CarouselRunRow[];
  posts: CarouselPostCard[];
  settings: CarouselSettings;
  monthUsd: number;
};

const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function loadSettings(): Promise<CarouselSettings> {
  const [auto, approval, live, cap] = await Promise.all([
    getSocialSetting<boolean>('auto_run'),
    getSocialSetting<boolean>('require_approval'),
    getSocialSetting<boolean>('publishing_live'),
    getSocialSetting<number>('run_cap_usd'),
  ]);
  return { autoRun: auto === true, requireApproval: approval !== false, publishingLive: live === true, runCapUsd: cap ?? DEFAULT_RUN_CAP_USD };
}

export async function loadCarouselsOverview(): Promise<CarouselsOverview> {
  const [runRows, postRows, month, settings] = await Promise.all([
    dbQuery(
      `SELECT r.id::text AS id, r.trigger, r.status, r.requested_at::text AS requested_at, r.started_at::text AS started_at,
              r.finished_at::text AS finished_at, r.total_usd, r.cap_usd, r.stop_reason, r.error,
              (SELECT count(*)::int FROM social.posts p WHERE p.run_id = r.id AND p.origin = 'pipeline') AS post_count
         FROM social.runs r
        WHERE r.kind = 'daily'
        ORDER BY r.requested_at DESC LIMIT 15`,
    ),
    dbQuery(
      `SELECT p.id::text AS id, p.title, p.status, p.created_at::text AS created_at, p.published_at::text AS published_at,
              p.run_id::text AS run_id,
              COALESCE(jsonb_array_length(p.slide_objects), jsonb_array_length(p.render->'slides'), 0) AS slide_count
         FROM social.posts p
        WHERE p.origin = 'pipeline'
        ORDER BY p.created_at DESC LIMIT 60`,
    ),
    dbQuery(
      `SELECT COALESCE(sum(total_usd), 0) AS usd FROM social.runs
        WHERE kind = 'daily' AND requested_at >= date_trunc('month', now())`,
    ),
    loadSettings(),
  ]);
  return {
    runs: runRows.rows.map((r) => ({ ...r, total_usd: num(r.total_usd), cap_usd: num(r.cap_usd) })) as CarouselRunRow[],
    posts: postRows.rows.map((p) => ({ ...p, slide_count: num(p.slide_count) })) as CarouselPostCard[],
    settings,
    monthUsd: num(month.rows[0]?.usd),
  };
}

/** Run now: queue one manual run. The social worker claims it. A person clicking is the approval for its spend. */
export async function requestManualRun(): Promise<{ queued: true; id: string } | { queued: false; note: string }> {
  const settings = await loadSettings();
  const id = await runs.requestRun((text, params) => dbQuery(text, params), 'manual', { capUsd: settings.runCapUsd, hookPass: true });
  return id ? { queued: true, id } : { queued: false, note: 'A run is already queued.' };
}

const SWITCHES = { autoRun: 'auto_run', requireApproval: 'require_approval', publishingLive: 'publishing_live' } as const;

export async function updateSettings(patch: Partial<CarouselSettings>): Promise<CarouselSettings> {
  for (const [field, key] of Object.entries(SWITCHES) as Array<[keyof typeof SWITCHES, string]>) {
    const value = patch[field];
    if (value !== undefined) {
      if (typeof value !== 'boolean') throw new Error(`${field} must be true or false`);
      await setSocialSetting(key, value);
    }
  }
  if (patch.runCapUsd !== undefined) {
    const cap = Number(patch.runCapUsd);
    if (!Number.isFinite(cap) || cap < 0.5 || cap > 10) throw new Error('The run cap must be between $0.50 and $10.');
    await setSocialSetting('run_cap_usd', cap);
  }
  return loadSettings();
}
