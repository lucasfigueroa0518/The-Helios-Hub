import { RUN_TIMEZONE } from '@/lib/reels/config';
import { calendarDateKey, monthStart, zoneDateParts, zonedTime } from '@/lib/reels/schedule';

/**
 * Spend before this instant is development. It stays in the ledger and off
 * the monthly watch. 2026-09-30 00:00 America/New_York.
 */
export function defaultProdSpendSince(): Date {
  return zonedTime(2026, 9, 30, 0, 0, RUN_TIMEZONE);
}

export type Ledger = 'production' | 'development' | 'all';
export type CostPeriod = '7d' | '30d' | 'month' | 'custom';

export type ActivityId = 'ingest' | 'group' | 'score' | 'copy' | 'image' | 'video' | 'song' | 'other';

export const ACTIVITY_COMPONENTS: Record<Exclude<ActivityId, 'other'>, readonly string[]> = {
  ingest: ['ingest-screen', 'a4-editor', 'b6-web-search'],
  group: ['grouping', 'idea-merge'],
  score: ['scoring-pass1', 'scoring-pass2', 'reels-rescore'],
  copy: ['copy-caption', 'copy-rewrite', 'copy-pick', 'copy-story-match', 'full-story-cue', 'full-story-line'],
  image: ['reel-scene', 'reel-background', 'reel-color', 'reel-hook'],
  video: ['reel-motion'],
  song: ['song-pick', 'song-tag', 'song-narrow'],
};

export const COPY_CALL_COMPONENTS = ['copy-caption', 'copy-rewrite'] as const;

export const VENDOR_ORDER = ['anthropic', 'openai', 'jev', 'huggingface', 'fal', 'other'] as const;

export const ACTIVITY_ORDER: ActivityId[] = ['ingest', 'group', 'score', 'copy', 'image', 'video', 'song', 'other'];

const ACTIVITY_LABEL: Record<ActivityId, string> = {
  ingest: 'Ingest',
  group: 'Group',
  score: 'Score',
  copy: 'Copy',
  image: 'Image',
  video: 'Video',
  song: 'Song',
  other: 'Other',
};

const VENDOR_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  jev: 'Jev',
  huggingface: 'Hugging Face',
  fal: 'Fal',
  other: 'Other',
};

export function activityOf(component: string): ActivityId {
  for (const activity of ACTIVITY_ORDER) {
    if (activity === 'other') continue;
    if (ACTIVITY_COMPONENTS[activity].includes(component)) return activity;
  }
  return 'other';
}

export function vendorKey(vendor: string): string {
  const key = vendor.toLowerCase();
  return (VENDOR_ORDER as readonly string[]).includes(key) ? key : 'other';
}

export function inLedger(at: Date, ledger: Ledger, cutoff: Date): boolean {
  if (ledger === 'all') return true;
  if (ledger === 'production') return at.getTime() >= cutoff.getTime();
  return at.getTime() < cutoff.getTime();
}

export function periodRange(
  period: CostPeriod,
  now: Date,
  custom?: { from?: string; to?: string },
): { start: Date; end: Date } {
  const end = now;
  if (period === '7d') return { start: new Date(now.getTime() - 7 * 86_400_000), end };
  if (period === '30d') return { start: new Date(now.getTime() - 30 * 86_400_000), end };
  if (period === 'month') return { start: monthStart(now), end };
  const from = parseNyDate(custom?.from) ?? new Date(now.getTime() - 7 * 86_400_000);
  const toKey = custom?.to && /^\d{4}-\d{2}-\d{2}$/.test(custom.to) ? custom.to : null;
  const endExclusive = toKey ? nextNyMidnight(toKey) : now;
  return { start: from, end: endExclusive.getTime() > from.getTime() ? endExclusive : nextNyMidnight(calendarDateKey(from)) };
}

function nextNyMidnight(nyDate: string): Date {
  const next = addCalendarDays(nyDate, 1);
  const [year, month, day] = next.split('-').map(Number);
  return zonedTime(year, month, day, 0, 0, RUN_TIMEZONE);
}

function parseNyDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return zonedTime(year, month, day, 0, 0, RUN_TIMEZONE);
}

export function capPace(
  spent: number,
  cap: number,
  now: Date,
  cutoff: Date,
): { left: number; perDay: number; daysLeft: number; projected: number } {
  const { year, month, day } = zoneDateParts(now);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysLeft = Math.max(1, daysInMonth - day + 1);
  const from = monthStart(now) > cutoff ? monthStart(now) : cutoff;
  const elapsed = now < from ? 0 : Math.max(1, Math.round((now.getTime() - from.getTime()) / 86_400_000) + 1);
  const perDay = elapsed > 0 ? spent / elapsed : 0;
  return { left: Math.max(0, cap - spent), perDay, daysLeft, projected: perDay * (elapsed + daysLeft - 1) };
}

export function addCalendarDays(nyDate: string, days: number): string {
  const [year, month, day] = nyDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/** Calendar days touched by [start, end), capped so a long custom range stays drawable. */
export function daysInRange(start: Date, end: Date, limit = 62): string[] {
  if (end.getTime() <= start.getTime()) return [calendarDateKey(start)];
  const last = calendarDateKey(new Date(end.getTime() - 1));
  const days: string[] = [];
  let cursor = calendarDateKey(start);
  while (cursor <= last && days.length < limit) {
    days.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return days;
}

export type MoneyRow = { day: string; vendor: string; activity: ActivityId; usd: number };

export type StackSeries = { key: string; label: string; values: number[] };

export type StatKind = 'usd' | 'count' | 'ratio';

export type StatSide = { label: string; value: number; kind: 'usd' | 'count' };

export type Stat = {
  id: string;
  label: string;
  kind: StatKind;
  value: number | null;
  numerator: StatSide;
  denominator: StatSide | null;
};

export type CostReport = {
  days: string[];
  vendors: StackSeries[];
  activities: StackSeries[];
  headlines: Stat[];
  stats: Stat[];
  waste: Stat[];
};

export type ReportFacts = {
  days: string[];
  rows: MoneyRow[];
  postsGenerated: number;
  postsPublished: number;
  ingestRuns: number;
  nights: number;
  ideasScored: number;
  scoringCalls: number;
  copyCalls: number;
  postsWithCopy: number;
  /** Spend on copy-caption and copy-rewrite only. */
  copyCallUsd: number;
  imageJobs: number;
  postsWithFrame: number;
  videoJobs: number;
  postsWithVideo: number;
  publishedWithVideo: number;
  ideaProductionUsd: number;
  publishedIdeaProductionUsd: number;
  failedJobUsd: number;
  unshippedCopyUsd: number;
};

function sumWhere(rows: MoneyRow[], activity?: ActivityId): number {
  return rows.reduce((sum, row) => sum + (activity == null || row.activity === activity ? row.usd : 0), 0);
}

function divide(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function usdStat(id: string, label: string, value: number): Stat {
  return { id, label, kind: 'usd', value, numerator: { label: 'Spend', value, kind: 'usd' }, denominator: null };
}

function avgStat(
  id: string,
  label: string,
  spend: number,
  count: number,
  spendLabel: string,
  countLabel: string,
): Stat {
  return {
    id,
    label,
    kind: 'usd',
    value: divide(spend, count),
    numerator: { label: spendLabel, value: spend, kind: 'usd' },
    denominator: { label: countLabel, value: count, kind: 'count' },
  };
}

function stack(days: string[], rows: MoneyRow[], keys: readonly string[], labelOf: (key: string) => string, pick: (row: MoneyRow) => string): StackSeries[] {
  return keys.map((key) => ({
    key,
    label: labelOf(key),
    values: days.map((day) => rows.reduce((sum, row) => sum + (row.day === day && pick(row) === key ? row.usd : 0), 0)),
  }));
}

/** Turn already-filtered ledger rows and counts into the analytics page. */
export function assembleReport(facts: ReportFacts): CostReport {
  const rows = facts.rows;
  const total = sumWhere(rows);
  const ingest = sumWhere(rows, 'ingest');
  const score = sumWhere(rows, 'score');
  const copy = sumWhere(rows, 'copy');
  const image = sumWhere(rows, 'image');
  const video = sumWhere(rows, 'video');

  const vendors = stack(facts.days, rows, VENDOR_ORDER, (key) => VENDOR_LABEL[key] ?? key, (row) => vendorKey(row.vendor));
  const activities = stack(facts.days, rows, ACTIVITY_ORDER, (key) => ACTIVITY_LABEL[key as ActivityId] ?? key, (row) => row.activity);

  const vendorStats = VENDOR_ORDER.filter((key) => vendors.find((series) => series.key === key)?.values.some((value) => value > 0)).map((key) =>
    usdStat(`vendor:${key}`, VENDOR_LABEL[key] ?? key, vendors.find((series) => series.key === key)?.values.reduce((sum, value) => sum + value, 0) ?? 0),
  );

  const headlines: Stat[] = [
    avgStat('cost-per-published', 'Cost per published post', total, facts.postsPublished, 'Total spend', 'Posts published'),
    {
      id: 'spend-yield',
      label: 'Spend that reached a published post',
      kind: 'ratio',
      value: divide(facts.publishedIdeaProductionUsd, facts.ideaProductionUsd),
      numerator: { label: 'Copy, image, and video spend on published ideas', value: facts.publishedIdeaProductionUsd, kind: 'usd' },
      denominator: { label: 'Copy, image, and video spend', value: facts.ideaProductionUsd, kind: 'usd' },
    },
  ];

  const stats: Stat[] = [
    usdStat('total', 'Total cost', total),
    ...vendorStats,
    { id: 'posts-generated', label: 'Posts generated', kind: 'count', value: facts.postsGenerated, numerator: { label: 'Ideas with copy, frame, and video finished', value: facts.postsGenerated, kind: 'count' }, denominator: null },
    { id: 'posts-published', label: 'Posts published', kind: 'count', value: facts.postsPublished, numerator: { label: 'Posts published', value: facts.postsPublished, kind: 'count' }, denominator: null },
    usdStat('ingest-total', 'Total ingestion cost', ingest),
    avgStat('ingest-avg', 'Average ingestion cost', ingest, facts.ingestRuns, 'Ingestion spend', 'Adapter runs'),
    avgStat('ingest-night', 'Ingestion cost per night', ingest, facts.nights, 'Ingestion spend', 'Nights'),
    usdStat('score-total', 'Total scoring cost', score),
    avgStat('score-avg', 'Average scoring cost', score, facts.ideasScored, 'Scoring spend', 'Post ideas scored'),
    avgStat('score-call', 'Scoring call cost', score, facts.scoringCalls, 'Scoring spend', 'Scoring calls'),
    usdStat('copy-total', 'Total copywriting cost', copy),
    avgStat('copy-run', 'Copywriting call cost', facts.copyCallUsd, facts.copyCalls, 'Sonnet copy calls', 'Copy calls'),
    avgStat('copy-avg', 'Average copywriting cost', copy, facts.postsWithCopy, 'Copywriting spend', 'Posts copy was written for'),
    usdStat('image-total', 'Total image gen cost', image),
    avgStat('image-run', 'Image gen run cost', image, facts.imageJobs, 'Image gen spend', 'Image generation runs'),
    avgStat('image-avg', 'Average image gen cost', image, facts.postsWithFrame, 'Image gen spend', 'Posts with a frame'),
    usdStat('video-total', 'Total video gen cost', video),
    avgStat('video-run', 'Video gen run cost', video, facts.videoJobs, 'Video gen spend', 'Video generation runs'),
    avgStat('video-avg', 'Average video gen cost', video, facts.postsWithVideo, 'Video gen spend', 'Posts with a video'),
  ];

  const waste: Stat[] = [
    {
      id: 'publish-yield',
      label: 'Publish yield',
      kind: 'ratio',
      value: divide(facts.publishedWithVideo, facts.postsWithVideo),
      numerator: { label: 'Finished videos that were published', value: facts.publishedWithVideo, kind: 'count' },
      denominator: { label: 'Posts with a finished video', value: facts.postsWithVideo, kind: 'count' },
    },
    headlines[1],
    usdStat('failed-spend', 'Failed-run spend', facts.failedJobUsd),
    usdStat('unshipped-copy', 'Unshipped copy spend', facts.unshippedCopyUsd),
    avgStat('production-per-published', 'Cost per published post', facts.ideaProductionUsd, facts.postsPublished, 'Copy, image, and video spend', 'Posts published'),
    avgStat('cost-per-video', 'Cost per finished video', facts.ideaProductionUsd, facts.postsWithVideo, 'Copy, image, and video spend', 'Posts with a finished video'),
  ];

  return { days: facts.days, vendors, activities, headlines, stats, waste };
}
