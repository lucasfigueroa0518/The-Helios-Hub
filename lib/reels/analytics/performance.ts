/**
 * Performance rollups for published trial reels. Pure: no database and no
 * Graph calls. A blank metric stays out of every sum and average.
 */

export type PerformancePeriod = '7d' | '30d' | 'all';
export type ReelSort = 'graduate' | 'hook';

export type FactorId =
  | 'psychology'
  | 'bucket'
  | 'blockbuster'
  | 'slot'
  | 'audio'
  | 'genre'
  | 'color'
  | 'hook'
  | 'sound'
  | 'story'
  | 'origin'
  | 'score';

export const FACTOR_OPTIONS: Array<{ id: FactorId; label: string }> = [
  { id: 'psychology', label: 'Psychology' },
  { id: 'bucket', label: 'Content bucket' },
  { id: 'blockbuster', label: 'Blockbuster' },
  { id: 'slot', label: 'Posting slot' },
  { id: 'audio', label: 'Audio type' },
  { id: 'genre', label: 'Song genre' },
  { id: 'color', label: 'Color grade' },
  { id: 'hook', label: 'Hook' },
  { id: 'sound', label: 'Hook sound' },
  { id: 'story', label: 'Full story cue' },
  { id: 'origin', label: 'Timely or carryover' },
  { id: 'score', label: 'Our score' },
];

/** A group smaller than this stays visible and is marked thin. */
export const THIN_SAMPLE = 3;

export type MetricField =
  | 'views'
  | 'reach'
  | 'likes'
  | 'comments'
  | 'saved'
  | 'shares'
  | 'reposts'
  | 'totalInteractions'
  | 'avgWatchTimeMs'
  | 'totalWatchTimeMs'
  | 'skipRate';

export type PerformanceSnapshot = {
  nyDate: string;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  reposts: number | null;
  totalInteractions: number | null;
  avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null;
  skipRate: number | null;
  sharedToFeed: boolean | null;
};

export type PerformanceReel = {
  attemptId: string;
  mediaId: string;
  postIdeaId: string;
  videoJobId: string | null;
  finishedAt: string;
  permalink: string | null;
  title: string;
  subtitle: string | null;
  onScreenCopy: string | null;
  caption: string | null;
  songTitle: string | null;
  songArtist: string | null;
  genre: string | null;
  audioType: string | null;
  slot: string;
  slotLabel: string;
  framework: string | null;
  bucket: string | null;
  blockbuster: boolean | null;
  net: number | null;
  origin: string | null;
  color: string | null;
  hook: string | null;
  hookSound: boolean | null;
  fullStory: boolean | null;
  graduationStrategy: string | null;
  metrics: PerformanceSnapshot | null;
  history: PerformanceSnapshot[];
};

export type PerformanceStat = {
  id: string;
  label: string;
  value: number | null;
  aggregate: 'sum' | 'mean';
  display: 'count' | 'duration' | 'rate';
  definition: string;
  reported: number;
  total: number;
  lines: Array<{ id: string; title: string; value: number | null }>;
};

export type FactorGroup = {
  key: string;
  label: string;
  count: number;
  thin: boolean;
  views: number | null;
  skipRate: number | null;
  watchMs: number | null;
  shares: number | null;
  saves: number | null;
};

export type InsightsNotice = {
  blocked: 'permission' | 'token' | 'unconfigured' | null;
  message: string | null;
};

export type PerformancePage = {
  period: PerformancePeriod;
  reels: PerformanceReel[];
  headlines: PerformanceStat[];
  factors: Record<FactorId, FactorGroup[]>;
  hasNumbers: boolean;
  poll: InsightsNotice | null;
};

const FRAMEWORK_LABEL: Record<string, string> = {
  curiosity: 'Curiosity',
  arousal: 'Arousal',
  identity: 'Identity',
};

const BUCKET_LABEL: Record<string, string> = {
  ball_knowledge: 'Ball Knowledge',
  the_number: 'The Number',
  the_saga: 'The Saga',
  personal_profile: 'Personal Profile',
  the_warning: 'The Warning',
  the_callout: 'The Callout',
};

const SLOT_NAME: Record<string, string> = {
  morning: 'Morning',
  midday: 'Midday',
  evening: 'Evening',
  unscheduled: 'Outside a slot',
};

const AUDIO_LABEL: Record<string, string> = {
  music: 'Music',
  original_sound: 'Original sound',
};

const COLOR_LABEL: Record<string, string> = {
  noir: 'Noir',
  paper: 'Paper',
  orange: 'Orange',
  green: 'Green',
};

const HOOK_LABEL: Record<string, string> = {
  glitch: 'Glitch',
  color_bars: 'Color bars',
  invert: 'Invert',
  vhs: 'VHS',
  thermal: 'Thermal',
  blue_screen: 'Blue screen',
  none: 'No hook',
};

const ORIGIN_LABEL: Record<string, string> = {
  timely: 'Timely',
  carryover: 'Carryover',
};

const BLANK = 'A blank stays out of this figure. Meta can take up to 48 hours to return a number.';

const HEADLINES: Array<{
  id: string;
  label: string;
  field: MetricField;
  aggregate: 'sum' | 'mean';
  display: 'count' | 'duration' | 'rate';
  definition: string;
}> = [
  {
    id: 'views',
    label: 'Views',
    field: 'views',
    aggregate: 'sum',
    display: 'count',
    definition: `Times the reel started playing, added across reels published in this window. ${BLANK}`,
  },
  {
    id: 'reach',
    label: 'Reach',
    field: 'reach',
    aggregate: 'sum',
    display: 'count',
    definition: `Accounts that saw the reel, added across reels published in this window. Meta estimates this. ${BLANK}`,
  },
  {
    id: 'watch',
    label: 'Avg watch time',
    field: 'avgWatchTimeMs',
    aggregate: 'mean',
    display: 'duration',
    definition: `Average of each reel's own average watch time. ${BLANK}`,
  },
  {
    id: 'skip',
    label: 'Skip rate',
    field: 'skipRate',
    aggregate: 'mean',
    display: 'rate',
    definition: `Share of plays that left in the first 3 seconds, averaged across reels that reported it. ${BLANK}`,
  },
  {
    id: 'shares',
    label: 'Shares',
    field: 'shares',
    aggregate: 'sum',
    display: 'count',
    definition: `Times someone sent the reel, added across reels published in this window. ${BLANK}`,
  },
  {
    id: 'saves',
    label: 'Saves',
    field: 'saved',
    aggregate: 'sum',
    display: 'count',
    definition: `Times someone saved the reel, added across reels published in this window. ${BLANK}`,
  },
];

export function performancePeriod(value: string | undefined): PerformancePeriod {
  if (value === '30d' || value === 'all') return value;
  return '7d';
}

export function periodDays(period: PerformancePeriod): number | null {
  if (period === '7d') return 7;
  if (period === '30d') return 30;
  return null;
}

/** Null days means every published reel. Otherwise a rolling window ending at `now`. */
export function publishedSince(days: number | null, now: Date): Date | null {
  if (days == null) return null;
  return new Date(now.getTime() - days * 86_400_000);
}

export function performanceHref(period: PerformancePeriod): string {
  if (period === '7d') return '/reels/analytics/performance';
  return `/reels/analytics/performance?period=${period}`;
}

export function reelTitle(onScreen: string | null | undefined, headline: string | null | undefined): string {
  const line = onScreen?.split('\n').map((part) => part.trim()).find(Boolean);
  if (line) return line;
  const head = headline?.trim();
  if (head) return head;
  return 'Untitled reel';
}

/** First line of the motion record written by `motionRecord`. Missing lines stay unknown. */
export function parseMotionFactors(motionPrompt: string | null | undefined): { hook: string | null; hookSound: boolean | null } {
  if (!motionPrompt) return { hook: null, hookSound: null };
  const hook = motionPrompt.match(/^Hook:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const sfx = motionPrompt.match(/^Hook SFX:\s*(.+)$/m)?.[1]?.trim() ?? null;
  return {
    hook: hook ? hook.toLowerCase() : null,
    hookSound: sfx == null ? null : sfx.toLowerCase() !== 'none' && sfx.length > 0,
  };
}

export function withHistory(
  reel: Omit<PerformanceReel, 'metrics' | 'history'>,
  history: PerformanceSnapshot[],
): PerformanceReel {
  const ordered = [...history].sort((a, b) => a.nyDate.localeCompare(b.nyDate));
  return { ...reel, history: ordered, metrics: ordered.length ? ordered[ordered.length - 1]! : null };
}

export function metric(reel: PerformanceReel, field: MetricField): number | null {
  const value = reel.metrics?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function sumReported(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0);
}

export function mean(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function descNullLast(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

function ascNullLast(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

export function sortReels(reels: readonly PerformanceReel[], sort: ReelSort): PerformanceReel[] {
  const copy = [...reels];
  copy.sort((a, b) => {
    if (sort === 'hook') {
      const skip = ascNullLast(metric(a, 'skipRate'), metric(b, 'skipRate'));
      if (skip !== 0) return skip;
      const watch = descNullLast(metric(a, 'avgWatchTimeMs'), metric(b, 'avgWatchTimeMs'));
      if (watch !== 0) return watch;
    } else {
      const shares = descNullLast(metric(a, 'shares'), metric(b, 'shares'));
      if (shares !== 0) return shares;
      const saves = descNullLast(metric(a, 'saved'), metric(b, 'saved'));
      if (saves !== 0) return saves;
      const views = descNullLast(metric(a, 'views'), metric(b, 'views'));
      if (views !== 0) return views;
    }
    const posted = b.finishedAt.localeCompare(a.finishedAt);
    if (posted !== 0) return posted;
    const title = a.title.localeCompare(b.title);
    if (title !== 0) return title;
    return a.attemptId.localeCompare(b.attemptId);
  });
  return copy;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function named(value: string | null, labels: Record<string, string>, empty: string): { key: string; label: string } {
  if (!value) return { key: 'unknown', label: empty };
  return { key: value, label: labels[value] ?? value };
}

function factorSeed(reel: PerformanceReel, factor: FactorId, scoreMedian: number | null): { key: string; label: string } {
  switch (factor) {
    case 'psychology':
      return named(reel.framework, FRAMEWORK_LABEL, 'Unknown');
    case 'bucket':
      return named(reel.bucket, BUCKET_LABEL, 'Unknown');
    case 'blockbuster':
      if (reel.blockbuster == null) return { key: 'unknown', label: 'Unknown' };
      return reel.blockbuster
        ? { key: 'yes', label: 'Blockbuster' }
        : { key: 'no', label: 'Not a blockbuster' };
    case 'slot':
      return named(reel.slot, SLOT_NAME, 'Outside a slot');
    case 'audio':
      return named(reel.audioType, AUDIO_LABEL, 'Unknown');
    case 'genre': {
      const genre = reel.genre?.trim();
      if (!genre) return { key: 'unknown', label: 'Unknown' };
      return { key: genre, label: genre };
    }
    case 'color':
      return named(reel.color, COLOR_LABEL, 'Unknown');
    case 'hook':
      return named(reel.hook, HOOK_LABEL, 'Unknown');
    case 'sound':
      if (reel.hookSound == null) return { key: 'unknown', label: 'Unknown' };
      return reel.hookSound ? { key: 'on', label: 'Hook sound' } : { key: 'off', label: 'No hook sound' };
    case 'story':
      if (reel.fullStory == null) return { key: 'unknown', label: 'Unknown' };
      return reel.fullStory ? { key: 'on', label: 'Full story cue' } : { key: 'off', label: 'No cue' };
    case 'origin':
      return named(reel.origin, ORIGIN_LABEL, 'Unknown');
    case 'score':
      if (reel.net == null || scoreMedian == null) return { key: 'unscored', label: 'Unscored' };
      return reel.net >= scoreMedian
        ? { key: 'above', label: 'At or above the median' }
        : { key: 'below', label: 'Below the median' };
    default:
      return { key: 'unknown', label: 'Unknown' };
  }
}

export function factorGroups(reels: readonly PerformanceReel[], factor: FactorId): FactorGroup[] {
  const scoreMedian = factor === 'score'
    ? median(reels.map((reel) => reel.net).filter((net): net is number => net != null && Number.isFinite(net)))
    : null;
  const buckets = new Map<string, { label: string; reels: PerformanceReel[] }>();
  for (const reel of reels) {
    const seed = factorSeed(reel, factor, scoreMedian);
    const existing = buckets.get(seed.key);
    if (existing) existing.reels.push(reel);
    else buckets.set(seed.key, { label: seed.label, reels: [reel] });
  }
  const groups: FactorGroup[] = [...buckets.entries()].map(([key, group]) => ({
    key,
    label: group.label,
    count: group.reels.length,
    thin: group.reels.length < THIN_SAMPLE,
    views: mean(group.reels.map((reel) => metric(reel, 'views'))),
    skipRate: mean(group.reels.map((reel) => metric(reel, 'skipRate'))),
    watchMs: mean(group.reels.map((reel) => metric(reel, 'avgWatchTimeMs'))),
    shares: mean(group.reels.map((reel) => metric(reel, 'shares'))),
    saves: mean(group.reels.map((reel) => metric(reel, 'saved'))),
  }));
  groups.sort((a, b) => descNullLast(a.shares, b.shares) || a.label.localeCompare(b.label));
  return groups;
}

export function buildHeadlines(reels: readonly PerformanceReel[]): PerformanceStat[] {
  return HEADLINES.map((spec) => {
    const values = reels.map((reel) => metric(reel, spec.field));
    const reported = values.filter((value) => value != null).length;
    const lines = [...reels]
      .map((reel) => ({ id: reel.attemptId, title: reel.title, value: metric(reel, spec.field) }))
      .sort((a, b) => descNullLast(a.value, b.value) || a.title.localeCompare(b.title));
    return {
      id: spec.id,
      label: spec.label,
      value: spec.aggregate === 'sum' ? sumReported(values) : mean(values),
      aggregate: spec.aggregate,
      display: spec.display,
      definition: spec.definition,
      reported,
      total: reels.length,
      lines,
    };
  });
}

export function hasPerformanceNumbers(reels: readonly PerformanceReel[]): boolean {
  return reels.some((reel) => HEADLINES.some((spec) => metric(reel, spec.field) != null));
}

export function buildFactors(reels: readonly PerformanceReel[]): Record<FactorId, FactorGroup[]> {
  return Object.fromEntries(FACTOR_OPTIONS.map((option) => [option.id, factorGroups(reels, option.id)])) as Record<FactorId, FactorGroup[]>;
}

function labelOf(value: string | null, labels: Record<string, string>): string {
  if (!value) return '—';
  return labels[value] ?? value;
}

export function creationFacts(reel: PerformanceReel): Array<{ label: string; value: string }> {
  const graduation = reel.graduationStrategy === 'SS_PERFORMANCE'
    ? 'Instagram can still graduate this one on its own'
    : reel.graduationStrategy === 'MANUAL'
      ? 'Stays a trial until someone graduates it in the Instagram app'
      : '—';
  return [
    { label: 'Psychology', value: labelOf(reel.framework, FRAMEWORK_LABEL) },
    { label: 'Content bucket', value: labelOf(reel.bucket, BUCKET_LABEL) },
    { label: 'Blockbuster', value: reel.blockbuster == null ? '—' : reel.blockbuster ? 'Blockbuster' : 'Not a blockbuster' },
    { label: 'Net score', value: reel.net == null ? '—' : reel.net.toFixed(2) },
    { label: 'Posting slot', value: reel.slotLabel || '—' },
    { label: 'Color grade', value: labelOf(reel.color, COLOR_LABEL) },
    { label: 'Hook', value: labelOf(reel.hook, HOOK_LABEL) },
    { label: 'Hook sound', value: reel.hookSound == null ? '—' : reel.hookSound ? 'Hook sound' : 'No hook sound' },
    { label: 'Full story cue', value: reel.fullStory == null ? '—' : reel.fullStory ? 'Full story cue' : 'No cue' },
    { label: 'Origin', value: labelOf(reel.origin, ORIGIN_LABEL) },
    { label: 'Audio', value: labelOf(reel.audioType, AUDIO_LABEL) },
    { label: 'Song genre', value: reel.genre?.trim() || '—' },
    { label: 'Graduation', value: graduation },
  ];
}

export function gridNote(shared: boolean | null): string {
  if (shared === true) return 'This reel is on the grid.';
  if (shared === false) return 'This reel is still a trial. Graduate it in the Instagram app.';
  return 'Graduation happens in the Instagram app. This page marks the reel once Instagram reports it on the grid.';
}
