import { resolveUsState } from '@/lib/auto-campaigns/geography';
import { APOLLO_SENIORITIES, type LeadAttributes } from '@/lib/auto-campaigns/types';

export const APOLLO_EMPLOYEE_BANDS = [
  { range: '1,10', min: 1, max: 10 },
  { range: '11,50', min: 11, max: 50 },
  { range: '51,200', min: 51, max: 200 },
  { range: '201,500', min: 201, max: 500 },
  { range: '501,1000', min: 501, max: 1000 },
  { range: '1001,10000', min: 1001, max: 10_000 },
] as const;

export type ApolloEmployeeRange = (typeof APOLLO_EMPLOYEE_BANDS)[number]['range'];

export const METRO_ALIASES: Array<{ needles: string[]; locations: string[] }> = [
  { needles: ['greater boston', 'boston metro', 'boston area', 'boston'], locations: ['Boston', 'Massachusetts'] },
  { needles: ['nyc', 'new york city', 'greater new york', 'manhattan'], locations: ['New York'] },
  { needles: ['bay area', 'san francisco bay', 'sf bay', 'sf', 'san francisco'], locations: ['San Francisco', 'California'] },
  { needles: ['dfw', 'dallas fort worth', 'dallas-fort worth', 'dallas'], locations: ['Dallas', 'Texas'] },
  { needles: ['socal', 'southern california', 'la metro', 'los angeles'], locations: ['Los Angeles', 'California'] },
  { needles: ['chicagoland', 'chicago area', 'chicago'], locations: ['Chicago', 'Illinois'] },
  { needles: ['philly', 'philadelphia'], locations: ['Philadelphia', 'Pennsylvania'] },
  { needles: ['dc metro', 'washington dc', 'washington d.c.', 'dmv'], locations: ['District of Columbia'] },
  { needles: ['south florida', 'miami'], locations: ['Miami', 'Florida'] },
  { needles: ['atlanta metro', 'atlanta'], locations: ['Atlanta', 'Georgia'] },
  { needles: ['seattle metro', 'seattle'], locations: ['Seattle', 'Washington'] },
  { needles: ['denver metro', 'denver'], locations: ['Denver', 'Colorado'] },
];

export const EASTERN_US_LOCATIONS = [
  'Maine', 'New Hampshire', 'Vermont', 'Massachusetts', 'Rhode Island',
  'Connecticut', 'New York', 'New Jersey', 'Pennsylvania', 'Delaware',
  'Maryland', 'District of Columbia', 'Virginia', 'West Virginia',
  'North Carolina', 'South Carolina', 'Georgia', 'Florida', 'Alabama', 'Tennessee',
];

const REGION_PRESETS: Array<{ needles: string[]; locations: string[] }> = [
  {
    needles: ['eastern united states', 'eastern us', 'east coast', 'eastern u.s'],
    locations: EASTERN_US_LOCATIONS,
  },
  {
    needles: ['northeast', 'new england'],
    locations: ['Maine', 'New Hampshire', 'Vermont', 'Massachusetts', 'Rhode Island', 'Connecticut', 'New York', 'New Jersey', 'Pennsylvania'],
  },
  {
    needles: ['mid-atlantic', 'mid atlantic'],
    locations: ['Delaware', 'Maryland', 'District of Columbia', 'Virginia', 'West Virginia'],
  },
  {
    needles: ['southeast', 'south east'],
    locations: ['North Carolina', 'South Carolina', 'Georgia', 'Florida', 'Alabama', 'Tennessee'],
  },
];

const SENIORITY_ALIASES: Array<{ needles: string[]; value: string; titles?: string[] }> = [
  { needles: ['ceo', 'chief executive', 'c-suite', 'c suite', 'president', 'founder', 'co-founder', 'owner'], value: 'c_suite', titles: ['CEO', 'Founder', 'Co-Founder', 'Owner', 'President'] },
  { needles: ['cto', 'chief technology', 'vp engineering', 'vice president', 'vp'], value: 'vp', titles: ['CTO', 'VP Engineering', 'VP'] },
  { needles: ['director', 'head of', 'head'], value: 'director', titles: ['Director', 'Head'] },
  { needles: ['partner'], value: 'partner', titles: ['Partner'] },
  { needles: ['manager'], value: 'manager' },
  { needles: ['senior'], value: 'senior' },
];

const DECISION_MAKER_NEEDLES = ['decision maker', 'decision-makers', 'decision makers', 'decision-maker'];
const DECISION_MAKER_SENIORITIES = ['owner', 'founder', 'c_suite', 'vp', 'head', 'director'];

const FILLER = /^(companies|company|industry|the|and|of|for)$/i;
const SENIORITY_SET = new Set<string>(APOLLO_SENIORITIES);

export type TargetingParse = {
  industry_tokens: string[];
  seniority_tokens: string[];
  seniority_titles: string[];
  locations: string[];
  size_ranges: string[];
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalizeKey(trimmed);
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    items.push(trimmed);
  }
  return items;
}

export function splitFieldTokens(value: string): string[] {
  return unique(value.split(/[,;/]+/).map((token) => token.trim()).filter(Boolean));
}

function includesPhrase(haystack: string, needle: string): boolean {
  const text = normalizeKey(haystack);
  const pin = normalizeKey(needle);
  if (!text || !pin) return false;
  if (pin.includes(' ')) return text.includes(pin);
  const escaped = pin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(text);
}

function matchNeedles<T extends { needles: string[] }>(text: string, presets: T[]): T | undefined {
  return presets.find((preset) => preset.needles.some((needle) => includesPhrase(text, needle)));
}

function shortenIndustryToken(token: string): string | undefined {
  const cleaned = token.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  const words = cleaned.split(' ').filter((word) => !FILLER.test(word));
  return words.slice(0, 3).join(' ') || undefined;
}

export function parseIndustryTokens(industry: string): string[] {
  const tokens = splitFieldTokens(industry)
    .flatMap((token) => {
      const shortened = shortenIndustryToken(token);
      return shortened ? [shortened] : [];
    });
  return tokens.slice(0, 4);
}

export function parseSeniority(seniority: string): { tokens: string[]; titles: string[] } {
  const parts = splitFieldTokens(seniority);
  const tokens = new Set<string>();
  const titles = new Set<string>();
  const haystack = parts.length ? parts : [seniority];
  for (const part of haystack) {
    if (DECISION_MAKER_NEEDLES.some((needle) => includesPhrase(part, needle))) {
      for (const value of DECISION_MAKER_SENIORITIES) tokens.add(value);
    }
    for (const alias of SENIORITY_ALIASES) {
      if (alias.needles.some((needle) => includesPhrase(part, needle))) {
        tokens.add(alias.value);
        for (const title of alias.titles ?? []) titles.add(title);
      }
    }
    const exact = normalizeKey(part).replace(/[\s-]+/g, '_');
    if (SENIORITY_SET.has(exact)) tokens.add(exact);
  }
  return { tokens: [...tokens], titles: [...titles] };
}

function parseSpan(token: string): { min: number; max: number } | null {
  const key = normalizeKey(token).replace(/,/g, '');
  if (/\b(micro|tiny)\b/.test(key)) return { min: 1, max: 10 };
  if (/\b(small|boutique)\b/.test(key)) return { min: 11, max: 50 };
  if (/\bsmb\b/.test(key)) return { min: 51, max: 200 };
  if (/\b(enterprise|large)\b/.test(key)) return { min: 1001, max: 10_000 };
  const plus = key.match(/^(\d+)\s*\+$/);
  if (plus) return { min: Number(plus[1]), max: 10_000 };
  const range = key.match(/(\d+)\s*[-–—to]+\s*(\d+)/);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && max >= min) return { min, max };
  }
  const single = key.match(/^(\d+)$/);
  if (single) {
    const n = Number(single[1]);
    if (Number.isFinite(n)) return { min: n, max: n };
  }
  return null;
}

export function parseSizeRanges(businessSize: string): string[] {
  const spans = splitFieldTokens(businessSize)
    .map(parseSpan)
    .filter((span): span is { min: number; max: number } => Boolean(span));
  if (spans.length === 0) {
    const whole = parseSpan(businessSize);
    if (whole) spans.push(whole);
  }
  const ranges: string[] = [];
  for (const band of APOLLO_EMPLOYEE_BANDS) {
    const overlaps = spans.some((span) => band.min <= span.max && band.max >= span.min);
    if (overlaps) ranges.push(band.range);
  }
  return ranges;
}

function expandLocationToken(token: string): string[] {
  const region = matchNeedles(token, REGION_PRESETS);
  if (region) return [...region.locations];
  const metro = matchNeedles(token, METRO_ALIASES);
  if (metro) return [...metro.locations];
  const state = resolveUsState(token);
  if (state) return [state];
  const trimmed = token.trim();
  return trimmed ? [trimmed] : [];
}

export function parseLocations(geography: string): string[] {
  const region = matchNeedles(geography, REGION_PRESETS);
  if (region) return [...region.locations];
  const tokens = splitFieldTokens(geography);
  const parts = tokens.length ? tokens : [geography];
  return unique(parts.flatMap(expandLocationToken));
}

export function parseTargeting(attrs: LeadAttributes): TargetingParse {
  const seniority = parseSeniority(attrs.seniority);
  const size_ranges = parseSizeRanges(attrs.business_size);
  if (size_ranges.some((range) => range === '1,10' || range === '11,50')) {
    if (!seniority.tokens.includes('owner')) seniority.tokens.push('owner');
    if (!seniority.tokens.includes('founder')) seniority.tokens.push('founder');
  }
  return {
    industry_tokens: parseIndustryTokens(attrs.industry),
    seniority_tokens: seniority.tokens,
    seniority_titles: seniority.titles,
    locations: parseLocations(attrs.geography),
    size_ranges,
  };
}

export function isApolloEmployeeRange(value: string): boolean {
  return APOLLO_EMPLOYEE_BANDS.some((band) => band.range === value);
}
