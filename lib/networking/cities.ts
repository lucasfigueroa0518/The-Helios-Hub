import type { Metro } from '@/lib/networking/types';

export type MetroProfile = {
  id: Metro;
  label: string;
  center: { lat: number; lng: number };
  radiusMiles: number;
  aliases: string[];
};

export const METRO_PROFILES: Record<Metro, MetroProfile> = {
  boston: {
    id: 'boston',
    label: 'Boston',
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
      'somerville ma',
      'cambridge ma',
      'boston ma',
      'greater boston',
    ],
  },
  miami: {
    id: 'miami',
    label: 'Miami',
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
      'ft. lauderdale',
      'hollywood',
      'hollywood fl',
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

export function normalizePlaceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/,/g, ' ')
    .replace(/\b(ma|mass|massachusetts|fl|florida|usa|united states)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function metroFromCityName(city: string | undefined): Metro | null {
  if (!city?.trim()) return null;
  const normalized = normalizePlaceName(city);
  if (!normalized) return null;
  for (const profile of Object.values(METRO_PROFILES)) {
    for (const alias of profile.aliases) {
      if (normalized === alias || normalized.includes(alias) || alias.includes(normalized)) {
        if (normalized.length >= 5 || normalized === alias) return profile.id;
      }
    }
  }
  return null;
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

export function resolveMetro(input: {
  city?: string;
  address?: string;
  venueName?: string;
  lat?: number;
  lng?: number;
}): Metro | null {
  const byCoords = metroFromCoords(input.lat, input.lng);
  if (byCoords) return byCoords;
  return (
    metroFromCityName(input.city) ||
    metroFromCityName(input.address) ||
    metroFromCityName(input.venueName)
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
