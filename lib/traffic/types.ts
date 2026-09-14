export const TRAFFIC_PERIODS = ['24h', '7d', '28d', '3m', 'custom'] as const;
export type TrafficPeriod = (typeof TRAFFIC_PERIODS)[number];

export const TRAFFIC_ENVIRONMENTS = ['production', 'preview', 'all'] as const;
export type TrafficEnvironment = (typeof TRAFFIC_ENVIRONMENTS)[number];

export const TRAFFIC_DIMENSIONS = [
  'requestPath',
  'route',
  'referrerHostname',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'country',
  'deviceType',
  'browserName',
  'osName',
] as const;
export type TrafficDimension = (typeof TRAFFIC_DIMENSIONS)[number];

export type TrafficFilter = {
  dimension: TrafficDimension;
  value: string;
};

export type TrafficMetrics = {
  visitors: number;
  pageviews: number;
  pagesPerVisitor: number;
};

export type TrafficDeltas = {
  visitors: number | null;
  pageviews: number | null;
  pagesPerVisitor: number | null;
};

export type TrafficDailyPoint = {
  date: string;
  visitors: number;
  pageviews: number;
};

export type TrafficDimensionRow = {
  key: string;
  label: string;
  visitors: number;
  pageviews: number;
};

export type TrafficBreakdowns = {
  requestPath: TrafficDimensionRow[];
  route: TrafficDimensionRow[];
  referrerHostname: TrafficDimensionRow[];
  utmSource: TrafficDimensionRow[];
  utmMedium: TrafficDimensionRow[];
  utmCampaign: TrafficDimensionRow[];
  country: TrafficDimensionRow[];
  deviceType: TrafficDimensionRow[];
  browserName: TrafficDimensionRow[];
  osName: TrafficDimensionRow[];
};

export type TrafficSummaryResponse = {
  configured: boolean;
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  environment: TrafficEnvironment;
  filters: TrafficFilter[];
  totals: TrafficMetrics;
  previousTotals: TrafficMetrics;
  deltas: TrafficDeltas;
  series: TrafficDailyPoint[];
  breakdowns: TrafficBreakdowns;
  error: string | null;
};
