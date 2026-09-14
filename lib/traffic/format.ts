import {
  TRAFFIC_DIMENSIONS,
  TRAFFIC_ENVIRONMENTS,
  TRAFFIC_PERIODS,
  type TrafficDimension,
  type TrafficEnvironment,
  type TrafficFilter,
  type TrafficPeriod,
} from '@/lib/traffic/types';

export function isTrafficPeriod(value: string | null | undefined): value is TrafficPeriod {
  return Boolean(value && (TRAFFIC_PERIODS as readonly string[]).includes(value));
}

export function parsePeriod(value: string | null | undefined): TrafficPeriod {
  return isTrafficPeriod(value) ? value : '7d';
}

export function isTrafficEnvironment(value: string | null | undefined): value is TrafficEnvironment {
  return Boolean(value && (TRAFFIC_ENVIRONMENTS as readonly string[]).includes(value));
}

export function parseEnvironment(value: string | null | undefined): TrafficEnvironment {
  return isTrafficEnvironment(value) ? value : 'production';
}

export function isTrafficDimension(value: string | null | undefined): value is TrafficDimension {
  return Boolean(value && (TRAFFIC_DIMENSIONS as readonly string[]).includes(value));
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addUtcDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function inclusiveDayCount(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.round((end - start) / 864e5) + 1;
}

export function resolveTrafficRange(input: {
  period: TrafficPeriod;
  from?: string | null;
  to?: string | null;
  latestAvailable?: string | null;
}): { from: string; to: string } {
  const latest = input.latestAvailable && /^\d{4}-\d{2}-\d{2}$/.test(input.latestAvailable)
    ? input.latestAvailable
    : isoDate(new Date());

  if (input.period === 'custom') {
    const from = input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from) ? input.from : addUtcDays(latest, -6);
    const to = input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? input.to : latest;
    if (from > to) throw new Error('from must be on or before to');
    return { from, to };
  }

  if (input.period === '24h') return { from: latest, to: latest };
  if (input.period === '7d') return { from: addUtcDays(latest, -6), to: latest };
  if (input.period === '28d') return { from: addUtcDays(latest, -27), to: latest };
  return { from: addUtcDays(latest, -89), to: latest };
}

export function previousRange(range: { from: string; to: string }): { from: string; to: string } {
  const days = inclusiveDayCount(range.from, range.to);
  const to = addUtcDays(range.from, -1);
  return { from: addUtcDays(to, -(days - 1)), to };
}

export function eachIsoDate(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addUtcDays(cursor, 1);
  }
  return dates;
}

export function pagesPerVisitor(pageviews: number, visitors: number): number {
  if (!Number.isFinite(pageviews) || !Number.isFinite(visitors) || visitors <= 0) return 0;
  return pageviews / visitors;
}

export function percentDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimNumber(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimNumber(value / 1_000)}K`;
  return String(Math.round(value));
}

function trimNumber(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

export function formatPagesPerVisitor(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return value.toFixed(2).replace(/\.?0+$/, '');
}

export function formatDeltaPercent(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.abs(value) >= 10 ? Math.round(value) : Number(value.toFixed(1));
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
}

export function odataEq(dimension: string, value: string): string {
  return `${dimension} eq '${value.replace(/'/g, "''")}'`;
}

export function environmentFilter(environment: TrafficEnvironment): string | null {
  if (environment === 'all') return null;
  return odataEq('environment', environment);
}

export function combineOdata(parts: Array<string | null | undefined>): string | undefined {
  const list = parts.filter((part): part is string => Boolean(part && part.trim()));
  return list.length ? list.join(' and ') : undefined;
}

export function filtersToOdata(filters: TrafficFilter[]): string | null {
  if (!filters.length) return null;
  return combineOdata(filters.map((filter) => odataEq(filter.dimension, filter.value))) ?? null;
}

export function parseFiltersParam(value: string | null | undefined): TrafficFilter[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const filters: TrafficFilter[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const dimension = (item as { dimension?: unknown }).dimension;
      const key = (item as { value?: unknown }).value;
      if (!isTrafficDimension(typeof dimension === 'string' ? dimension : null)) continue;
      if (typeof key !== 'string' || !key.trim() || key === 'Others') continue;
      filters.push({ dimension, value: key.trim() });
    }
    return filters;
  } catch {
    return [];
  }
}

export function countryDisplayName(code: string): string {
  const trimmed = code.trim();
  if (!trimmed || trimmed === 'Others') return trimmed || 'Unknown';
  const iso2 = trimmed.length === 2 ? trimmed.toUpperCase() : trimmed;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(iso2);
    if (name) return name;
  } catch {
    // fall through
  }
  return trimmed;
}

const DEVICE_LABELS: Record<string, string> = {
  desktop: 'Desktop',
  mobile: 'Mobile',
  tablet: 'Tablet',
  console: 'Console',
  smarttv: 'Smart TV',
};

const OS_LABELS: Record<string, string> = {
  mac: 'Mac',
  macos: 'Mac',
  darwin: 'Mac',
  win: 'Windows',
  windows: 'Windows',
  ios: 'iOS',
  android: 'Android',
  linux: 'GNU/Linux',
  'gnu/linux': 'GNU/Linux',
};

export function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function dimensionLabel(dimension: TrafficDimension, key: string): string {
  if (!key || key === 'Others') return key || 'Unknown';
  if (dimension === 'country') return countryDisplayName(key);
  if (dimension === 'deviceType') return DEVICE_LABELS[key.toLowerCase()] ?? titleCase(key);
  if (dimension === 'osName') return OS_LABELS[key.toLowerCase()] ?? titleCase(key);
  if (dimension === 'browserName') return titleCase(key);
  if (dimension === 'referrerHostname' && (key === '' || key === 'direct')) return 'Direct';
  return key;
}
