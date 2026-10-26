import type { Metro } from '@/lib/networking/types';

export type MetroProfile = {
  id: Metro;
  label: string;
  /** IANA zone used when a source gives no timezone (Meetup, conferences). */
  timezone: string;
  center: { lat: number; lng: number };
  radiusMiles: number;
  /** Whole place names (city, neighborhood, county). Each alias belongs to exactly one metro. */
  aliases: string[];
};

export const METRO_PROFILES: Record<Metro, MetroProfile> = {
  boston: {
    id: 'boston',
    label: 'Boston',
    timezone: 'America/New_York',
    center: { lat: 42.3601, lng: -71.0589 },
    radiusMiles: 30,
    aliases: [
      'boston',
      'cambridge',
      'somerville',
      'brookline',
      'quincy',
      'newton',
      'medford',
      'watertown',
      'waltham',
      'lexington',
      'arlington',
      'allston',
      'brighton',
      'charlestown',
      'seaport',
      'kendall square',
      'fenway',
      'back bay',
      'south boston',
      'dorchester',
      'roxbury',
      'jamaica plain',
      'malden',
      'everett',
      'chelsea',
      'revere',
      'winthrop',
      'belmont',
      'needham',
      'dedham',
      'milton',
      'greater boston',
    ],
  },
  miami: {
    id: 'miami',
    label: 'Miami',
    timezone: 'America/New_York',
    center: { lat: 25.7617, lng: -80.1918 },
    radiusMiles: 30,
    aliases: [
      'miami',
      'miami beach',
      'miami-dade',
      'coral gables',
      'brickell',
      'wynwood',
      'coconut grove',
      'design district',
      'doral',
      'aventura',
      'south miami',
      'pinecrest',
      'key biscayne',
      'north miami',
      'north miami beach',
      'hialeah',
      'kendall',
      'fort lauderdale',
      'ft lauderdale',
      'hollywood',
      'surfside',
      'bal harbour',
      'sunny isles',
      'sunny isles beach',
      'miami springs',
      'little havana',
      'downtown miami',
      'edgewater',
      'midtown miami',
    ],
  },
  nyc: {
    id: 'nyc',
    label: 'New York',
    timezone: 'America/New_York',
    center: { lat: 40.7128, lng: -74.006 },
    radiusMiles: 30,
    // Left out on purpose: chelsea/edgewater (Boston/Miami), union square and financial district
    // (several cities), newark/richmond/soho/midtown (same name elsewhere).
    aliases: [
      'new york',
      'new york city',
      'nyc',
      'manhattan',
      'brooklyn',
      'queens',
      'bronx',
      'the bronx',
      'staten island',
      'new york county',
      'kings county',
      'queens county',
      'bronx county',
      'richmond county',
      'long island city',
      'astoria',
      'williamsburg',
      'greenpoint',
      'bushwick',
      'dumbo',
      'downtown brooklyn',
      'midtown manhattan',
      'lower manhattan',
      'tribeca',
      'flatiron',
      'harlem',
      'roosevelt island',
      'jersey city',
      'hoboken',
      'weehawken',
      'west new york',
      'fort lee',
      'yonkers',
      'white plains',
      'new rochelle',
    ],
  },
  sf: {
    id: 'sf',
    label: 'SF Bay Area',
    timezone: 'America/Los_Angeles',
    center: { lat: 37.7749, lng: -122.4194 },
    // 45 mi reaches San Jose, Santa Clara, Sunnyvale and Mountain View (AE-02).
    radiusMiles: 45,
    // Left out on purpose: design district/belmont (Miami/Boston), dublin/brisbane/hillsborough
    // (same name elsewhere).
    aliases: [
      'san francisco',
      'sf',
      'sf bay area',
      'bay area',
      'san francisco bay area',
      'silicon valley',
      'soma',
      'mission district',
      'mission bay',
      'dogpatch',
      'hayes valley',
      'presidio',
      'south san francisco',
      'daly city',
      'oakland',
      'berkeley',
      'emeryville',
      'alameda',
      'walnut creek',
      'san mateo',
      'burlingame',
      'foster city',
      'san carlos',
      'redwood city',
      'menlo park',
      'palo alto',
      'east palo alto',
      'stanford',
      'portola valley',
      'los altos',
      'mountain view',
      'moffett field',
      'sunnyvale',
      'santa clara',
      'cupertino',
      'san jose',
      'milpitas',
      'fremont',
      'pleasanton',
      'san ramon',
      'livermore',
    ],
  },
};

function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Lowercase, drop dots, turn other punctuation into spaces. Commas must be split off first. */
export function normalizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Hint = Metro | 'other' | null;

/** States (codes and names) that pin a place to one of our metros. */
const STATE_METRO: Record<string, Metro> = {
  ma: 'boston',
  mass: 'boston',
  massachusetts: 'boston',
  fl: 'miami',
  florida: 'miami',
  ny: 'nyc',
  'new york': 'nyc',
  nj: 'nyc',
  'new jersey': 'nyc',
  ca: 'sf',
  california: 'sf',
};

/** Every other US state, DC, PR, the Canadian provinces and common foreign countries: a place in one is outside our metros. */
const OTHER_REGIONS = new Set([
  'al', 'ak', 'az', 'ar', 'co', 'ct', 'de', 'dc', 'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky',
  'la', 'me', 'md', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nm', 'nc', 'nd', 'oh', 'ok',
  'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'pr',
  'alabama', 'alaska', 'arizona', 'arkansas', 'colorado', 'connecticut', 'delaware',
  'district of columbia', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas',
  'kentucky', 'louisiana', 'maine', 'maryland', 'michigan', 'minnesota', 'mississippi', 'missouri',
  'montana', 'nebraska', 'nevada', 'new hampshire', 'new mexico', 'north carolina', 'north dakota',
  'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
  'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin',
  'wyoming', 'puerto rico',
  'on', 'qc', 'bc', 'ab', 'mb', 'sk', 'ns', 'nb', 'nl', 'pe',
  'ontario', 'quebec', 'british columbia', 'alberta', 'manitoba', 'saskatchewan', 'nova scotia',
  'new brunswick', 'newfoundland and labrador', 'prince edward island',
  'canada', 'mexico', 'uk', 'united kingdom', 'england', 'scotland', 'wales', 'ireland',
  'australia', 'new zealand', 'india', 'germany', 'france', 'spain', 'italy', 'netherlands',
  'brazil',
]);

const COUNTRY_US = new Set(['us', 'usa', 'united states', 'united states of america']);
const POSTAL_ONLY_RE = /^(?:\d{5}(?: \d{4})?|[a-z]\d[a-z] ?\d[a-z]\d)$/;
const POSTAL_SUFFIX_RE = /\s+(?:\d{5}(?: \d{4})?|[a-z]\d[a-z] ?\d[a-z]\d)$/;

const STATE_TOKENS_LONGEST_FIRST = [...Object.keys(STATE_METRO), ...OTHER_REGIONS].sort(
  (a, b) => b.length - a.length,
);

const ALIAS_TO_METRO = new Map<string, Metro>();
for (const profile of Object.values(METRO_PROFILES)) {
  for (const alias of profile.aliases) {
    const key = normalizeSegment(alias);
    // First profile wins; tests/networking-keep-drop.test.ts enforces that no alias is shared.
    if (!ALIAS_TO_METRO.has(key)) ALIAS_TO_METRO.set(key, profile.id);
  }
}
/**
 * Neighborhood names that end other places' names ("South Street Seaport" in NYC, "West
 * Hollywood" in LA, "West Chelsea"): they match a whole segment only, never as a suffix.
 */
const WHOLE_SEGMENT_ONLY = new Set(['seaport', 'hollywood', 'chelsea', 'brighton', 'edgewater']);
const ALIASES_LONGEST_FIRST = [...ALIAS_TO_METRO.keys()]
  .filter((alias) => !WHOLE_SEGMENT_ONLY.has(alias))
  .sort((a, b) => b.length - a.length);

function hintFromToken(token: string): Hint {
  if (STATE_METRO[token]) return STATE_METRO[token];
  if (OTHER_REGIONS.has(token)) return 'other';
  return null;
}

/** A source's structured region: one of ours pins the metro, anything else rules our metros out. */
function hintFromRegion(region: string | undefined): Hint {
  const token = normalizeSegment(region ?? '');
  if (!token || COUNTRY_US.has(token)) return null;
  return hintFromToken(token) ?? 'other';
}

/** "cambridge ma" -> place "cambridge", hint boston. Postal codes are already stripped. */
function splitTrailingState(segment: string): { place: string; hint: Hint } | null {
  if (ALIAS_TO_METRO.has(segment)) return null; // "west new york" is a town, not "west" + NY
  for (const token of STATE_TOKENS_LONGEST_FIRST) {
    if (segment.endsWith(` ${token}`)) {
      return { place: segment.slice(0, -(token.length + 1)).trim(), hint: hintFromToken(token) };
    }
  }
  return null;
}

/**
 * Resolve a free-text place ("691 Market St, San Francisco, CA 94105, USA", "Brooklyn",
 * "Belmont" + region "CA") to a metro. Segments are matched whole, right to left, then by
 * suffix ("WeWork Boston"). A state hint from `region` or the text must agree with the
 * alias's metro, and a non-target state or province returns null.
 */
export function metroFromCityName(value: string | undefined, region?: string): Metro | null {
  if (!value?.trim()) return null;
  const parts = value
    .split(/[,\n]/)
    .map(normalizeSegment)
    .filter((part) => part && !COUNTRY_US.has(part) && !POSTAL_ONLY_RE.test(part));
  const regionHint = hintFromRegion(region);
  let textHint: Hint = null;
  const segments: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i].replace(POSTAL_SUFFIX_RE, '').trim();
    // A whole segment that is a state ("NY", "CA 94105", "New York") gives a hint;
    // "new york" is also an alias, so it stays a candidate.
    const whole = hintFromToken(part);
    if (whole) {
      textHint = whole;
      if (ALIAS_TO_METRO.has(part)) segments.push(part);
      continue;
    }
    // A trailing state is read only off the last segment, so "2nd Fl, Boston" never hints Florida.
    if (i === parts.length - 1) {
      const split = splitTrailingState(part);
      if (split) {
        textHint = split.hint;
        if (split.place) segments.push(split.place);
        continue;
      }
    }
    segments.push(part);
  }
  const hint = regionHint ?? textHint;
  if (hint === 'other') return null;
  const allowed = (metro: Metro | undefined): metro is Metro => Boolean(metro) && (!hint || hint === metro);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const metro = ALIAS_TO_METRO.get(segments[i]);
    if (allowed(metro)) return metro;
  }
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    for (const alias of ALIASES_LONGEST_FIRST) {
      if (!segments[i].endsWith(` ${alias}`)) continue;
      const metro = ALIAS_TO_METRO.get(alias);
      if (allowed(metro)) return metro;
    }
  }
  return null;
}

function hasCoords(lat: number | undefined, lng: number | undefined): boolean {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return !(lat === 0 && lng === 0);
}

export function metroFromCoords(
  lat: number | undefined,
  lng: number | undefined,
): Metro | null {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  let best: { metro: Metro; miles: number } | null = null;
  for (const profile of Object.values(METRO_PROFILES)) {
    const miles = haversineMiles({ lat, lng }, profile.center);
    if (miles <= profile.radiusMiles && (!best || miles < best.miles)) {
      best = { metro: profile.id, miles };
    }
  }
  return best?.metro ?? null;
}

/** Coordinates are authoritative: a located event outside every radius is outside our metros. */
export function resolveMetro(input: {
  city?: string;
  address?: string;
  venueName?: string;
  region?: string;
  lat?: number;
  lng?: number;
}): Metro | null {
  if (hasCoords(input.lat, input.lng)) return metroFromCoords(input.lat, input.lng);
  return (
    metroFromCityName(input.city, input.region) ||
    metroFromCityName(input.address, input.region) ||
    metroFromCityName(input.venueName, input.region)
  );
}

export function cleanLocation(
  rawName: string,
  rawAddress?: string,
  hasCoords?: boolean,
): { name: string; address: string } {
  const dedupeAndClean = (s: string) => {
    const parts = s
      .replace(/https?:\/\/\S+/g, '')
      .trim()
      .split('\n')[0]
      .trim()
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    return parts
      .filter((p) => {
        const key = p.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join(', ');
  };
  const cleaned = dedupeAndClean(rawName || '');
  const parts = cleaned.split(',').filter(Boolean);
  const name = hasCoords ? cleaned : parts.length > 1 ? parts[0].trim() : cleaned;
  const address = rawAddress ? dedupeAndClean(rawAddress) : name;
  return { name, address };
}
