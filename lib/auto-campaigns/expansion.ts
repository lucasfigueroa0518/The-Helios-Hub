import { industryKeywordQueue } from '@/lib/auto-campaigns/filter-map';
import { locationsAtHop } from '@/lib/auto-campaigns/geography';
import { APOLLO_SENIORITIES, type PeopleSearchParams } from '@/lib/auto-campaigns/types';

export const EXPANSION_PARAMS = ['geography', 'size', 'industry', 'seniority'] as const;
export type ExpansionParam = (typeof EXPANSION_PARAMS)[number];

/** Rung 0 = original. Rungs 1–3 = adjacent widening. Rung 4 = remaining scope. */
export const MAX_PARAM_RUNG = 4;
export const SOLO_WIDEN_ROUNDS = 3;

export type ExpansionRungs = Record<ExpansionParam, number>;

const SIZE_BANDS = ['1,10', '11,50', '51,200', '201,500', '501,1000', '1001,10000'] as const;

const SENIORITY_RANK: Record<string, number> = {
  intern: 0,
  entry: 1,
  senior: 2,
  manager: 3,
  director: 4,
  head: 5,
  vp: 6,
  partner: 7,
  c_suite: 8,
  founder: 8,
  owner: 8,
};

const PARAM_RUNG_1_LABEL: Record<ExpansionParam, string> = {
  geography: 'Nearby geography',
  size: 'Adjacent size',
  industry: 'Related industry',
  seniority: 'Adjacent seniority',
};

const PARAM_NAME: Record<ExpansionParam, string> = {
  geography: 'Geography',
  size: 'Size',
  industry: 'Industry',
  seniority: 'Seniority',
};

function copyList(values: string[] | undefined): string[] | undefined {
  return values?.length ? [...values] : undefined;
}

function uniqueList(values: Array<string | undefined>): string[] | undefined {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(trimmed);
  }
  return items.length ? items : undefined;
}

function zeroRungs(): ExpansionRungs {
  return { geography: 0, size: 0, industry: 0, seniority: 0 };
}

function rungsKey(rungs: ExpansionRungs): string {
  return EXPANSION_PARAMS.map((param) => rungs[param]).join(',');
}

function wideningScore(rungs: ExpansionRungs): number {
  return EXPANSION_PARAMS.reduce((sum, param) => sum + rungs[param], 0);
}

function paramMask(rungs: ExpansionRungs): number {
  return EXPANSION_PARAMS.reduce((mask, param, index) => (
    rungs[param] > 0
      ? mask | (1 << (EXPANSION_PARAMS.length - 1 - index))
      : mask
  ), 0);
}

function compareRungs(a: ExpansionRungs, b: ExpansionRungs): number {
  const scoreDiff = wideningScore(a) - wideningScore(b);
  if (scoreDiff !== 0) return scoreDiff;
  const maxA = Math.max(...EXPANSION_PARAMS.map((param) => a[param]));
  const maxB = Math.max(...EXPANSION_PARAMS.map((param) => b[param]));
  if (maxA !== maxB) return maxA - maxB;
  const countA = EXPANSION_PARAMS.filter((param) => a[param] > 0).length;
  const countB = EXPANSION_PARAMS.filter((param) => b[param] > 0).length;
  if (countA !== countB) return countA - countB;
  const maskDiff = paramMask(b) - paramMask(a);
  if (maskDiff !== 0) return maskDiff;
  for (const param of EXPANSION_PARAMS) {
    if (a[param] !== b[param]) return a[param] - b[param];
  }
  return 0;
}

/**
 * Step 0 = exact.
 * Then each parameter gets 3 adjacent widenings with every other parameter
 * reset to original. After that, combinations of 2nd/3rd/4th rungs ordered
 * least-widened to most-widened.
 */
function buildExpansionLadder(): ExpansionRungs[] {
  const steps: ExpansionRungs[] = [zeroRungs()];
  const seen = new Set([rungsKey(steps[0]!)]);

  const push = (rungs: ExpansionRungs) => {
    const key = rungsKey(rungs);
    if (seen.has(key)) return;
    seen.add(key);
    steps.push(rungs);
  };

  for (const param of EXPANSION_PARAMS) {
    for (let rung = 1; rung <= SOLO_WIDEN_ROUNDS; rung += 1) {
      push({ ...zeroRungs(), [param]: rung });
    }
  }

  const combos: ExpansionRungs[] = [];
  for (const param of EXPANSION_PARAMS) {
    combos.push({ ...zeroRungs(), [param]: MAX_PARAM_RUNG });
  }
  for (let i = 0; i < EXPANSION_PARAMS.length; i += 1) {
    for (let j = i + 1; j < EXPANSION_PARAMS.length; j += 1) {
      for (const first of [2, 3, 4]) {
        for (const second of [2, 3, 4]) {
          combos.push({
            ...zeroRungs(),
            [EXPANSION_PARAMS[i]!]: first,
            [EXPANSION_PARAMS[j]!]: second,
          });
        }
      }
    }
  }
  for (let skip = 0; skip < EXPANSION_PARAMS.length; skip += 1) {
    for (const level of [2, 3, 4]) {
      const rungs = zeroRungs();
      for (let index = 0; index < EXPANSION_PARAMS.length; index += 1) {
        if (index !== skip) rungs[EXPANSION_PARAMS[index]!] = level;
      }
      combos.push(rungs);
    }
  }
  for (const level of [2, 3, 4]) {
    combos.push({ geography: level, size: level, industry: level, seniority: level });
  }

  combos.sort(compareRungs);
  for (const rungs of combos) push(rungs);
  return steps;
}

export const EXPANSION_LADDER: readonly ExpansionRungs[] = buildExpansionLadder();
export const MAX_EXPANSION_STEP = EXPANSION_LADDER.length - 1;

export function expansionRungsAt(step: number): ExpansionRungs {
  const index = Math.max(0, Math.min(MAX_EXPANSION_STEP, Math.floor(step) || 0));
  return EXPANSION_LADDER[index] ?? zeroRungs();
}

export function expansionLabel(step: number): string {
  const rungs = expansionRungsAt(step);
  const parts: string[] = [];
  for (const param of EXPANSION_PARAMS) {
    const rung = rungs[param];
    if (rung <= 0) continue;
    if (rung === 1) parts.push(PARAM_RUNG_1_LABEL[param]);
    else parts.push(`${PARAM_NAME[param]} +${rung}`);
  }
  return parts.length ? parts.join(' · ') : 'Exact profile';
}

export const EXPANSION_LABELS: readonly string[] = EXPANSION_LADDER.map((_, step) => expansionLabel(step));

function sizeAtRung(exact: string[] | undefined, rung: number): string[] | undefined {
  if (!exact?.length) return undefined;
  if (rung <= 0) return [...exact];
  const indexes = exact
    .map((range) => SIZE_BANDS.indexOf(range as (typeof SIZE_BANDS)[number]))
    .filter((index) => index >= 0);
  if (!indexes.length) return rung >= MAX_PARAM_RUNG ? undefined : [...exact];
  const picked: string[] = [];
  for (let index = 0; index < SIZE_BANDS.length; index += 1) {
    const distance = Math.min(...indexes.map((origin) => Math.abs(index - origin)));
    if (distance === rung) picked.push(SIZE_BANDS[index]!);
  }
  if (picked.length) return picked;
  return rung >= MAX_PARAM_RUNG ? undefined : [...exact];
}

function industryAtRung(
  params: PeopleSearchParams,
  rung: number,
): { titles?: string[]; keywords?: string[] } {
  const exactTitles = copyList(params.person_titles);
  const relatedTitles = copyList(params.related_person_titles) ?? exactTitles;
  const exactKeywords = uniqueList([...(params.industry_keywords ?? []), params.q_keywords]);
  const relatedKeywords = uniqueList(params.related_industry_keywords ?? []) ?? exactKeywords;
  const keep = (keywords: string[] | undefined) => keywords?.length ? keywords : exactKeywords;

  if (rung <= 0) return { titles: exactTitles, keywords: exactKeywords };
  if (rung === 1) {
    return { titles: relatedTitles, keywords: keep(relatedKeywords?.slice(0, 1)) };
  }
  if (rung === 2) {
    const rest = relatedKeywords && relatedKeywords.length > 1
      ? relatedKeywords.slice(1)
      : relatedKeywords;
    return { titles: relatedTitles, keywords: keep(rest) };
  }
  if (rung === 3) return { titles: undefined, keywords: keep(relatedKeywords) };
  return {
    titles: undefined,
    keywords: keep(uniqueList([...(exactKeywords ?? []), ...(relatedKeywords ?? [])])),
  };
}

function seniorityAtRung(exact: string[] | undefined, rung: number): string[] | undefined {
  if (!exact?.length) return undefined;
  if (rung <= 0) return [...exact];
  const originRanks = exact
    .map((value) => SENIORITY_RANK[value])
    .filter((rank): rank is number => rank !== undefined);
  if (!originRanks.length) return [...exact];
  const exactSet = new Set(exact);
  const picked: string[] = [];
  for (const [name, rank] of Object.entries(SENIORITY_RANK)) {
    if (exactSet.has(name)) continue;
    if (name === 'intern' && rung < MAX_PARAM_RUNG) continue;
    const distance = Math.min(...originRanks.map((origin) => Math.abs(rank - origin)));
    if (distance === rung) picked.push(name);
  }
  if (picked.length) return uniqueList(picked);
  if (rung >= MAX_PARAM_RUNG) {
    return uniqueList(
      APOLLO_SENIORITIES.filter((value) => value !== 'intern' || exactSet.has('intern')),
    );
  }
  return [...exact];
}

function geoAtRung(params: PeopleSearchParams, rung: number): string[] | undefined {
  const exact = copyList(params.person_locations) ?? copyList(params.organization_locations) ?? [];
  if (!exact.length) return undefined;
  if (rung <= 0) return exact;
  const ring = locationsAtHop(
    exact,
    rung,
    params.related_person_locations ?? params.related_organization_locations,
  );
  if (ring.length) return ring;
  return exact;
}

export function applyExpansion(params: PeopleSearchParams, step: number): PeopleSearchParams {
  const rungs = expansionRungsAt(step);
  const industry = industryAtRung(params, rungs.industry);
  const geo = geoAtRung(params, rungs.geography);
  const next: PeopleSearchParams = {
    person_titles: industry.titles,
    related_person_titles: copyList(params.related_person_titles),
    person_seniorities: seniorityAtRung(params.person_seniorities, rungs.seniority),
    person_locations: geo,
    organization_locations: geo,
    q_keywords: industry.keywords?.[0],
    industry_keywords: industry.keywords,
    related_industry_keywords: copyList(params.related_industry_keywords),
    related_person_locations: copyList(params.related_person_locations),
    related_organization_locations: copyList(params.related_organization_locations),
    organization_num_employees_ranges: sizeAtRung(params.organization_num_employees_ranges, rungs.size),
  };
  if (!next.q_keywords) {
    next.q_keywords = industryKeywordQueue(next)[0] ?? industryKeywordQueue(params)[0];
  }
  return next;
}

export function shouldAdvanceExpansion(input: {
  attached: number;
  emailsPerDay: number;
  currentStep: number;
}): { nextStep: number; resetCursor: boolean } {
  if (input.attached >= input.emailsPerDay) {
    return { nextStep: input.currentStep, resetCursor: false };
  }
  if (input.currentStep >= MAX_EXPANSION_STEP) {
    return { nextStep: MAX_EXPANSION_STEP, resetCursor: false };
  }
  return { nextStep: input.currentStep + 1, resetCursor: true };
}
