import { explainersDb } from '@/lib/explainers/connection';
import { saveSetting as saveExplainersSetting } from '@/lib/explainers/settings';
import { getSetting as getReelsSetting, setSetting as setReelsSetting } from '@/lib/reels/music/store';
import { PASSING_REELS_PER_NIGHT } from '@/lib/reels/config';
import { getSocialSetting, setSocialSetting } from '@/lib/social/overnight/settings';
import * as carouselCfg from '@/lib/social/overnight/config';
import { EXPLAINER_WINDOWS, DEFAULT_POSTS_PER_DAY as EXPLAINER_DEFAULT_PER_DAY } from '@/lib/explainers/publish/config';
import { liveStoriesDb } from '@/lib/stories/db';
import { loadSettings as loadStories, saveSeriesSetting, SERIES } from '@/lib/stories/settings';
import type { Series } from '@/lib/stories/render/types';
import { PLAN } from '@/lib/social-hub/views/plan';

/**
 * How each content type makes and posts, in the two switches a person thinks
 * in (every type, one vocabulary):
 *
 *  - Generate: make content every morning to fill the day's quota.
 *  - Auto-publish: schedule and post what was made without waiting. Off, a
 *    post goes out only once a person approves it (`require_approval` on).
 *
 * Live is the master: while it is off, nothing is scheduled or posted.
 * The quota (`perDay`) is how many a day are generated, scheduled and
 * posted; it can't pass the type's posting windows. Stories have no quota:
 * each series has its own days of the week.
 */
export type ContentType = 'reels' | 'carousels' | 'explainers' | 'stories';

export const POSTING_TYPES: readonly ContentType[] = ['reels', 'carousels', 'explainers', 'stories'];
export const isPostingType = (v: unknown): v is ContentType => POSTING_TYPES.includes(v as ContentType);

export type SeriesState = { id: Series; label: string; enabled: boolean; generate: boolean; days: number[] };

export type PostingState = {
  type: ContentType;
  live: boolean;
  generate: boolean | null;
  autoPublish: boolean;
  perDay: number | null;
  maxPerDay: number | null;
  series: SeriesState[] | null;
};

export type PostingPatch = {
  live?: boolean;
  generate?: boolean;
  autoPublish?: boolean;
  perDay?: number;
  series?: { id: string; enabled?: boolean; generate?: boolean; days?: number[] };
};

const SERIES_LABEL: Record<Series, string> = { morning_download: 'Morning Download', guess_the_number: 'Guess the Number', free_vs_paid: 'Free vs. Paid' };

type Row = { query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }> };
const rowOf = async (db: Row, table: string, key: string) => (await db.query(`SELECT value FROM ${table} WHERE key = $1`, [key])).rows[0]?.value;

const windows = (type: ContentType) => PLAN[type].length;

/** A stored count, or NaN when the row is missing (Number(null) would read as zero). */
const count = (raw: unknown) => (raw == null ? NaN : Number(raw));

async function exDb() {
  return explainersDb();
}

export async function readPosting(type: ContentType): Promise<PostingState> {
  if (type === 'carousels') {
    const [auto, approval, live, per] = await Promise.all(['auto_run', 'require_approval', 'publishing_live', 'posts_per_day'].map((k) => getSocialSetting<unknown>(k)));
    const per2 = count(per);
    return { type, live: live === true, generate: auto === true, autoPublish: approval === false, perDay: Number.isInteger(per2) && per2 >= 0 ? per2 : carouselCfg.DEFAULT_POSTS_PER_DAY, maxPerDay: carouselCfg.CAROUSEL_SLOTS.length, series: null };
  }
  if (type === 'explainers') {
    const db = await exDb();
    const [auto, approval, live, per] = await Promise.all(['auto_render', 'require_approval', 'publishing_live', 'posts_per_day'].map((k) => rowOf(db, 'explainers.settings', k)));
    const per2 = count(per);
    return { type, live: live === true, generate: auto === true, autoPublish: approval === false, perDay: Number.isInteger(per2) && per2 >= 1 ? per2 : EXPLAINER_DEFAULT_PER_DAY, maxPerDay: EXPLAINER_WINDOWS.length, series: null };
  }
  if (type === 'reels') {
    const [run, approval, live, per] = await Promise.all(['auto_run', 'require_approval', 'publishing_live', 'posts_per_day'].map((k) => getReelsSetting<unknown>(k)));
    const per2 = count(per);
    return { type, live: live === true, generate: run !== false, autoPublish: approval === false, perDay: Number.isInteger(per2) && per2 >= 0 ? per2 : PASSING_REELS_PER_NIGHT, maxPerDay: windows('reels'), series: null };
  }
  const s = await loadStories(liveStoriesDb);
  return {
    type,
    live: s.publishingLive,
    generate: null,
    autoPublish: !s.requireApproval,
    perDay: null,
    maxPerDay: null,
    series: SERIES.map((id) => ({ id, label: SERIES_LABEL[id], enabled: s.series[id].enabled, generate: s.series[id].auto, days: [...s.series[id].window.days].sort() })),
  };
}

function quota(patch: PostingPatch, max: number | null, min: number): number | null {
  if (patch.perDay === undefined) return null;
  const n = patch.perDay;
  if (!Number.isInteger(n) || n < min || (max != null && n > max)) throw new Error(`Posts per day must be a whole number from ${min} to ${max}.`);
  return n;
}

/** Everything a patch can get wrong, checked before any connection is opened. */
function validate(type: ContentType, patch: PostingPatch): void {
  for (const k of ['live', 'generate', 'autoPublish'] as const) if (patch[k] !== undefined && typeof patch[k] !== 'boolean') throw new Error(`${k} must be true or false.`);
  if (patch.perDay !== undefined) {
    if (type === 'stories') throw new Error('Stories have no daily quota; each series has its own days.');
    quota(patch, type === 'carousels' ? carouselCfg.CAROUSEL_SLOTS.length : type === 'explainers' ? EXPLAINER_WINDOWS.length : windows('reels'), type === 'explainers' ? 1 : 0);
  }
  if (patch.series) {
    if (type !== 'stories') throw new Error('Only Stories have series.');
    if (!(SERIES as string[]).includes(patch.series.id)) throw new Error('Unknown series.');
    const { days } = patch.series;
    if (days !== undefined && (!Array.isArray(days) || days.length === 0 || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))) throw new Error('Pick at least one day of the week.');
  }
}

export async function writePosting(type: ContentType, patch: PostingPatch, by: string): Promise<PostingState> {
  validate(type, patch);
  if (type === 'carousels') {
    if (patch.generate !== undefined) await setSocialSetting('auto_run', patch.generate);
    if (patch.autoPublish !== undefined) await setSocialSetting('require_approval', !patch.autoPublish);
    if (patch.live !== undefined) await setSocialSetting('publishing_live', patch.live);
    const n = quota(patch, carouselCfg.CAROUSEL_SLOTS.length, 0);
    if (n != null) {
      await setSocialSetting('posts_per_day', n);
      // The run makes as many stories as the day posts (its own spend knob, run_stories); zero skips the run.
      await setSocialSetting('run_stories', n);
    }
  } else if (type === 'explainers') {
    const db = await exDb();
    if (patch.generate !== undefined) await saveExplainersSetting(db, 'auto_render', patch.generate);
    const raw = async (key: string, value: unknown) => {
      await db.query(`INSERT INTO explainers.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
    };
    if (patch.autoPublish !== undefined) await raw('require_approval', !patch.autoPublish);
    if (patch.live !== undefined) await raw('publishing_live', patch.live);
    const n = quota(patch, EXPLAINER_WINDOWS.length, 1);
    if (n != null) {
      await raw('posts_per_day', n);
      // The daily render cap can't sit under the quota, or the quota could never be made.
      const cap = Number(await rowOf(db, 'explainers.settings', 'daily_render_cap'));
      if (!Number.isFinite(cap) || cap < n) await saveExplainersSetting(db, 'daily_render_cap', n);
    }
  } else if (type === 'reels') {
    if (patch.generate !== undefined) await setReelsSetting('auto_run', patch.generate);
    if (patch.autoPublish !== undefined) await setReelsSetting('require_approval', !patch.autoPublish);
    if (patch.live !== undefined) await setReelsSetting('publishing_live', patch.live);
    const n = quota(patch, windows('reels'), 0);
    if (n != null) await setReelsSetting('posts_per_day', n);
  } else {
    const upsert = (key: string, value: unknown) =>
      liveStoriesDb.query(
        `INSERT INTO stories.settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, JSON.stringify(value), by],
      );
    if (patch.autoPublish !== undefined) await upsert('require_approval', !patch.autoPublish);
    if (patch.live !== undefined) await upsert('publishing_live', patch.live);
    if (patch.series) {
      const { id, enabled, generate, days } = patch.series;
      if (!(SERIES as string[]).includes(id)) throw new Error('Unknown series.');
      const change: { enabled?: boolean; auto?: boolean; days?: number[] } = {};
      if (enabled !== undefined) change.enabled = enabled;
      if (generate !== undefined) change.auto = generate;
      if (days !== undefined) {
        if (!Array.isArray(days) || days.length === 0 || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) throw new Error('Pick at least one day of the week.');
        change.days = [...new Set(days)].sort();
      }
      await saveSeriesSetting(liveStoriesDb, id as Series, change, by);
    }
  }
  return readPosting(type);
}
