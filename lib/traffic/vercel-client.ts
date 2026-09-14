import type { TrafficDimension, TrafficDimensionRow } from '@/lib/traffic/types';
import { dimensionLabel } from '@/lib/traffic/format';

const AGGREGATE_URL = 'https://api.vercel.com/v1/query/web-analytics/visits/aggregate';
const DIMENSION_LIMIT = 10;
const SERIES_LIMIT = 100;

export type VercelTrafficConfig = {
  token: string;
  teamId: string | null;
  projectId: string;
};

export class VercelTrafficError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'VercelTrafficError';
    this.status = status;
  }
}

export function getVercelTrafficConfig(): VercelTrafficConfig | null {
  const token = process.env.VERCEL_TOKEN?.trim() || '';
  const projectId = process.env.VERCEL_PROJECT_ID?.trim() || '';
  const teamId = process.env.VERCEL_ORG_ID?.trim() || null;
  if (!token || !projectId) return null;
  return { token, teamId, projectId };
}

type AggregateRow = Record<string, unknown> & {
  timestamp?: string;
  visitors?: number;
  pageviews?: number;
};

type AggregateResponse = {
  data?: AggregateRow[];
  error?: { message?: string; code?: string };
};

export type DailyAggregate = {
  date: string;
  visitors: number;
  pageviews: number;
};

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isoFromTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function vercelFetch(config: VercelTrafficConfig, params: URLSearchParams): Promise<AggregateResponse> {
  const maxAttempts = 5;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`${AGGREGATE_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      cache: 'no-store',
    });
    if (response.status === 429 || response.status >= 500) {
      lastError = new VercelTrafficError(`Vercel Analytics API ${response.status}`, response.status);
      await new Promise((resolve) => setTimeout(resolve, 400 * (2 ** (attempt - 1))));
      continue;
    }
    const body = await response.text().catch(() => '');
    let parsed: AggregateResponse = {};
    if (body) {
      try {
        parsed = JSON.parse(body) as AggregateResponse;
      } catch {
        parsed = {};
      }
    }
    if (!response.ok) {
      const message = parsed.error?.message || body.slice(0, 400) || `Vercel Analytics API ${response.status}`;
      throw new VercelTrafficError(message, response.status);
    }
    return parsed;
  }
  throw lastError ?? new VercelTrafficError('Vercel Analytics API request failed');
}

function baseParams(
  config: VercelTrafficConfig,
  range: { from: string; to: string },
  filter: string | undefined,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('projectId', config.projectId);
  if (config.teamId) params.set('teamId', config.teamId);
  params.set('since', `${range.from}T00:00:00.000Z`);
  params.set('until', `${range.to}T23:59:59.999Z`);
  if (filter) params.set('filter', filter);
  return params;
}

export async function aggregateByDay(
  config: VercelTrafficConfig,
  range: { from: string; to: string },
  filter?: string,
): Promise<DailyAggregate[]> {
  const params = baseParams(config, range, filter);
  params.set('by', 'day');
  params.set('limit', String(SERIES_LIMIT));
  const payload = await vercelFetch(config, params);
  return (payload.data ?? [])
    .map((row) => {
      const date = isoFromTimestamp(row.timestamp);
      if (!date) return null;
      return {
        date,
        visitors: asNumber(row.visitors),
        pageviews: asNumber(row.pageviews),
      };
    })
    .filter((row): row is DailyAggregate => Boolean(row));
}

function rowKey(row: AggregateRow, dimension: TrafficDimension): string {
  const raw = row[dimension];
  const value = typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw);
  if (dimension === 'referrerHostname' && !value.trim()) return 'direct';
  return value.trim() || 'Others';
}

export async function aggregateByDimension(
  config: VercelTrafficConfig,
  range: { from: string; to: string },
  dimension: TrafficDimension,
  filter?: string,
): Promise<TrafficDimensionRow[]> {
  const params = baseParams(config, range, filter);
  params.set('by', dimension);
  params.set('limit', String(DIMENSION_LIMIT));
  const payload = await vercelFetch(config, params);
  return (payload.data ?? []).map((row) => {
    const key = rowKey(row, dimension) || 'Others';
    return {
      key,
      label: dimensionLabel(dimension, key),
      visitors: asNumber(row.visitors),
      pageviews: asNumber(row.pageviews),
    };
  });
}

export async function aggregateByDimensionSafe(
  config: VercelTrafficConfig,
  range: { from: string; to: string },
  dimension: TrafficDimension,
  filter?: string,
): Promise<TrafficDimensionRow[]> {
  try {
    return await aggregateByDimension(config, range, dimension, filter);
  } catch (error) {
    if (error instanceof VercelTrafficError && error.status !== 401 && error.status < 500) {
      return [];
    }
    throw error;
  }
}
