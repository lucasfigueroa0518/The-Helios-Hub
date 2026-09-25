import type { SeoDimension, SeoPeriod, SeoSearchType } from '@/lib/seo/types';
import { SEO_DIMENSIONS, SEO_PERIODS, SEO_SEARCH_TYPES } from '@/lib/seo/types';

const ISO3_TO_ISO2: Record<string, string> = {
  USA: 'US', GBR: 'GB', FRA: 'FR', DEU: 'DE', CAN: 'CA', AUS: 'AU',
  IND: 'IN', PHL: 'PH', VNM: 'VN', IDN: 'ID', MYS: 'MY', SGP: 'SG',
  BRA: 'BR', MEX: 'MX', ESP: 'ES', ITA: 'IT', NLD: 'NL', IRL: 'IE',
  SWE: 'SE', NOR: 'NO', DNK: 'DK', FIN: 'FI', CHE: 'CH', AUT: 'AT',
  BEL: 'BE', PRT: 'PT', POL: 'PL', CZE: 'CZ', ROU: 'RO', HUN: 'HU',
  GRC: 'GR', TUR: 'TR', ISR: 'IL', ARE: 'AE', SAU: 'SA', ZAF: 'ZA',
  NGA: 'NG', EGY: 'EG', KEN: 'KE', JPN: 'JP', KOR: 'KR', CHN: 'CN',
  TWN: 'TW', HKG: 'HK', THA: 'TH', ARG: 'AR', CHL: 'CL', COL: 'CO',
  PER: 'PE', NZL: 'NZ', PAK: 'PK', BGD: 'BD', LKA: 'LK', NPL: 'NP',
  UKR: 'UA', RUS: 'RU', KAZ: 'KZ', QAT: 'QA', KWT: 'KW', JOR: 'JO',
};

const DEVICE_LABELS: Record<string, string> = {
  DESKTOP: 'Desktop',
  MOBILE: 'Mobile',
  TABLET: 'Tablet',
};

export function isSeoSearchType(value: string | null | undefined): value is SeoSearchType {
  return Boolean(value && (SEO_SEARCH_TYPES as readonly string[]).includes(value));
}

export function parseSearchType(value: string | null | undefined): SeoSearchType {
  return isSeoSearchType(value) ? value : 'web';
}

export function isSeoDimension(value: string | null | undefined): value is SeoDimension {
  return Boolean(value && (SEO_DIMENSIONS as readonly string[]).includes(value));
}

export function parsePeriod(value: string | null | undefined): SeoPeriod {
  return value && (SEO_PERIODS as readonly string[]).includes(value)
    ? (value as SeoPeriod)
    : '3m';
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addUtcDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function resolveSeoRange(input: {
  period: SeoPeriod;
  from?: string | null;
  to?: string | null;
  latestAvailable?: string | null;
}): { from: string; to: string } {
  const latest = input.latestAvailable && /^\d{4}-\d{2}-\d{2}$/.test(input.latestAvailable)
    ? input.latestAvailable
    : isoDate(new Date());

  if (input.period === 'custom') {
    const from = input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from) ? input.from : addUtcDays(latest, -27);
    const to = input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? input.to : latest;
    if (from > to) throw new Error('from must be on or before to');
    return { from, to };
  }

  if (input.period === '24h') return { from: latest, to: latest };
  if (input.period === '7d') return { from: addUtcDays(latest, -6), to: latest };
  if (input.period === '28d') return { from: addUtcDays(latest, -27), to: latest };
  return { from: addUtcDays(latest, -89), to: latest };
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

export function weightedMetrics(rows: Array<{
  clicks: number;
  impressions: number;
  position: number;
}>): { clicks: number; impressions: number; ctr: number; position: number } {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const positionWeight = rows.reduce((sum, row) => sum + row.position * row.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? positionWeight / impressions : 0,
  };
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

export function formatCtr(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export function formatPosition(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return value.toFixed(1);
}

export function countryDisplayName(iso3: string): string {
  const code = iso3.trim().toUpperCase();
  const iso2 = ISO3_TO_ISO2[code];
  if (iso2) {
    try {
      const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(iso2);
      if (name) return name;
    } catch {
      // fall through
    }
  }
  return code;
}

export function deviceDisplayName(value: string): string {
  return DEVICE_LABELS[value.toUpperCase()] ?? value;
}

export function appearanceDisplayName(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function dimensionLabel(dimension: SeoDimension | 'date', key: string): string {
  if (dimension === 'country') return countryDisplayName(key);
  if (dimension === 'device') return deviceDisplayName(key);
  if (dimension === 'search_appearance') return appearanceDisplayName(key);
  if (dimension === 'date') {
    const date = new Date(`${key}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return key;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  return key;
}

export function csvEscape(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function propertyLabel(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return siteUrl.slice('sc-domain:'.length);
  try {
    return new URL(siteUrl).hostname || siteUrl;
  } catch {
    return siteUrl;
  }
}
