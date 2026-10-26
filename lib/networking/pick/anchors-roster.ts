/**
 * The per-city anchor roster for the `roster` term of event-pick (plan M2 step 2): the
 * established organizations that regularly convene each city's tech scene. Seeded from the
 * research audit (c) and the metros audit §9, 2026-10-21.
 *
 * Rosters are numbered like the blue-chip rosters (lib/social-hub/blue-chip-players.ts): a
 * score row keeps meaning what it meant, so a change to who is on a roster is a new number,
 * never an edit of a shipped one. Roster 1 is the first.
 *
 * Matching is exact equality on a normalized name (lower case, accents and punctuation
 * dropped, "&" read as "and"). A substring never counts: "Engine" is not "The Engine", and
 * "Ramp" does not match "Rampart Labs".
 */
import type { Metro } from '@/lib/networking/types';

export type RosterEntry = {
  /** The name shown on the hub and sent to Jev as `ecosystem_context.roster_match`. */
  name: string;
  /** Other spellings seen on listings: calendar slugs, Meetup urlnames, long names. */
  aliases?: string[];
};

export type AnchorRoster = Record<Metro, RosterEntry[]> & {
  /** Organizations with chapters in every city. A chapter matches by its bare name or with the city appended. */
  all: RosterEntry[];
};

export const ANCHOR_ROSTER_1: AnchorRoster = {
  boston: [
    { name: 'MassTLC', aliases: ['Massachusetts Technology Leadership Council', 'masstechleadershipcouncil', 'Mass Tech Leadership Council'] },
    { name: 'The Engine', aliases: ['The Engine Ventures', 'Engine Ventures', 'The Engine built by MIT'] },
    { name: 'MassRobotics', aliases: ['Mass Robotics'] },
    { name: 'MassChallenge', aliases: ['Mass Challenge'] },
    { name: 'Greentown Labs', aliases: ['Greentown'] },
    { name: 'CIC', aliases: ['Cambridge Innovation Center', 'CIC Cambridge', 'CIC Boston'] },
    { name: 'Venture Café Cambridge', aliases: ['Venture Cafe Cambridge', 'venturecafecambridge', 'Venture Café Cambridge Thursday Gathering'] },
    { name: 'AI Tinkerers Boston', aliases: ['boston.aitinkerers.org', 'Boston AI Tinkerers'] },
    { name: 'Boston New Technology', aliases: ['boston_new_technology', 'Boston New Technology Meetup'] },
    { name: 'Boston AI Week', aliases: ['boston-ai-week', 'aiweek.boston'] },
    { name: 'Boston AI', aliases: ['boston-ai'] },
    { name: 'Harvard Innovation Labs', aliases: ['Harvard i-lab', 'Harvard Innovation Lab', 'Harvard iLab'] },
    { name: 'MIT Media Lab' },
    { name: 'Boston Python', aliases: ['bostonpython', 'Boston Python User Group'] },
    { name: 'GDG Boston', aliases: ['gdg-boston', 'Google Developer Group Boston', 'Google Developer Groups Boston'] },
  ],
  nyc: [
    { name: 'FirstMark', aliases: ['FirstMark Capital', 'Data Driven NYC', 'Data Driven New York'] },
    { name: 'NY Tech Alliance', aliases: ['New York Tech Alliance', 'NY Tech Meetup', 'New York Tech Meetup', 'NYTM', 'nytech'] },
    { name: 'AI Tinkerers NYC', aliases: ['AI Tinkerers New York', 'nyc.aitinkerers.org', 'NYC AI Tinkerers'] },
    { name: 'Betaworks' },
    { name: 'localhost:nyc', aliases: ['localhost-nyc'] },
    { name: 'Startup Grind NYC', aliases: ['startupgrindnyc', 'Startup Grind New York'] },
    { name: 'NYMLR', aliases: ['nymlr', 'AI/ML Lecture & Networking @ NYC'] },
    { name: 'Fonzi NYC AI Engineers', aliases: ['Fonzi, NYC AI Engineers', 'nyaiengineers', 'NYC AI Engineers', 'Fonzi'] },
    { name: 'Tech:NYC', aliases: ['technyc', 'Tech NYC'] },
    { name: '8VC', aliases: ['8VC Events'] },
    { name: 'RRE Ventures', aliases: ['RRE'] },
    { name: 'Variant', aliases: ['Variant Fund'] },
    { name: 'Ramp', aliases: ['Ramp Events'] },
    { name: 'nyhackr', aliases: ['NYHackR', 'New York Open Statistical Programming Meetup'] },
    { name: 'PyData NYC', aliases: ['pydatanyc', 'PyData New York'] },
    { name: 'AWS NYC', aliases: ['aws-nyc', 'AWS New York'] },
  ],
  sf: [
    { name: 'AI Tinkerers SF', aliases: ['AI Tinkerers San Francisco', 'sf.aitinkerers.org', 'SF AI Tinkerers'] },
    { name: 'Cerebral Valley', aliases: ['cerebralvalley'] },
    { name: 'Y Combinator', aliases: ['YC', 'ycombinator', 'ycombinator-official'] },
    { name: 'South Park Commons', aliases: ['southparkcommons-events', 'SPC'] },
    { name: 'Founders Inc', aliases: ['Founders, Inc.', 'f.inc'] },
    { name: 'Frontier Tower', aliases: ['Frontier Tower SF', 'frontiertower'] },
    { name: 'TechEquity AI', aliases: ['TechEquity Ai - Silicon Valley', 'techequity-ai'] },
    { name: 'Build with AI Club', aliases: ['build-with-ai-club'] },
    { name: 'AGI House', aliases: ['agihouse'] },
    { name: 'LangChain', aliases: ['LangChain Events'] },
    { name: 'Hacker Dojo', aliases: ['hackerdojo'] },
    { name: 'SF Bay ACM', aliases: ['sf-bay-acm', 'San Francisco Bay Area ACM'] },
    { name: 'Hackers and Founders', aliases: ['Hackers/Founders', 'Hackers & Founders', 'hackers-and-founders'] },
    {
      name: 'USF Data Science and AI Speaker Series',
      aliases: ['USF Data Science & Artificial Intelligence Speaker Series', 'usf-data-science-and-ai-speaker-series'],
    },
    { name: 'Bay Area Research in NLP and ML', aliases: ['bay-area-research-in-nlp-and-ml'] },
    { name: 'SHACK15', aliases: ['SHACK 15'] },
  ],
  miami: [
    { name: 'Refresh Miami', aliases: ['refreshmiami'] },
    { name: 'eMerge Americas', aliases: ['emergeamericas'] },
    { name: 'Miami AI Summit', aliases: ['miamiaisummit'] },
    { name: 'LaFamilia', aliases: ['La Familia', 'lafamilia'] },
    { name: 'AI Tinkerers Miami', aliases: ['miami.aitinkerers.org', 'Miami AI Tinkerers'] },
    { name: 'The LAB Miami', aliases: ['LAB Miami'] },
    { name: 'Venture Café Miami', aliases: ['Venture Cafe Miami', 'venturecafemiami'] },
    { name: 'Mindstone Miami' },
    { name: 'Founders Live Miami', aliases: ['Founders Live'] },
    { name: 'Techstars Miami' },
    { name: 'HackMiami', aliases: ['Hack Miami'] },
    { name: 'Miami AI', aliases: ['miami-ai'] },
    { name: 'Miami Python', aliases: ['miami-python'] },
  ],
  all: [
    { name: 'The AI Collective', aliases: ['AI Collective', 'GenAI Collective', 'The GenAI Collective', 'genai-collective'] },
  ],
};

export const ANCHOR_ROSTERS = { 1: ANCHOR_ROSTER_1 } as const;
export type AnchorRosterNumber = keyof typeof ANCHOR_ROSTERS;
/** The roster event-pick@1 reads. */
export const CURRENT_ANCHOR_ROSTER: AnchorRosterNumber = 1;

/** How a city chapter of an `all` organization may be suffixed ("The AI Collective NYC"). */
const CITY_SUFFIXES: Record<Metro, string[]> = {
  boston: ['Boston', 'Cambridge'],
  nyc: ['NYC', 'New York', 'New York City', 'NY'],
  sf: ['SF', 'San Francisco', 'Bay Area', 'SF Bay Area', 'Silicon Valley'],
  miami: ['Miami'],
};

/** Lower case, accents and punctuation dropped, "&" read as "and", single spaces. */
export function normalizeOrgName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const indexCache = new Map<string, Map<string, string>>();

/** Normalized spelling → roster name, for one city of one roster. */
function rosterIndex(metro: Metro, roster: AnchorRosterNumber): Map<string, string> {
  const key = `${roster}:${metro}`;
  const cached = indexCache.get(key);
  if (cached) return cached;
  const index = new Map<string, string>();
  const add = (spelling: string, name: string) => {
    const normalized = normalizeOrgName(spelling);
    if (normalized && !index.has(normalized)) index.set(normalized, name);
  };
  const table = ANCHOR_ROSTERS[roster];
  for (const entry of table[metro]) {
    for (const spelling of [entry.name, ...(entry.aliases ?? [])]) add(spelling, entry.name);
  }
  for (const entry of table.all) {
    for (const spelling of [entry.name, ...(entry.aliases ?? [])]) {
      add(spelling, entry.name);
      for (const suffix of CITY_SUFFIXES[metro]) add(`${spelling} ${suffix}`, entry.name);
    }
  }
  indexCache.set(key, index);
  return index;
}

/**
 * The roster name that one of `names` equals after normalization, or null. Callers pass the
 * organizer name, every host name, and the calendar slug or Meetup urlname when known.
 */
export function rosterMatch(
  metro: Metro,
  names: ReadonlyArray<string | null | undefined>,
  roster: AnchorRosterNumber = CURRENT_ANCHOR_ROSTER,
): string | null {
  const index = rosterIndex(metro, roster);
  for (const name of names) {
    if (!name) continue;
    const hit = index.get(normalizeOrgName(name));
    if (hit) return hit;
  }
  return null;
}
