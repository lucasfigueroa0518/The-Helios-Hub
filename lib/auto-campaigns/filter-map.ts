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
import {
  EASTERN_US_LOCATIONS,
  isApolloEmployeeRange,
  parseLocations,
  parseTargeting,
  type TargetingParse,
} from '@/lib/auto-campaigns/targeting-parse';
import { buildMappingSystemPrompt } from '@/lib/auto-campaigns/mapping-prompt';

const SENIORITY_SET = new Set<string>(APOLLO_SENIORITIES);

export { EASTERN_US_LOCATIONS };

type IndustryPreset = {
  needles: string[];
  titles: string[];
  keywords: string[];
  relatedTitles: string[];
  relatedKeywords: string[];
};

/** Offline title/keyword boost only. Never sent to Haiku. */
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
  const locations = parseLocations(geography);
  return locations.length ? locations : undefined;
}

function industryPresetFor(industry: string): IndustryPreset | undefined {
  return matchPreset(industry, INDUSTRY_PRESETS);
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
  const parsed = parseTargeting(attrs);
  const preset = industryPresetFor(attrs.industry);
  const titles = [
    ...parsed.seniority_titles,
    ...(preset?.titles ?? []),
  ];
  const keywords = preset?.keywords ?? parsed.industry_tokens;
  return assembleParams({
    titles,
    relatedTitles: preset?.relatedTitles,
    seniorities: parsed.seniority_tokens,
    locations: parsed.locations,
    keywords,
    relatedKeywords: preset?.relatedKeywords,
    ranges: parsed.size_ranges,
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
    const ranges = (asStringArray(parsed.organization_num_employees_ranges, 4) ?? [])
      .filter((range) => isApolloEmployeeRange(range));
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
      organization_num_employees_ranges: ranges.length ? ranges : undefined,
    };
  } catch {
    return null;
  }
}

function mergeWithFallback(
  mapped: PeopleSearchParams,
  fallback: PeopleSearchParams,
  parsed: TargetingParse,
): PeopleSearchParams {
  const industry_keywords = [
    ...parsed.industry_tokens,
    ...(mapped.industry_keywords ?? []),
    ...(mapped.q_keywords ? [mapped.q_keywords] : []),
    ...(fallback.industry_keywords ?? []),
  ];
  const locations = parsed.locations.length
    ? parsed.locations
    : mapped.person_locations
      ?? mapped.organization_locations
      ?? fallback.person_locations;
  const ranges = parsed.size_ranges.length
    ? parsed.size_ranges
    : mapped.organization_num_employees_ranges
      ?? fallback.organization_num_employees_ranges;
  return assembleParams({
    titles: [...(mapped.person_titles ?? []), ...(fallback.person_titles ?? [])],
    relatedTitles: [...(mapped.related_person_titles ?? []), ...(fallback.related_person_titles ?? [])],
    seniorities: [
      ...(mapped.person_seniorities ?? []),
      ...parsed.seniority_tokens,
      ...(fallback.person_seniorities ?? []),
    ],
    locations,
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
    ranges,
  });
}

export async function mapAttributesToSearchParams(
  attrs: LeadAttributes,
): Promise<{ params: PeopleSearchParams; usage?: ReturnType<typeof priceAnthropicMessages> }> {
  const parsed = parseTargeting(attrs);
  const fallback = mapAttributesHeuristic(attrs);
  if (!process.env.ANTHROPIC_API_KEY?.trim() || process.env.DRAFTING_MODE !== 'live') {
    return { params: fallback };
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const ttl = resolvedDraftingPromptCacheTtl();
  const message = await client.messages.create({
    model: MAPPING_MODEL,
    max_tokens: 800,
    system: cachedSystemText(buildMappingSystemPrompt(), ttl),
    messages: [{
      role: 'user',
      content: JSON.stringify({
        industry: attrs.industry,
        seniority: attrs.seniority,
        geography: attrs.geography,
        business_size: attrs.business_size,
        industry_tokens: parsed.industry_tokens,
        seniority_tokens: parsed.seniority_tokens,
        locations: parsed.locations,
        size_ranges: parsed.size_ranges,
      }),
    }],
  });
  const text = message.content
    .flatMap((block) => block.type === 'text' ? [block.text] : [])
    .join('\n');
  const mapped = parseMappedJson(text);
  return {
    params: mapped ? mergeWithFallback(mapped, fallback, parsed) : fallback,
    usage: priceAnthropicMessages([message], {
      modelId: MAPPING_MODEL,
      fallbackCacheTtl: ttl,
    }),
  };
}
