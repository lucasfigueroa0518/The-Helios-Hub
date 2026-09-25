export const SEO_SEARCH_TYPES = [
  'web',
  'image',
  'video',
  'news',
  'discover',
  'googleNews',
] as const;

export type SeoSearchType = (typeof SEO_SEARCH_TYPES)[number];

export const SEO_DIMENSIONS = [
  'query',
  'page',
  'country',
  'device',
  'search_appearance',
] as const;

export type SeoDimension = (typeof SEO_DIMENSIONS)[number];

export const SEO_PERIODS = ['24h', '7d', '28d', '3m', 'custom'] as const;
export type SeoPeriod = (typeof SEO_PERIODS)[number];

export type SeoBreakdownTab = SeoDimension | 'date';

export type SeoMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SeoProperty = {
  id: string;
  site_url: string;
  permission_level: string | null;
  last_synced_at: string | null;
};

export type SeoDailyPoint = SeoMetrics & { date: string };

export type SeoDimensionRow = SeoMetrics & { key: string; label: string };

export type SeoSyncRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'succeeded' | 'failed';
  newest_date: string | null;
  properties_synced: number;
  days_pulled: number;
  error: string | null;
};

export type SeoSitemap = {
  id: string;
  path: string;
  last_submitted_at: string | null;
  last_downloaded_at: string | null;
  is_pending: boolean;
  is_sitemaps_index: boolean;
  errors: number;
  warnings: number;
};

export type SeoSummaryResponse = {
  property: SeoProperty | null;
  properties: SeoProperty[];
  range: { from: string; to: string };
  searchType: SeoSearchType;
  totals: SeoMetrics;
  series: SeoDailyPoint[];
  latestAvailableDate: string | null;
  lastSyncedAt: string | null;
  sync: SeoSyncRun | null;
};

export type SeoRowsResponse = {
  dimension: SeoBreakdownTab;
  rows: SeoDimensionRow[];
  total: number;
};

export type GscAnalyticsRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscSite = {
  siteUrl: string;
  permissionLevel?: string;
};

export type GscSitemap = {
  path: string;
  lastSubmitted?: string | null;
  lastDownloaded?: string | null;
  isPending?: boolean;
  isSitemapsIndex?: boolean;
  errors?: number;
  warnings?: number;
  contents?: unknown;
};
