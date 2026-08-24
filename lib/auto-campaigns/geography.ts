/** Same-country geography widening for Apollo people-search. */

const US_STATE_BY_ALIAS: Record<string, string> = {
  al: 'Alabama', alabama: 'Alabama',
  ak: 'Alaska', alaska: 'Alaska',
  az: 'Arizona', arizona: 'Arizona',
  ar: 'Arkansas', arkansas: 'Arkansas',
  ca: 'California', california: 'California',
  co: 'Colorado', colorado: 'Colorado',
  ct: 'Connecticut', connecticut: 'Connecticut',
  de: 'Delaware', delaware: 'Delaware',
  dc: 'District of Columbia', 'washington dc': 'District of Columbia', 'washington d.c.': 'District of Columbia',
  fl: 'Florida', florida: 'Florida',
  ga: 'Georgia', georgia: 'Georgia',
  hi: 'Hawaii', hawaii: 'Hawaii',
  id: 'Idaho', idaho: 'Idaho',
  il: 'Illinois', illinois: 'Illinois',
  in: 'Indiana', indiana: 'Indiana',
  ia: 'Iowa', iowa: 'Iowa',
  ks: 'Kansas', kansas: 'Kansas',
  ky: 'Kentucky', kentucky: 'Kentucky',
  la: 'Louisiana', louisiana: 'Louisiana',
  me: 'Maine', maine: 'Maine',
  md: 'Maryland', maryland: 'Maryland',
  ma: 'Massachusetts', massachusetts: 'Massachusetts',
  mi: 'Michigan', michigan: 'Michigan',
  mn: 'Minnesota', minnesota: 'Minnesota',
  ms: 'Mississippi', mississippi: 'Mississippi',
  mo: 'Missouri', missouri: 'Missouri',
  mt: 'Montana', montana: 'Montana',
  ne: 'Nebraska', nebraska: 'Nebraska',
  nv: 'Nevada', nevada: 'Nevada',
  nh: 'New Hampshire', 'new hampshire': 'New Hampshire',
  nj: 'New Jersey', 'new jersey': 'New Jersey',
  nm: 'New Mexico', 'new mexico': 'New Mexico',
  ny: 'New York', 'new york': 'New York', nyc: 'New York', 'new york city': 'New York', manhattan: 'New York',
  nc: 'North Carolina', 'north carolina': 'North Carolina',
  nd: 'North Dakota', 'north dakota': 'North Dakota',
  oh: 'Ohio', ohio: 'Ohio',
  ok: 'Oklahoma', oklahoma: 'Oklahoma',
  or: 'Oregon', oregon: 'Oregon',
  pa: 'Pennsylvania', pennsylvania: 'Pennsylvania',
  ri: 'Rhode Island', 'rhode island': 'Rhode Island',
  sc: 'South Carolina', 'south carolina': 'South Carolina',
  sd: 'South Dakota', 'south dakota': 'South Dakota',
  tn: 'Tennessee', tennessee: 'Tennessee',
  tx: 'Texas', texas: 'Texas',
  ut: 'Utah', utah: 'Utah',
  vt: 'Vermont', vermont: 'Vermont',
  va: 'Virginia', virginia: 'Virginia',
  wa: 'Washington', washington: 'Washington',
  wv: 'West Virginia', 'west virginia': 'West Virginia',
  wi: 'Wisconsin', wisconsin: 'Wisconsin',
  wy: 'Wyoming', wyoming: 'Wyoming',
};

const US_NEIGHBORS: Record<string, string[]> = {
  Alabama: ['Florida', 'Georgia', 'Mississippi', 'Tennessee'],
  Alaska: ['Washington'],
  Arizona: ['California', 'Colorado', 'Nevada', 'New Mexico', 'Utah'],
  Arkansas: ['Louisiana', 'Mississippi', 'Missouri', 'Oklahoma', 'Tennessee', 'Texas'],
  California: ['Arizona', 'Nevada', 'Oregon'],
  Colorado: ['Arizona', 'Kansas', 'Nebraska', 'New Mexico', 'Oklahoma', 'Utah', 'Wyoming'],
  Connecticut: ['Massachusetts', 'New York', 'Rhode Island'],
  Delaware: ['Maryland', 'New Jersey', 'Pennsylvania'],
  'District of Columbia': ['Maryland', 'Virginia'],
  Florida: ['Alabama', 'Georgia'],
  Georgia: ['Alabama', 'Florida', 'North Carolina', 'South Carolina', 'Tennessee'],
  Hawaii: ['California'],
  Idaho: ['Montana', 'Nevada', 'Oregon', 'Utah', 'Washington', 'Wyoming'],
  Illinois: ['Indiana', 'Iowa', 'Kentucky', 'Missouri', 'Wisconsin'],
  Indiana: ['Illinois', 'Kentucky', 'Michigan', 'Ohio'],
  Iowa: ['Illinois', 'Minnesota', 'Missouri', 'Nebraska', 'South Dakota', 'Wisconsin'],
  Kansas: ['Colorado', 'Missouri', 'Nebraska', 'Oklahoma'],
  Kentucky: ['Illinois', 'Indiana', 'Missouri', 'Ohio', 'Tennessee', 'Virginia', 'West Virginia'],
  Louisiana: ['Arkansas', 'Mississippi', 'Texas'],
  Maine: ['New Hampshire'],
  Maryland: ['Delaware', 'District of Columbia', 'Pennsylvania', 'Virginia', 'West Virginia'],
  Massachusetts: ['Connecticut', 'New Hampshire', 'New York', 'Rhode Island', 'Vermont'],
  Michigan: ['Indiana', 'Ohio', 'Wisconsin'],
  Minnesota: ['Iowa', 'North Dakota', 'South Dakota', 'Wisconsin'],
  Mississippi: ['Alabama', 'Arkansas', 'Louisiana', 'Tennessee'],
  Missouri: ['Arkansas', 'Illinois', 'Iowa', 'Kansas', 'Kentucky', 'Nebraska', 'Oklahoma', 'Tennessee'],
  Montana: ['Idaho', 'North Dakota', 'South Dakota', 'Wyoming'],
  Nebraska: ['Colorado', 'Iowa', 'Kansas', 'Missouri', 'South Dakota', 'Wyoming'],
  Nevada: ['Arizona', 'California', 'Idaho', 'Oregon', 'Utah'],
  'New Hampshire': ['Maine', 'Massachusetts', 'Vermont'],
  'New Jersey': ['Delaware', 'New York', 'Pennsylvania'],
  'New Mexico': ['Arizona', 'Colorado', 'Oklahoma', 'Texas', 'Utah'],
  'New York': ['Connecticut', 'Massachusetts', 'New Jersey', 'Pennsylvania', 'Vermont'],
  'North Carolina': ['Georgia', 'South Carolina', 'Tennessee', 'Virginia'],
  'North Dakota': ['Minnesota', 'Montana', 'South Dakota'],
  Ohio: ['Indiana', 'Kentucky', 'Michigan', 'Pennsylvania', 'West Virginia'],
  Oklahoma: ['Arkansas', 'Colorado', 'Kansas', 'Missouri', 'New Mexico', 'Texas'],
  Oregon: ['California', 'Idaho', 'Nevada', 'Washington'],
  Pennsylvania: ['Delaware', 'Maryland', 'New Jersey', 'New York', 'Ohio', 'West Virginia'],
  'Rhode Island': ['Connecticut', 'Massachusetts'],
  'South Carolina': ['Georgia', 'North Carolina'],
  'South Dakota': ['Iowa', 'Minnesota', 'Montana', 'Nebraska', 'North Dakota', 'Wyoming'],
  Tennessee: ['Alabama', 'Arkansas', 'Georgia', 'Kentucky', 'Mississippi', 'Missouri', 'North Carolina', 'Virginia'],
  Texas: ['Arkansas', 'Louisiana', 'New Mexico', 'Oklahoma'],
  Utah: ['Arizona', 'Colorado', 'Idaho', 'Nevada', 'New Mexico', 'Wyoming'],
  Vermont: ['Massachusetts', 'New Hampshire', 'New York'],
  Virginia: ['District of Columbia', 'Kentucky', 'Maryland', 'North Carolina', 'Tennessee', 'West Virginia'],
  Washington: ['Idaho', 'Oregon'],
  'West Virginia': ['Kentucky', 'Maryland', 'Ohio', 'Pennsylvania', 'Virginia'],
  Wisconsin: ['Illinois', 'Iowa', 'Michigan', 'Minnesota'],
  Wyoming: ['Colorado', 'Idaho', 'Montana', 'Nebraska', 'South Dakota', 'Utah'],
};

const COUNTRY_ALIASES: Array<{ needles: string[]; country: string; widen: string[] }> = [
  { needles: ['united states', 'usa', 'u.s.', 'u.s.a', 'america'], country: 'United States', widen: ['United States'] },
  {
    needles: ['united kingdom', 'great britain', 'england', 'scotland', 'wales', 'northern ireland', 'uk', 'london'],
    country: 'United Kingdom',
    widen: ['United Kingdom', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  },
  { needles: ['canada', 'ontario', 'quebec', 'british columbia', 'alberta', 'toronto', 'vancouver'], country: 'Canada', widen: ['Canada'] },
  { needles: ['australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide'], country: 'Australia', widen: ['Australia'] },
  { needles: ['new zealand', 'auckland', 'wellington'], country: 'New Zealand', widen: ['New Zealand'] },
];

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
}

export function resolveUsState(location: string): string | null {
  const key = normalizeKey(location);
  if (US_STATE_BY_ALIAS[key]) return US_STATE_BY_ALIAS[key];
  const stripped = key.replace(/,?\s+(us|usa|united states)$/, '').trim();
  return US_STATE_BY_ALIAS[stripped] ?? null;
}

export function inferCountry(locations: string[]): string | null {
  const votes = new Map<string, number>();
  for (const location of locations) {
    if (resolveUsState(location)) {
      votes.set('United States', (votes.get('United States') ?? 0) + 1);
      continue;
    }
    const key = normalizeKey(location);
    const match = COUNTRY_ALIASES.find((entry) => entry.needles.some((needle) => key.includes(needle)));
    if (match) votes.set(match.country, (votes.get(match.country) ?? 0) + 1);
  }
  let best: string | null = null;
  let count = 0;
  for (const [country, n] of votes) {
    if (n > count) {
      best = country;
      count = n;
    }
  }
  return best;
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

function inSet(haystack: Set<string>, value: string): boolean {
  return haystack.has(normalizeKey(value));
}

/** BFS rings 1–3 from the exact locations, same country only. */
export function locationRings(exact: string[]): { rings: string[][]; country: string | null } {
  const origin = unique(exact);
  const country = inferCountry(origin);
  const rings: string[][] = [[], [], [], [], []];
  const originStates = unique(origin.flatMap((location) => {
    const state = resolveUsState(location);
    return state ? [state] : [];
  }));

  if (country === 'United States' && originStates.length > 0) {
    const dist = new Map<string, number>();
    const queue = [...originStates];
    for (const state of originStates) dist.set(state, 0);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      const depth = dist.get(current)!;
      for (const neighbor of US_NEIGHBORS[current] ?? []) {
        if (dist.has(neighbor)) continue;
        dist.set(neighbor, depth + 1);
        queue.push(neighbor);
      }
    }
    for (const [state, depth] of dist) {
      if (depth >= 1 && depth <= 3) rings[depth].push(state);
    }
    return { rings, country };
  }

  if (country) {
    const preset = COUNTRY_ALIASES.find((entry) => entry.country === country);
    const exactKeys = new Set(origin.map(normalizeKey));
    rings[1] = unique((preset?.widen ?? [country]).filter((value) => !inSet(exactKeys, value)));
    return { rings, country };
  }

  return { rings, country };
}

/** Locations to search after the exact geo is exhausted — nearby, same country only. */
export function nearbySameCountryLocations(exact: string[]): string[] {
  const source = unique(exact);
  if (source.length === 0) return [];
  const { rings, country } = locationRings(source);
  const hop1 = rings[1] ?? [];
  if (hop1.length) return hop1;
  return country ? [country] : source;
}

/**
 * Disjoint same-country ring at this hop.
 * Hop 1 prefers mapped related locations when they stay in-country.
 * Unused hop-1 neighbors are folded into hop 2 so they are not skipped.
 * Hop 4 is the rest of the same country.
 */
export function locationsAtHop(
  exact: string[],
  hop: number,
  related?: string[],
): string[] {
  const origin = unique(exact);
  if (origin.length === 0) return [];
  const clamped = Math.max(0, Math.floor(hop) || 0);
  if (clamped <= 0) return origin;
  const { rings, country } = locationRings(origin);
  if (clamped === 1) {
    const relatedKept = constrainToSameCountry(origin, related);
    if (relatedKept.length) return relatedKept;
    return rings[1] ?? [];
  }
  if (clamped === 2) {
    const hop1 = locationsAtHop(origin, 1, related);
    const used = new Set(hop1.map(normalizeKey));
    const leftoverHop1 = (rings[1] ?? []).filter((location) => !used.has(normalizeKey(location)));
    return unique([...leftoverHop1, ...(rings[2] ?? [])]);
  }
  if (clamped === 3) return unique(rings[3] ?? []);
  return country ? [country] : origin;
}

export function constrainToSameCountry(exact: string[], related: string[] | undefined): string[] {
  const country = inferCountry(exact);
  const candidates = unique(related ?? []);
  if (!country) return nearbySameCountryLocations(exact);
  const kept = candidates.filter((location) => inferCountry([location]) === country);
  return kept.length ? kept : nearbySameCountryLocations(exact);
}
