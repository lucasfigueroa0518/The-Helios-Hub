import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APOLLO_SEARCH_PER_PAGE,
  assertPeopleSearchTool,
  nextSearchPage,
  organizationSearchAllowed,
  selectIdsToEnrich,
} from '@/lib/auto-campaigns/credit-pipeline';
import { applyExpansion, expansionLabel, expansionRungsAt, shouldAdvanceExpansion } from '@/lib/auto-campaigns/expansion';
import { mapAttributesHeuristic } from '@/lib/auto-campaigns/filter-map';
import { constrainToSameCountry, locationsAtHop, nearbySameCountryLocations } from '@/lib/auto-campaigns/geography';
import { runPeopleSearchProspecting } from '@/lib/auto-campaigns/prospect';
import { computeAutoReservations } from '@/lib/auto-campaigns/reservations';
import { pickQueueColor, uniqueCampaignColors } from '@/lib/auto-campaigns/queue-colors';
import {
  nextAutoCycleAfterCompletion,
  nextAutoCycleAt,
  shouldRunFirstCycleNow,
  staggerMinuteOfDay,
} from '@/lib/auto-campaigns/schedule';
import { searchOrganizationsRest, type ApolloPeopleClient } from '@/lib/auto-campaigns/apollo';
import type { EnrichedPerson, PeopleSearchHit, PeopleSearchParams } from '@/lib/auto-campaigns/types';
import { formatNyDate } from '@/lib/drafting/send-queue-schedule';
import { laneLimit } from '@/lib/orchestration/config';

function hit(id: string, linkedin?: string): PeopleSearchHit {
  return { apolloPersonId: id, linkedinUrl: linkedin ?? null, name: id };
}

function person(id: string, email?: string): EnrichedPerson {
  return {
    apolloPersonId: id,
    fullName: id,
    email: email ?? null,
    emailVerified: Boolean(email),
  };
}

function fakeClient(pages: Record<number, PeopleSearchHit[]>): ApolloPeopleClient & {
  enrichCalls: string[][];
} {
  const enrichCalls: string[][] = [];
  return {
    enrichCalls,
    async searchPeople(_params: PeopleSearchParams, page: number) {
      return pages[page] ?? [];
    },
    async enrichPeople(ids: string[]) {
      enrichCalls.push([...ids]);
      return ids.map((id) => person(id, `${id}@example.com`));
    },
  };
}

test('people-search is allowed; enrich and org search are refused unless explicitly enabled', () => {
  assert.doesNotThrow(() => assertPeopleSearchTool('search_people'));
  assert.throws(() => assertPeopleSearchTool('enrich_people'), /must not call Apollo enrich/);
  assert.throws(() => assertPeopleSearchTool('search_organizations'), /1 Apollo credit/);
  const prior = process.env.AUTO_APOLLO_ORG_SEARCH;
  process.env.AUTO_APOLLO_ORG_SEARCH = '1';
  try {
    assert.equal(organizationSearchAllowed(), true);
    assert.doesNotThrow(() => assertPeopleSearchTool('search_organizations'));
  } finally {
    if (prior === undefined) delete process.env.AUTO_APOLLO_ORG_SEARCH;
    else process.env.AUTO_APOLLO_ORG_SEARCH = prior;
  }
});

test('organization search REST is disabled by default', async () => {
  const prior = process.env.AUTO_APOLLO_ORG_SEARCH;
  delete process.env.AUTO_APOLLO_ORG_SEARCH;
  try {
    await assert.rejects(searchOrganizationsRest(), /1 Apollo credit/);
  } finally {
    if (prior === undefined) delete process.env.AUTO_APOLLO_ORG_SEARCH;
    else process.env.AUTO_APOLLO_ORG_SEARCH = prior;
  }
});

test('selectIdsToEnrich drops stored Apollo IDs and LinkedIn URLs before taking quota', () => {
  const selected = selectIdsToEnrich({
    hits: [
      hit('known-1'),
      hit('new-1', 'https://www.linkedin.com/in/already'),
      hit('new-2'),
      hit('new-3'),
      hit('new-4'),
    ],
    knownApolloIds: new Set(['known-1']),
    knownLinkedinUrls: new Set(['linkedin.com/in/already']),
    quota: 2,
  });
  assert.deepEqual(selected.toEnrich, ['new-2', 'new-3']);
  assert.equal(selected.skippedKnown, 2);
  assert.equal(selected.leftoverNew, 1);
  assert.equal(selected.pageExhausted, false);
  assert.equal(nextSearchPage(4, false), 4);
  assert.equal(nextSearchPage(4, true), 5);
});

test('prospecting never enriches stored IDs and stops once emails_per_day verified leads attach', async () => {
  const page1 = Array.from({ length: APOLLO_SEARCH_PER_PAGE }, (_, index) => hit(`p1-${index}`));
  const client = fakeClient({
    1: page1,
    2: [hit('p2-a'), hit('p2-b')],
  });
  const known = new Set(page1.slice(0, 90).map((row) => row.apolloPersonId));
  const result = await runPeopleSearchProspecting(client, {
    emailsPerDay: 3,
    page: 1,
    searchParams: { q_keywords: 'cre' },
    expansionStep: 0,
    knownApolloIds: known,
    knownLinkedinUrls: new Set(),
  });
  const enriched = client.enrichCalls.flat();
  assert.equal(result.attached.length, 3);
  assert.equal(result.filled, true);
  assert.equal(enriched.length, 3);
  assert.ok(enriched.every((id) => !known.has(id)));
  assert.equal(result.stats.enrich_attempted, 3);
  assert.equal(result.stats.skipped_known, 90);
  assert.equal(result.pageEnd, 1);
});

test('people search retries the next industry keyword before treating inventory as exhausted', async () => {
  const seen: Array<string | undefined> = [];
  const client: ApolloPeopleClient & { enrichCalls: string[][] } = {
    enrichCalls: [],
    async searchPeople(params) {
      seen.push(params.q_keywords);
      if (params.q_keywords === 'janitorial') return [];
      return [hit('fit-1'), hit('fit-2')];
    },
    async enrichPeople(ids) {
      client.enrichCalls.push([...ids]);
      return ids.map((id) => person(id, `${id}@x.com`));
    },
  };
  const result = await runPeopleSearchProspecting(client, {
    emailsPerDay: 2,
    page: 1,
    searchParams: {
      industry_keywords: ['janitorial', 'commercial cleaning'],
      q_keywords: 'janitorial',
    },
    expansionStep: 0,
    knownApolloIds: new Set(),
    knownLinkedinUrls: new Set(),
  });
  assert.deepEqual(seen, ['janitorial', 'commercial cleaning']);
  assert.equal(result.attached.length, 2);
  assert.equal(result.filled, true);
  assert.equal(result.inventoryExhausted, false);
});

test('unverified enrich does not consume the daily lead quota; search continues until verified count is met', async () => {
  const client: ApolloPeopleClient & { enrichCalls: string[][] } = {
    enrichCalls: [],
    async searchPeople() {
      return [hit('a'), hit('b'), hit('c'), hit('d')];
    },
    async enrichPeople(ids) {
      client.enrichCalls.push([...ids]);
      return ids.map((id, index) => (
        id === 'c' || id === 'd' ? person(id, `${id}@x.com`) : person(id)
      ));
    },
  };
  const result = await runPeopleSearchProspecting(client, {
    emailsPerDay: 2,
    page: 7,
    searchParams: {},
    expansionStep: 0,
    knownApolloIds: new Set(),
    knownLinkedinUrls: new Set(),
  });
  assert.deepEqual(client.enrichCalls.flat(), ['a', 'b', 'c', 'd']);
  assert.equal(result.attached.length, 2);
  assert.equal(result.filled, true);
  assert.equal(result.storedWithoutEmail.length, 2);
  assert.equal(result.pageEnd, 7);
  assert.equal(result.stats.enrich_attempted, 4);
});

test('quota stays short across a page of unverified hits and keeps leftover IDs on the same page', async () => {
  const page1 = [hit('u1'), hit('u2'), hit('v1'), hit('v2'), hit('v3')];
  const client: ApolloPeopleClient & { enrichCalls: string[][] } = {
    enrichCalls: [],
    async searchPeople() {
      return page1;
    },
    async enrichPeople(ids) {
      client.enrichCalls.push([...ids]);
      return ids.map((id) => (id.startsWith('v') ? person(id, `${id}@x.com`) : person(id)));
    },
  };
  const result = await runPeopleSearchProspecting(client, {
    emailsPerDay: 2,
    page: 1,
    searchParams: {},
    expansionStep: 0,
    knownApolloIds: new Set(),
    knownLinkedinUrls: new Set(),
  });
  assert.equal(result.attached.length, 2);
  assert.deepEqual(result.attached.map((row) => row.apolloPersonId), ['v1', 'v2']);
  assert.ok(client.enrichCalls.flat().includes('u1'));
  assert.ok(client.enrichCalls.flat().includes('v2'));
  assert.equal(result.filled, true);
  assert.equal(result.pageEnd, 1);
  assert.equal(result.inventoryExhausted, false);
});

test('a last short page of unverified people exhausts inventory instead of stopping at the attempt count', async () => {
  const client: ApolloPeopleClient & { enrichCalls: string[][] } = {
    enrichCalls: [],
    async searchPeople() {
      return [hit('a'), hit('b'), hit('c')];
    },
    async enrichPeople(ids) {
      client.enrichCalls.push([...ids]);
      return ids.map((id) => person(id));
    },
  };
  const result = await runPeopleSearchProspecting(client, {
    emailsPerDay: 2,
    page: 4,
    searchParams: {},
    expansionStep: 0,
    knownApolloIds: new Set(),
    knownLinkedinUrls: new Set(),
  });
  assert.deepEqual(client.enrichCalls.flat(), ['a', 'b', 'c']);
  assert.equal(result.attached.length, 0);
  assert.equal(result.filled, false);
  assert.equal(result.inventoryExhausted, true);
  assert.equal(result.storedWithoutEmail.length, 3);
  assert.equal(result.pageEnd, 4);
});

test('a second cycle resumes the persisted page and does not restart at page 1', async () => {
  const pages: Record<number, PeopleSearchHit[]> = {
    3: [hit('keep-1'), hit('keep-2'), hit('keep-3')],
    1: [hit('page-1-should-not-run')],
  };
  const seenPages: number[] = [];
  const client: ApolloPeopleClient = {
    async searchPeople(_params, page) {
      seenPages.push(page);
      return pages[page] ?? [];
    },
    async enrichPeople(ids) {
      return ids.map((id) => person(id, `${id}@x.com`));
    },
  };
  const first = await runPeopleSearchProspecting(client, {
    emailsPerDay: 1,
    page: 3,
    searchParams: {},
    expansionStep: 0,
    knownApolloIds: new Set(),
    knownLinkedinUrls: new Set(),
  });
  const second = await runPeopleSearchProspecting(client, {
    emailsPerDay: 1,
    page: first.pageEnd,
    searchParams: {},
    expansionStep: 0,
    knownApolloIds: new Set(first.attached.map((row) => row.apolloPersonId)),
    knownLinkedinUrls: new Set(),
  });
  assert.ok(!seenPages.includes(1));
  assert.deepEqual(seenPages, [3, 3]);
  assert.equal(first.attached[0]?.apolloPersonId, 'keep-1');
  assert.equal(second.attached[0]?.apolloPersonId, 'keep-2');
  assert.equal(second.pageEnd, 3);
});

test('geography hops stay in the same country and move to adjacent rings', () => {
  const nearby = nearbySameCountryLocations(['New York', 'New Jersey', 'Pennsylvania']);
  assert.ok(nearby.includes('Ohio') || nearby.includes('Connecticut') || nearby.includes('Delaware'));
  assert.ok(!nearby.includes('United Kingdom'));
  assert.ok(!nearby.includes('Australia'));
  const dropped = constrainToSameCountry(
    ['New York', 'Florida'],
    ['Ohio', 'London', 'Auckland', 'Sydney'],
  );
  assert.deepEqual(dropped, ['Ohio']);
  const nyc = nearbySameCountryLocations(['NYC']);
  assert.ok(nyc.includes('New Jersey') || nyc.includes('Connecticut'));
  assert.ok(!nyc.includes('United Kingdom'));
  const hop2 = locationsAtHop(['New York'], 2);
  assert.ok(hop2.includes('Ohio') || hop2.includes('Rhode Island') || hop2.includes('Maryland'));
  assert.ok(!hop2.includes('New York'));
  assert.ok(!hop2.includes('United Kingdom'));
  const hop4 = locationsAtHop(['New York'], 4);
  assert.deepEqual(hop4, ['United States']);
});

test('filter mapping is heuristic JSON only — no organization ids', () => {
  const mapped = mapAttributesHeuristic({
    industry: 'CRE brokerage',
    seniority: 'Managing Partner',
    geography: 'New York',
    business_size: '11-50',
  });
  assert.ok(!('organization_ids' in mapped));
  assert.deepEqual(mapped.person_locations, ['New York']);
  assert.ok(mapped.organization_num_employees_ranges?.includes('11,50'));
  assert.equal(mapped.q_keywords, 'commercial real estate');
  assert.ok(mapped.person_titles?.includes('Broker'));
});

test('open-text industry maps to titles and short keywords, not the raw sentence', () => {
  const mapped = mapAttributesHeuristic({
    industry: 'Commercial cleaning/janitorial management companies',
    seniority: 'Senior',
    geography: 'Eastern United States',
    business_size: '11-50',
  });
  assert.equal(mapped.q_keywords, 'janitorial');
  assert.deepEqual(mapped.industry_keywords, ['janitorial', 'commercial cleaning']);
  assert.ok(mapped.person_titles?.includes('Facilities Manager'));
  assert.ok(mapped.person_locations?.includes('New York'));
  assert.ok(mapped.person_locations?.includes('Florida'));
  assert.ok(!mapped.person_locations?.some((location) => location.includes('Northeast')));
  assert.ok(!mapped.q_keywords?.includes('11-50'));
  assert.ok(mapped.related_industry_keywords?.includes('facilities services'));
  assert.ok(mapped.related_person_locations?.includes('Ohio'));
  assert.ok(!mapped.related_person_locations?.includes('United Kingdom'));
});

test('expansion infers nearby same-country places when related geo is missing', () => {
  const exact: PeopleSearchParams = {
    person_locations: ['New York', 'New Jersey', 'Pennsylvania'],
    q_keywords: 'janitorial',
  };
  const widened = applyExpansion(exact, 1).person_locations ?? [];
  assert.ok(widened.includes('Ohio') || widened.includes('Connecticut') || widened.includes('Delaware'));
  assert.ok(!widened.includes('United Kingdom'));
  assert.ok(!widened.includes('Australia'));
});

test('expansion does three adjacent widenings per parameter before mixing rungs', () => {
  const exact: PeopleSearchParams = {
    person_locations: ['New York'],
    organization_locations: ['New York'],
    related_person_locations: ['New Jersey', 'Connecticut', 'Pennsylvania'],
    organization_num_employees_ranges: ['11,50'],
    q_keywords: 'janitorial',
    industry_keywords: ['janitorial', 'commercial cleaning'],
    related_industry_keywords: ['facilities services', 'building maintenance'],
    related_person_titles: ['Facilities Director'],
    person_titles: ['Janitorial Manager'],
    person_seniorities: ['partner'],
  };

  assert.deepEqual(expansionRungsAt(0), { geography: 0, size: 0, industry: 0, seniority: 0 });
  assert.deepEqual(expansionRungsAt(1), { geography: 1, size: 0, industry: 0, seniority: 0 });
  assert.deepEqual(expansionRungsAt(3), { geography: 3, size: 0, industry: 0, seniority: 0 });
  assert.deepEqual(expansionRungsAt(4), { geography: 0, size: 1, industry: 0, seniority: 0 });
  assert.deepEqual(expansionRungsAt(7), { geography: 0, size: 0, industry: 1, seniority: 0 });
  assert.deepEqual(expansionRungsAt(10), { geography: 0, size: 0, industry: 0, seniority: 1 });
  assert.deepEqual(expansionRungsAt(13), { geography: 2, size: 2, industry: 0, seniority: 0 });
  assert.equal(expansionLabel(0), 'Exact profile');
  assert.equal(expansionLabel(1), 'Nearby geography');
  assert.equal(expansionLabel(4), 'Adjacent size');
  assert.equal(expansionLabel(13), 'Geography +2 · Size +2');

  assert.deepEqual(applyExpansion(exact, 0).person_locations, ['New York']);
  assert.deepEqual(applyExpansion(exact, 1).person_locations, ['New Jersey', 'Connecticut', 'Pennsylvania']);
  assert.deepEqual(applyExpansion(exact, 1).organization_num_employees_ranges, ['11,50']);
  assert.ok(!applyExpansion(exact, 1).person_locations?.includes('United Kingdom'));

  const geoTwo = applyExpansion(exact, 2);
  assert.ok((geoTwo.person_locations ?? []).includes('Ohio') || (geoTwo.person_locations ?? []).includes('Rhode Island'));
  assert.deepEqual(geoTwo.organization_num_employees_ranges, ['11,50']);
  assert.equal(geoTwo.q_keywords, 'janitorial');
  assert.ok(!geoTwo.person_locations?.includes('United Kingdom'));

  const sizeOne = applyExpansion(exact, 4);
  assert.deepEqual(sizeOne.person_locations, ['New York']);
  assert.deepEqual(sizeOne.organization_num_employees_ranges, ['1,10', '51,200']);
  assert.equal(sizeOne.q_keywords, 'janitorial');
  assert.deepEqual(sizeOne.person_titles, ['Janitorial Manager']);

  const industryOne = applyExpansion(exact, 7);
  assert.deepEqual(industryOne.person_locations, ['New York']);
  assert.deepEqual(industryOne.organization_num_employees_ranges, ['11,50']);
  assert.equal(industryOne.q_keywords, 'facilities services');
  assert.deepEqual(industryOne.person_titles, ['Facilities Director']);

  const combo = applyExpansion(exact, 13);
  assert.ok((combo.person_locations ?? []).includes('Ohio') || (combo.person_locations ?? []).includes('Rhode Island'));
  assert.deepEqual(combo.organization_num_employees_ranges, ['201,500']);
  assert.equal(combo.q_keywords, 'janitorial');
  assert.deepEqual(combo.person_seniorities, ['partner']);

  assert.deepEqual(shouldAdvanceExpansion({ attached: 10, emailsPerDay: 10, currentStep: 0 }), {
    nextStep: 0,
    resetCursor: false,
  });
  assert.deepEqual(shouldAdvanceExpansion({ attached: 2, emailsPerDay: 10, currentStep: 0 }), {
    nextStep: 1,
    resetCursor: true,
  });
});

test('queue reservations subtract already slotted sends and skip weekends', () => {
  const locks = computeAutoReservations({
    today: '2026-08-20',
    from: '2026-08-20',
    to: '2026-08-24',
    campaigns: [{
      campaignId: 'c1',
      campaignName: 'NYC CRE',
      emailsPerDay: 10,
      queueColor: 'chart-1',
      leadAttributes: {
        industry: 'CRE',
        seniority: 'Partner',
        geography: 'NYC',
        business_size: '11-50',
      },
      expansionStep: 0,
      queuedOrSentByDate: { '2026-08-20': 4 },
    }],
  });
  const byDate = Object.fromEntries(locks.map((lock) => [lock.schedule_date, lock.reserved]));
  assert.equal(byDate['2026-08-20'], 6);
  assert.equal(byDate['2026-08-21'], 10);
  assert.equal(byDate['2026-08-22'], undefined);
  assert.equal(byDate['2026-08-23'], undefined);
  assert.equal(byDate['2026-08-24'], 10);
});

test('queue colors stay unique across campaigns and skip colliding greens', () => {
  assert.deepEqual(
    [...uniqueCampaignColors([
      { campaignId: 'a', queueColor: 'chart-1' },
      { campaignId: 'b', queueColor: 'chart-1' },
      { campaignId: 'c', queueColor: 'chart-3' },
    ]).values()],
    ['chart-1', 'chart-2', 'chart-3'],
  );
  assert.equal(pickQueueColor(['chart-1', 'chart-2']), 'chart-3');
  assert.equal(pickQueueColor([...Array.from({ length: 10 }, (_, i) => `chart-${i + 1}`)]), 'chart-1');
});

test('weekday cycles stagger inside 2–6am ET and skip Saturday/Sunday', () => {
  const minute = staggerMinuteOfDay('campaign-fixture');
  assert.ok(minute >= 2 * 60);
  assert.ok(minute < 6 * 60);

  const saturday = new Date('2026-08-22T16:00:00.000Z');
  assert.equal(shouldRunFirstCycleNow(saturday), false);
  const next = nextAutoCycleAt('campaign-fixture', saturday);
  assert.equal(formatNyDate(next), '2026-08-24');

  const thursday = new Date('2026-08-20T18:00:00.000Z');
  assert.equal(shouldRunFirstCycleNow(thursday), true);
  const afterRun = nextAutoCycleAfterCompletion('campaign-fixture', thursday);
  assert.equal(formatNyDate(afterRun), '2026-08-21');
});

test('only one Auto cycle lane runs at a time', () => {
  assert.equal(laneLimit('auto_campaign'), 1);
});
