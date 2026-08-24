import Anthropic from '@anthropic-ai/sdk';
import { cachedSystemText } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { MAPPING_MODEL, resolvedDraftingPromptCacheTtl } from '@/lib/models';
import { constrainToSameCountry, nearbySameCountryLocations } from '@/lib/auto-campaigns/geography';
import {
  APOLLO_SENIORITIES,
  type LeadAttributes,
  type PeopleSearchParams,
} from '@/lib/auto-campaigns/types';

const SENIORITY_SET = new Set<string>(APOLLO_SENIORITIES);

const SENIORITY_ALIASES: Array<{ needles: string[]; value: string; titles?: string[] }> = [
  { needles: ['ceo', 'chief executive', 'c-suite', 'c suite', 'founder', 'co-founder', 'owner'], value: 'c_suite', titles: ['CEO', 'Founder', 'Co-Founder', 'Owner'] },
  { needles: ['cto', 'chief technology', 'vp engineering', 'vice president'], value: 'vp', titles: ['CTO', 'VP Engineering', 'VP'] },
  { needles: ['director', 'head of'], value: 'director', titles: ['Director', 'Head'] },
  { needles: ['partner'], value: 'partner', titles: ['Partner'] },
  { needles: ['manager'], value: 'manager' },
  { needles: ['senior'], value: 'senior' },
];

const SIZE_RANGES: Array<{ needles: string[]; range: string }> = [
  { needles: ['1-10', '1–10', 'micro', 'tiny'], range: '1,10' },
  { needles: ['11-50', '11–50', 'small'], range: '11,50' },
  { needles: ['51-200', '51–200', 'smb'], range: '51,200' },
  { needles: ['201-500', '201–500'], range: '201,500' },
  { needles: ['501-1000', '501–1,000', '501-1,000'], range: '501,1000' },
  { needles: ['1000', '1,000+', 'enterprise', 'large'], range: '1001,10000' },
  { needles: ['brokerage', 'boutique'], range: '11,50' },
];

const NORTHEAST = ['Maine', 'New Hampshire', 'Vermont', 'Massachusetts', 'Rhode Island', 'Connecticut', 'New York', 'New Jersey', 'Pennsylvania'];
const MID_ATLANTIC = ['Delaware', 'Maryland', 'District of Columbia', 'Virginia', 'West Virginia'];
const SOUTHEAST = ['North Carolina', 'South Carolina', 'Georgia', 'Florida', 'Alabama', 'Tennessee'];
export const EASTERN_US_LOCATIONS = [...NORTHEAST, ...MID_ATLANTIC, ...SOUTHEAST];

const GEO_PRESETS: Array<{ needles: string[]; locations: string[] }> = [
  { needles: ['eastern united states', 'eastern us', 'east coast', 'eastern u.s'], locations: EASTERN_US_LOCATIONS },
  { needles: ['northeast', 'new england'], locations: NORTHEAST },
  { needles: ['mid-atlantic', 'mid atlantic'], locations: MID_ATLANTIC },
  { needles: ['southeast', 'south east'], locations: SOUTHEAST },
];

type IndustryPreset = {
  needles: string[];
  titles: string[];
  keywords: string[];
  relatedTitles: string[];
  relatedKeywords: string[];
};

const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    needles: ['janitor', 'cleaning', 'custodial', 'custodian', 'building services'],
    titles: [
      'Operations Manager',
      'Facilities Manager',
      'Branch Manager',
      'General Manager',
      'Janitorial Manager',
      'Account Manager',
      'Owner',
    ],
    keywords: ['janitorial', 'commercial cleaning'],
    relatedTitles: ['Facilities Director', 'Maintenance Manager', 'Property Manager'],
    relatedKeywords: ['facilities services', 'building maintenance', 'building services'],
  },
  {
    needles: ['real estate', 'cre', 'brokerage', 'broker'],
    titles: ['Broker', 'Managing Broker', 'Partner', 'Principal', 'Managing Director'],
    keywords: ['commercial real estate', 'real estate brokerage'],
    relatedTitles: ['Director', 'Vice President', 'Owner'],
    relatedKeywords: ['real estate', 'property management'],
  },
  {
    needles: ['law', 'legal', 'attorney', 'lawyer'],
    titles: ['Partner', 'Managing Partner', 'Attorney', 'Counsel', 'Associate'],
    keywords: ['law firm'],
    relatedTitles: ['Of Counsel', 'Practice Group Leader'],
    relatedKeywords: ['legal services', 'law'],
  },
  {
    needles: ['msp', 'managed service', 'it services', 'it consulting'],
    titles: ['Owner', 'President', 'CTO', 'VP', 'Managing Partner'],
    keywords: ['managed service provider', 'msp'],
    relatedTitles: ['Director of IT', 'General Manager'],
    relatedKeywords: ['it services', 'it consulting'],
  },
];

const MAP_SYSTEM = `You map Autocampaign free-text targeting onto Apollo people-search filters.
Apollo people search is free and does NOT accept organization industry IDs. Industry must be expressed as:
1. person_titles — 4 to 10 job titles that people at those companies actually hold. Prefer titles that imply the industry (Janitorial Manager, Facilities Manager) over generic ones (Consultant, Professor, President) unless the user asked for that role.
2. industry_keywords — 2 to 4 SHORT phrases (1-3 words) associated with those companies, e.g. "janitorial", "commercial cleaning". Never paste the user's full sentence. Never include company size, geography, or seniority in a keyword.
3. related_person_titles and related_industry_keywords — adjacent on-industry alternatives, ordered nearest to furthest. Example: janitorial → facilities services, then building maintenance. Never widen to "any company". Later hops loosen titles but keep industry keywords.

Also return:
- person_seniorities: ONLY from owner,founder,c_suite,partner,vp,head,director,manager,senior,entry,intern. "Senior" → senior, manager, director (add owner/founder when company size is small).
- person_locations AND organization_locations: Apollo understands cities, US states, and countries. Use state names like "New York", "Florida". Never use region labels like "United States - Northeast", "Eastern United States", or "East Coast" — expand those to the constituent states.
- related_person_locations: hop-1 neighbors in the SAME country. Eastern US → adjacent inland US states (Ohio, Kentucky, Michigan…), never the UK/Australia. New York → NJ/CT/PA. London → rest of the United Kingdom. Never other countries. Never omit country by returning an empty list.
- organization_num_employees_ranges: strings like "11,50".
- q_keywords: copy industry_keywords[0].

Return ONLY a JSON object. Never invent emails. Never call tools. Do not include organization_ids.`;

function uniqueTrimmed(values: Array<string | undefined>, cap: number): string[] | undefined {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(trimmed);
    if (items.length >= cap) break;
  }
  return items.length ? items : undefined;
}

function asStringArray(value: unknown, cap: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return uniqueTrimmed(value.map((entry) => typeof entry === 'string' ? entry : undefined), cap);
}

function closedSeniorities(values: string[] | undefined): string[] | undefined {
  const items = values?.filter((value) => SENIORITY_SET.has(value));
  return items?.length ? [...new Set(items)] : undefined;
}

function includesNeedle(text: string, needle: string): boolean {
  const haystack = text.trim().toLowerCase();
  const pin = needle.trim().toLowerCase();
  if (!haystack || !pin) return false;
  if (pin.includes(' ')) return haystack.includes(pin);
  const escaped = pin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(haystack);
}

function matchPreset<T extends { needles: string[] }>(text: string, presets: T[]): T | undefined {
  return presets.find((preset) => preset.needles.some((needle) => includesNeedle(text, needle)));
}

export function mapGeographyToApolloLocations(geography: string): string[] | undefined {
  const preset = matchPreset(geography, GEO_PRESETS);
  if (preset) return [...preset.locations];
  const trimmed = geography.trim();
  return trimmed ? [trimmed] : undefined;
}

function industryPresetFor(industry: string): IndustryPreset | undefined {
  return matchPreset(industry, INDUSTRY_PRESETS);
}

function shortIndustryKeyword(industry: string): string | undefined {
  const trimmed = industry.trim().replace(/[\\/|,]+/g, ' ').replace(/\s+/g, ' ');
  if (!trimmed) return undefined;
  const words = trimmed.split(' ').filter((word) => !/^(companies|company|industry|the|and)$/i.test(word));
  return words.slice(0, 3).join(' ') || undefined;
}

export function hasIndustrySignal(params: PeopleSearchParams): boolean {
  return Boolean(
    params.industry_keywords?.length
    || params.q_keywords?.trim()
    || params.person_titles?.length,
  );
}

export function industryKeywordQueue(params: PeopleSearchParams): string[] {
  const queue: string[] = [];
  const seen = new Set<string>();
  for (const value of [...(params.industry_keywords ?? []), params.q_keywords ?? '']) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    queue.push(trimmed);
  }
  return queue;
}

function assembleParams(input: {
  titles?: string[];
  relatedTitles?: string[];
  seniorities?: string[];
  locations?: string[];
  relatedLocations?: string[];
  keywords?: string[];
  relatedKeywords?: string[];
  ranges?: string[];
}): PeopleSearchParams {
  const industry_keywords = uniqueTrimmed(input.keywords ?? [], 4);
  const related_industry_keywords = uniqueTrimmed(input.relatedKeywords ?? [], 4);
  const person_titles = uniqueTrimmed(input.titles ?? [], 10);
  const related_person_titles = uniqueTrimmed(input.relatedTitles ?? [], 10);
  const locations = uniqueTrimmed(input.locations ?? [], 25);
  const relatedLocations = uniqueTrimmed(
    constrainToSameCountry(locations ?? [], input.relatedLocations ?? nearbySameCountryLocations(locations ?? [])),
    25,
  );
  return {
    person_titles,
    related_person_titles,
    person_seniorities: closedSeniorities(input.seniorities),
    person_locations: locations,
    organization_locations: locations,
    related_person_locations: relatedLocations,
    related_organization_locations: relatedLocations,
    q_keywords: industry_keywords?.[0],
    industry_keywords,
    related_industry_keywords,
    organization_num_employees_ranges: uniqueTrimmed(input.ranges ?? [], 4),
  };
}

export function mapAttributesHeuristic(attrs: LeadAttributes): PeopleSearchParams {
  const seniorityText = attrs.seniority.toLowerCase();
  const sizeText = attrs.business_size.toLowerCase();
  const titles = new Set<string>();
  const seniorities = new Set<string>();
  for (const alias of SENIORITY_ALIASES) {
    if (alias.needles.some((needle) => seniorityText.includes(needle))) {
      seniorities.add(alias.value);
      for (const title of alias.titles ?? []) titles.add(title);
    }
  }
  if (sizeText.includes('11-50') || sizeText.includes('11–50') || sizeText.includes('1-10') || sizeText.includes('small')) {
    seniorities.add('owner');
    seniorities.add('founder');
  }
  const preset = industryPresetFor(attrs.industry);
  if (preset) {
    for (const title of preset.titles) titles.add(title);
  } else if (titles.size === 0 && attrs.seniority.trim()) {
    titles.add(attrs.seniority.trim());
  }
  const ranges = SIZE_RANGES
    .filter((entry) => entry.needles.some((needle) => sizeText.includes(needle)))
    .map((entry) => entry.range);
  const keywords = preset?.keywords ?? (shortIndustryKeyword(attrs.industry) ? [shortIndustryKeyword(attrs.industry)!] : []);
  return assembleParams({
    titles: [...titles],
    relatedTitles: preset?.relatedTitles,
    seniorities: [...seniorities],
    locations: mapGeographyToApolloLocations(attrs.geography),
    keywords,
    relatedKeywords: preset?.relatedKeywords,
    ranges,
  });
}

function parseMappedJson(text: string): PeopleSearchParams | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const industry_keywords = asStringArray(parsed.industry_keywords, 4);
    const q_keywords = typeof parsed.q_keywords === 'string' && parsed.q_keywords.trim()
      ? parsed.q_keywords.trim()
      : industry_keywords?.[0];
    const locations = asStringArray(parsed.person_locations, 25)
      ?? asStringArray(parsed.organization_locations, 25);
    return {
      person_titles: asStringArray(parsed.person_titles, 10),
      related_person_titles: asStringArray(parsed.related_person_titles, 10),
      person_seniorities: closedSeniorities(asStringArray(parsed.person_seniorities, 11)),
      person_locations: locations,
      organization_locations: asStringArray(parsed.organization_locations, 25) ?? locations,
      related_person_locations: asStringArray(parsed.related_person_locations, 25),
      related_organization_locations: asStringArray(parsed.related_organization_locations, 25),
      q_keywords,
      industry_keywords,
      related_industry_keywords: asStringArray(parsed.related_industry_keywords, 4),
      organization_num_employees_ranges: asStringArray(parsed.organization_num_employees_ranges, 4),
    };
  } catch {
    return null;
  }
}

function mergeWithFallback(mapped: PeopleSearchParams, fallback: PeopleSearchParams): PeopleSearchParams {
  const industry_keywords = [
    ...(mapped.industry_keywords ?? []),
    ...(mapped.q_keywords ? [mapped.q_keywords] : []),
    ...(fallback.industry_keywords ?? []),
  ];
  const presetLocations = (fallback.person_locations?.length ?? 0) > 1
    ? fallback.person_locations
    : undefined;
  return assembleParams({
    titles: [...(mapped.person_titles ?? []), ...(fallback.person_titles ?? [])],
    relatedTitles: [...(mapped.related_person_titles ?? []), ...(fallback.related_person_titles ?? [])],
    seniorities: mapped.person_seniorities ?? fallback.person_seniorities,
    locations: presetLocations
      ?? mapped.person_locations
      ?? mapped.organization_locations
      ?? fallback.person_locations,
    relatedLocations: [
      ...(mapped.related_person_locations ?? []),
      ...(mapped.related_organization_locations ?? []),
      ...(fallback.related_person_locations ?? []),
    ],
    keywords: industry_keywords,
    relatedKeywords: [
      ...(mapped.related_industry_keywords ?? []),
      ...(fallback.related_industry_keywords ?? []),
    ],
    ranges: mapped.organization_num_employees_ranges ?? fallback.organization_num_employees_ranges,
  });
}

export async function mapAttributesToSearchParams(
  attrs: LeadAttributes,
): Promise<{ params: PeopleSearchParams; usage?: ReturnType<typeof priceAnthropicMessages> }> {
  const fallback = mapAttributesHeuristic(attrs);
  if (!process.env.ANTHROPIC_API_KEY?.trim() || process.env.DRAFTING_MODE !== 'live') {
    return { params: fallback };
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const ttl = resolvedDraftingPromptCacheTtl();
  const message = await client.messages.create({
    model: MAPPING_MODEL,
    max_tokens: 800,
    system: cachedSystemText(MAP_SYSTEM, ttl),
    messages: [{
      role: 'user',
      content: JSON.stringify({
        industry: attrs.industry,
        seniority: attrs.seniority,
        geography: attrs.geography,
        business_size: attrs.business_size,
      }),
    }],
  });
  const text = message.content
    .flatMap((block) => block.type === 'text' ? [block.text] : [])
    .join('\n');
  const mapped = parseMappedJson(text);
  return {
    params: mapped ? mergeWithFallback(mapped, fallback) : fallback,
    usage: priceAnthropicMessages([message], {
      modelId: MAPPING_MODEL,
      fallbackCacheTtl: ttl,
    }),
  };
}
