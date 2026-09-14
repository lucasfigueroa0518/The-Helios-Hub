import {
  combineOdata,
  eachIsoDate,
  environmentFilter,
  filtersToOdata,
  pagesPerVisitor,
  percentDelta,
  previousRange as previousWindow,
} from '@/lib/traffic/format';
import type {
  TrafficBreakdowns,
  TrafficDailyPoint,
  TrafficEnvironment,
  TrafficFilter,
  TrafficMetrics,
  TrafficSummaryResponse,
} from '@/lib/traffic/types';
import {
  aggregateByDay,
  aggregateByDimension,
  aggregateByDimensionSafe,
  getVercelTrafficConfig,
  VercelTrafficError,
  type VercelTrafficConfig,
} from '@/lib/traffic/vercel-client';

const CACHE_TTL_MS = 60_000;

type CacheEntry = { expires: number; value: TrafficSummaryResponse };
const cache = new Map<string, CacheEntry>();

const EMPTY_BREAKDOWNS: TrafficBreakdowns = {
  requestPath: [],
  route: [],
  referrerHostname: [],
  utmSource: [],
  utmMedium: [],
  utmCampaign: [],
  country: [],
  deviceType: [],
  browserName: [],
  osName: [],
};

function emptyMetrics(): TrafficMetrics {
  return { visitors: 0, pageviews: 0, pagesPerVisitor: 0 };
}

function metricsFromSeries(series: TrafficDailyPoint[]): TrafficMetrics {
  const visitors = series.reduce((sum, point) => sum + point.visitors, 0);
  const pageviews = series.reduce((sum, point) => sum + point.pageviews, 0);
  return { visitors, pageviews, pagesPerVisitor: pagesPerVisitor(pageviews, visitors) };
}

function fillSeries(range: { from: string; to: string }, rows: TrafficDailyPoint[]): TrafficDailyPoint[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return eachIsoDate(range.from, range.to).map((date) => (
    byDate.get(date) ?? { date, visitors: 0, pageviews: 0 }
  ));
}

export function emptyTrafficSummary(input: {
  range: { from: string; to: string };
  environment: TrafficEnvironment;
  filters: TrafficFilter[];
  configured: boolean;
  error: string | null;
}): TrafficSummaryResponse {
  return {
    configured: input.configured,
    range: input.range,
    previousRange: previousWindow(input.range),
    environment: input.environment,
    filters: input.filters,
    totals: emptyMetrics(),
    previousTotals: emptyMetrics(),
    deltas: { visitors: null, pageviews: null, pagesPerVisitor: null },
    series: [],
    breakdowns: EMPTY_BREAKDOWNS,
    error: input.error,
  };
}

function cacheKey(input: {
  range: { from: string; to: string };
  environment: TrafficEnvironment;
  filters: TrafficFilter[];
  projectId: string;
}): string {
  return JSON.stringify({
    projectId: input.projectId,
    from: input.range.from,
    to: input.range.to,
    environment: input.environment,
    filters: input.filters,
  });
}

function readCache(key: string): TrafficSummaryResponse | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

async function fetchSummary(
  config: VercelTrafficConfig,
  range: { from: string; to: string },
  environment: TrafficEnvironment,
  filters: TrafficFilter[],
): Promise<TrafficSummaryResponse> {
  const filter = combineOdata([environmentFilter(environment), filtersToOdata(filters)]);
  const prior = previousWindow(range);

  const [
    currentDays,
    previousDays,
    requestPath,
    route,
    referrerHostname,
    utmSource,
    utmMedium,
    utmCampaign,
    country,
    deviceType,
    browserName,
    osName,
  ] = await Promise.all([
    aggregateByDay(config, range, filter),
    aggregateByDay(config, prior, filter),
    aggregateByDimension(config, range, 'requestPath', filter),
    aggregateByDimension(config, range, 'route', filter),
    aggregateByDimension(config, range, 'referrerHostname', filter),
    aggregateByDimensionSafe(config, range, 'utmSource', filter),
    aggregateByDimensionSafe(config, range, 'utmMedium', filter),
    aggregateByDimensionSafe(config, range, 'utmCampaign', filter),
    aggregateByDimension(config, range, 'country', filter),
    aggregateByDimension(config, range, 'deviceType', filter),
    aggregateByDimension(config, range, 'browserName', filter),
    aggregateByDimension(config, range, 'osName', filter),
  ]);

  const series = fillSeries(range, currentDays);
  const previousSeries = fillSeries(prior, previousDays);
  const totals = metricsFromSeries(series);
  const previousTotals = metricsFromSeries(previousSeries);

  return {
    configured: true,
    range,
    previousRange: prior,
    environment,
    filters,
    totals,
    previousTotals,
    deltas: {
      visitors: percentDelta(totals.visitors, previousTotals.visitors),
      pageviews: percentDelta(totals.pageviews, previousTotals.pageviews),
      pagesPerVisitor: percentDelta(totals.pagesPerVisitor, previousTotals.pagesPerVisitor),
    },
    series,
    breakdowns: {
      requestPath,
      route,
      referrerHostname,
      utmSource,
      utmMedium,
      utmCampaign,
      country,
      deviceType,
      browserName,
      osName,
    },
    error: null,
  };
}

export async function loadTrafficSummary(input: {
  range: { from: string; to: string };
  environment: TrafficEnvironment;
  filters: TrafficFilter[];
}): Promise<TrafficSummaryResponse> {
  const config = getVercelTrafficConfig();
  if (!config) {
    return emptyTrafficSummary({
      ...input,
      configured: false,
      error: 'Vercel Analytics is not configured. Add VERCEL_TOKEN, VERCEL_ORG_ID, and VERCEL_PROJECT_ID.',
    });
  }

  const key = cacheKey({ ...input, projectId: config.projectId });
  const cached = readCache(key);
  if (cached) return cached;

  try {
    const value = await fetchSummary(config, input.range, input.environment, input.filters);
    cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
    return value;
  } catch (error) {
    if (error instanceof VercelTrafficError && (error.status === 401 || error.status === 403)) {
      return emptyTrafficSummary({
        ...input,
        configured: true,
        error: 'Vercel rejected the analytics token. Check VERCEL_TOKEN, team, and project access.',
      });
    }
    throw error;
  }
}
