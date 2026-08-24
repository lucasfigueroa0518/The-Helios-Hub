import assert from 'node:assert/strict';
import test from 'node:test';

import { mapAttributesHeuristic, mapAttributesToSearchParams } from '@/lib/auto-campaigns/filter-map';
import { nearbySameCountryLocations } from '@/lib/auto-campaigns/geography';
import { buildMappingSystemPrompt } from '@/lib/auto-campaigns/mapping-prompt';
import { parseIndustryTokens, parseLocations, parseSizeRanges, parseTargeting } from '@/lib/auto-campaigns/targeting-parse';

test('comma industry tokens stay separate short keywords', () => {
  const tokens = parseIndustryTokens('trucking, freight, logistics');
  assert.deepEqual(tokens, ['trucking', 'freight', 'logistics']);
  const mapped = mapAttributesHeuristic({
    industry: 'trucking, freight, logistics',
    seniority: 'Owner',
    geography: 'Boston, Massachusetts',
    business_size: '11-50',
  });
  assert.deepEqual(mapped.industry_keywords, ['trucking', 'freight', 'logistics']);
  assert.ok(!mapped.q_keywords?.includes('trucking freight'));
});

test('comma seniorities map onto the closed Apollo set', () => {
  const parsed = parseTargeting({
    industry: 'logistics',
    seniority: 'Owner, President, Director, VP',
    geography: 'Boston',
    business_size: '51-200',
  });
  assert.ok(parsed.seniority_tokens.includes('owner'));
  assert.ok(parsed.seniority_tokens.includes('director'));
  assert.ok(parsed.seniority_tokens.includes('vp'));
  assert.ok(parsed.seniority_tokens.includes('c_suite'));
});

test('Greater Boston and Boston, Massachusetts stay in the US', () => {
  assert.deepEqual(parseLocations('Greater Boston'), ['Boston', 'Massachusetts']);
  assert.deepEqual(parseLocations('Boston, Massachusetts'), ['Boston', 'Massachusetts']);
  const mapped = mapAttributesHeuristic({
    industry: 'trucking, freight, logistics',
    seniority: 'Owner, Decision Makers',
    geography: 'Greater Boston',
    business_size: '11-100',
  });
  assert.ok(mapped.person_locations?.includes('Boston'));
  assert.ok(mapped.person_locations?.includes('Massachusetts'));
  assert.ok(!mapped.person_locations?.some((location) => /greater/i.test(location)));
  const nearby = nearbySameCountryLocations(mapped.person_locations ?? []);
  assert.ok(nearby.includes('New Hampshire') || nearby.includes('Rhode Island') || nearby.includes('Connecticut'));
  assert.ok(!nearby.includes('United Kingdom'));
});

test('size spans use overlap and never substring-match 1-10', () => {
  assert.deepEqual(parseSizeRanges('11-100'), ['11,50', '51,200']);
  assert.deepEqual(parseSizeRanges('11-50, 51-200'), ['11,50', '51,200']);
  const mapped = mapAttributesHeuristic({
    industry: 'trucking',
    seniority: 'Owner',
    geography: 'Boston',
    business_size: '11-100',
  });
  assert.deepEqual(mapped.organization_num_employees_ranges, ['11,50', '51,200']);
  assert.ok(!mapped.organization_num_employees_ranges?.includes('1,10'));
});

test('heuristic mapping works when DRAFTING_MODE is unset', async () => {
  const prior = process.env.DRAFTING_MODE;
  delete process.env.DRAFTING_MODE;
  try {
    const attrs = {
      industry: 'trucking, freight, logistics',
      seniority: 'Owner, President, Director, VP',
      geography: 'Boston, Massachusetts',
      business_size: '11-50, 51-200',
    };
    const { params } = await mapAttributesToSearchParams(attrs);
    assert.deepEqual(params, mapAttributesHeuristic(attrs));
    assert.deepEqual(params.industry_keywords, ['trucking', 'freight', 'logistics']);
    assert.deepEqual(params.organization_num_employees_ranges, ['11,50', '51,200']);
  } finally {
    if (prior === undefined) delete process.env.DRAFTING_MODE;
    else process.env.DRAFTING_MODE = prior;
  }
});

test('Haiku mapping prompt is catalog-only and names no industries', () => {
  const prompt = buildMappingSystemPrompt();
  assert.match(prompt, /CLOSED SENIORITIES/);
  assert.match(prompt, /EMPLOYEE RANGES/);
  assert.match(prompt, /METRO ALIASES/);
  assert.match(prompt, /OUTPUT JSON SCHEMA/);
  assert.doesNotMatch(prompt, /janitor/i);
  assert.doesNotMatch(prompt, /\bCRE\b/);
  assert.doesNotMatch(prompt, /commercial real estate/i);
  assert.doesNotMatch(prompt, /few-shot/i);
});
