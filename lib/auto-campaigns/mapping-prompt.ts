import {
  formatUsStateAliasCatalog,
  US_STATE_NAMES,
  US_STATE_NEIGHBORS,
} from '@/lib/auto-campaigns/geography';
import {
  APOLLO_EMPLOYEE_BANDS,
  EASTERN_US_LOCATIONS,
  METRO_ALIASES,
} from '@/lib/auto-campaigns/targeting-parse';
import { APOLLO_SENIORITIES } from '@/lib/auto-campaigns/types';

function metroCatalog(): string {
  return METRO_ALIASES
    .map((entry) => `${entry.needles.join(' | ')} → ${entry.locations.join(', ')}`)
    .join('\n');
}

function neighborCatalog(): string {
  return Object.entries(US_STATE_NEIGHBORS)
    .map(([state, neighbors]) => `${state}: ${neighbors.join(', ')}`)
    .join('\n');
}

function seniorityCatalog(): string {
  const meaning: Record<string, string> = {
    owner: 'Equity owner of the company. Use when the user says owner, proprietor, or principal owner.',
    founder: 'Founder or co-founder. Use when the user says founder or co-founder.',
    c_suite: 'C-level or president. Use for CEO, CFO, COO, CTO, president, chief, or C-suite.',
    partner: 'Equity partner. Use for partner or managing partner, not a casual collaborator.',
    vp: 'Vice president. Use for VP, vice president, or SVP.',
    head: 'Head of a function. Use for head, head of, or department head.',
    director: 'Director-level. Use for director or senior director.',
    manager: 'Manager-level. Use for manager or general manager when that is the requested band.',
    senior: 'Individual contributor marked senior. Do not treat this as a synonym for executive.',
    entry: 'Entry-level. Use only when the user asks for junior, associate, or entry roles.',
    intern: 'Intern. Use only when the user asks for intern or internship.',
  };
  return APOLLO_SENIORITIES
    .map((value) => `${value}: ${meaning[value] ?? value}`)
    .join('\n');
}

function sizeCatalog(): string {
  return APOLLO_EMPLOYEE_BANDS
    .map((band) => `${band.range} covers ${band.min} through ${band.max} employees`)
    .join('\n');
}

const OUTPUT_SCHEMA = `{
  "person_titles": ["string"],
  "related_person_titles": ["string"],
  "person_seniorities": ["owner|founder|c_suite|partner|vp|head|director|manager|senior|entry|intern"],
  "person_locations": ["string"],
  "organization_locations": ["string"],
  "related_person_locations": ["string"],
  "related_organization_locations": ["string"],
  "industry_keywords": ["string"],
  "related_industry_keywords": ["string"],
  "organization_num_employees_ranges": ["1,10|11,50|51,200|201,500|501,1000|1001,10000"],
  "q_keywords": "string"
}`;

const RULES = `Rules:
- Map the user's four free-text fields onto Apollo people-search filters. Apollo does not accept organization industry IDs.
- industry_keywords: 1 to 4 phrases, each 1 to 3 words, taken from the supplied industry_tokens. Never concatenate the whole industry line. Never drop industry. Never put size, geography, or seniority into a keyword.
- person_titles: 4 to 10 job titles that people at those companies actually hold. Prefer titles implied by the industry tokens and seniority tokens. Do not dump the raw seniority string as one title.
- related_person_titles and related_industry_keywords: adjacent on-industry alternatives, nearest first. Never widen to any company.
- person_seniorities: only values from the closed seniority catalog. Vague phrases such as decision makers expand to owner, founder, c_suite, vp, head, director. Stay inside that catalog.
- organization_num_employees_ranges: only values from the employee-range catalog. Prefer the supplied size_ranges. Include every catalog band that overlaps the user's span. Never invent a band. Never use a substring match that would turn 11-100 into 1,10.
- person_locations and organization_locations: cities and US state names from the supplied locations. Never emit region labels such as Eastern United States, East Coast, Greater Boston, Bay Area, SoCal, or Chicagoland. Expand those via the metro and region catalogs.
- related_person_locations: hop-1 neighbors in the same country. For US states use the adjacency catalog. Never invent another country. Never return an empty list when a country can be inferred.
- q_keywords: copy industry_keywords[0].
- Never invent emails. Never call tools. Do not include organization_ids.
- Return ONLY a JSON object that matches the schema.`;

export function buildMappingSystemPrompt(): string {
  return [
    'Apollo people-search catalogs for Autocampaign targeting.',
    '',
    'CLOSED SENIORITIES',
    seniorityCatalog(),
    '',
    'EMPLOYEE RANGES',
    sizeCatalog(),
    '',
    'US STATES',
    US_STATE_NAMES.join(', '),
    '',
    'US STATE ALIASES',
    formatUsStateAliasCatalog(),
    '',
    'US STATE ADJACENCY (hop-1 neighbors, same country only)',
    neighborCatalog(),
    '',
    'METRO ALIASES',
    metroCatalog(),
    '',
    'REGION EXPANSIONS',
    `eastern united states | eastern us | east coast → ${EASTERN_US_LOCATIONS.join(', ')}`,
    'northeast | new england → Maine, New Hampshire, Vermont, Massachusetts, Rhode Island, Connecticut, New York, New Jersey, Pennsylvania',
    'mid-atlantic | mid atlantic → Delaware, Maryland, District of Columbia, Virginia, West Virginia',
    'southeast | south east → North Carolina, South Carolina, Georgia, Florida, Alabama, Tennessee',
    '',
    'OUTPUT JSON SCHEMA',
    OUTPUT_SCHEMA,
    '',
    RULES,
  ].join('\n');
}
