/** Intake scorecards, posted check and the builder lane (Owner B). Offline: a recording stub Jev, no live calls. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { postedCheck } from '@/lib/intake/posted';
import { BUILDER_CARD, MAJOR_NEWS_CARD, REELS_SCORE, STORY_SCORING } from '@/lib/intake/scorecards';
import { SCORING_PASS_1 } from '@/lib/reels/jev/questions/scoring-pass1';
import { SCORING_PASS_2 } from '@/lib/reels/jev/questions/scoring-pass2';
import { BUILDER, MAJOR_NEWS } from '@/lib/stories/questions';
import { BUILDER_BAR, builderScore, leadOf, MAJOR_NEWS_BAR, majorNewsScore } from '@/lib/stories/scores';

import { item, story, stubJev } from './fixtures/intake/stubs';

const mixed = () =>
  story('s1', [
    item({ key: 'r1', family: 'reels', role: 'primary', sourceName: 'Hacker News' }),
    item({ key: 'w1', family: 'search', sourceName: 'Claude search' }),
    item({ key: 'f1', family: 'feeds', sourceId: 'feed:verge', sourceName: 'The Verge' }),
    item({ key: 'f2', family: 'feeds', sourceId: 'feed:wired', sourceName: 'Wired' }),
    item({ key: 'f3', family: 'feeds', sourceId: 'feed:verge-gn', sourceName: 'The Verge' }),
    item({ key: 'x1', family: 'seed', sourceName: 'person' }),
  ]);

test('reels-score: pass 1 (+ pass 2) on reels and search members only, version from the sets', async () => {
  const { jev, social, reels } = stubJev();
  const out = await REELS_SCORE.score(mixed(), jev);
  assert.equal(REELS_SCORE.version, `${SCORING_PASS_1.version}+${SCORING_PASS_2.version}`);
  assert.equal(social.length, 0);
  assert.equal(reels[0]!.component, 'scoring-pass1');
  assert.equal(reels[0]!.sets[0], SCORING_PASS_1);
  const members = (reels[0]!.state as { post_idea: { members: Array<{ source_name?: string; sourceName?: string }> } }).post_idea.members;
  assert.equal(members.length, 2);
  const names = JSON.stringify(members);
  assert.ok(names.includes('Hacker News') && names.includes('Claude search'));
  assert.ok(!names.includes('The Verge') && !names.includes('person'));
  assert.equal(out.result.kind, 'reels-score');
  assert.ok(out.usd > 0);
});

test('story-scoring: feeds members only, no already_posted and no recently_posted', async () => {
  const { jev, social, reels } = stubJev({ nouls: { ai_main_subject: 0.9, substance: 0.9, news_event: 0.9, commentary: 0.1, skip_weapons_war: 0, skip_death_tragedy: 0, skip_crime_violence: 0, skip_sexual_abuse: 0 } });
  const out = await STORY_SCORING.score(mixed(), jev);
  assert.equal(reels.length, 0);
  assert.equal(social.length, 1);
  const call = social[0]!;
  assert.equal(call.meta.version, 'story-scoring@4');
  assert.ok(!('already_posted' in call.questions));
  assert.ok(!('recently_posted' in call.state));
  const s = call.state.story as { outlets: string[]; outlet_count: number };
  assert.deepEqual(s.outlets.sort(), ['The Verge', 'Wired']);
  assert.equal(s.outlet_count, 2);
  assert.equal(out.result.kind, 'story-scoring');
  if (out.result.kind === 'story-scoring') {
    assert.equal(out.result.status, 'qualified');
    assert.equal(out.result.outletCount, 2);
    assert.ok(!('already_posted' in out.result.answers));
  }
});

test('major-news: scoreMajor state shape with major-news@3; score = majorNewsScore', async () => {
  const { jev, social } = stubJev({ nouls: { happened: 1, news_kind: 1, speculative: 0 } });
  const out = await MAJOR_NEWS_CARD.score(mixed(), jev);
  const call = social[0]!;
  assert.equal(call.meta.version, 'major-news@3');
  assert.deepEqual(Object.keys(call.questions).sort(), Object.keys(MAJOR_NEWS.questions).sort());
  assert.deepEqual(Object.keys(call.state).sort(), ['headline', 'outlets', 'published', 'story']);
  const st = call.state as { outlets: string[]; story: { untrusted_content: string } };
  assert.equal(st.outlets[0], 'Hacker News'); // representative first
  assert.ok(st.story.untrusted_content.length <= 9000);
  const expected = majorNewsScore(Object.fromEntries(Object.keys(MAJOR_NEWS.questions).map((k) => [k, { noul: ({ happened: 1, news_kind: 1, speculative: 0 } as Record<string, number>)[k] ?? 0.5 }])));
  assert.deepEqual(out.result, { kind: 'major-news', score: expected });
  assert.deepEqual(MAJOR_NEWS_CARD.families, ['reels', 'feeds', 'search', 'seed']);
});

test('story-builder: same state shape with story-builder@2; speculative reused; score = builderScore', async () => {
  const { jev, social } = stubJev();
  const out = await BUILDER_CARD.score(mixed(), jev);
  const call = social[0]!;
  assert.equal(call.meta.version, 'story-builder@2');
  assert.equal(BUILDER.id, 'story-builder');
  assert.deepEqual(Object.keys(call.questions).sort(), ['general_interest', 'made_or_found', 'pushes_limits', 'routine_launch', 'shown_working', 'speculative']);
  assert.equal(BUILDER.questions.speculative, MAJOR_NEWS.questions.speculative);
  assert.deepEqual(Object.keys(call.state).sort(), ['headline', 'outlets', 'published', 'story']);
  assert.equal(out.result.kind, 'story-builder');
  if (out.result.kind === 'story-builder') assert.ok(Math.abs(out.result.score - builderScore(Object.fromEntries(Object.keys(BUILDER.questions).map((k) => [k, { noul: 0.5 }])))) < 1e-12);
});

test('majorNewsScore matches the Morning Download original (weights .3/.25/.2/.15/.1/−.35, floored at 0)', () => {
  const fixtures: Array<[Record<string, number>, number]> = [
    [{ happened: 1, news_kind: 1, blockbuster_entity: 1, global_relevance: 1, political_relevance: 1, speculative: 1 }, 0.65],
    [{ happened: 0.9, news_kind: 0.8, blockbuster_entity: 0.1, global_relevance: 0.5, political_relevance: 0, speculative: 0.2 }, 0.495],
    [{ speculative: 1 }, 0],
  ];
  for (const [n, want] of fixtures) {
    const got = majorNewsScore(Object.fromEntries(Object.entries(n).map(([k, v]) => [k, { noul: v }])));
    assert.ok(Math.abs(got - want) < 1e-12, `${JSON.stringify(n)} → ${got}, want ${want}`);
  }
  assert.equal(MAJOR_NEWS_BAR, 0.55);
});

test('builderScore weights and floor', () => {
  const s = (n: Record<string, number>) => builderScore(Object.fromEntries(Object.entries(n).map(([k, v]) => [k, { noul: v }])));
  const positive = { made_or_found: 1, pushes_limits: 1, shown_working: 1, general_interest: 1 };
  assert.ok(Math.abs(s(positive) - 1) < 1e-12);
  assert.ok(Math.abs(s({ ...positive, routine_launch: 1, speculative: 1 }) - 0.25) < 1e-12);
  // A specialist-only result (no general interest) tops out at 0.65.
  assert.ok(Math.abs(s({ ...positive, general_interest: 0 }) - 0.65) < 1e-12);
  assert.equal(s({ routine_launch: 1 }), 0);
  assert.equal(BUILDER_BAR, 0.65);
});

test('leadOf: larger margin wins; builder needs a recent or unknown event date', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  const day = 86_400_000;
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const major = leadOf({ major: 0.8, builder: 0.7, eventDate: now }, now)!;
  assert.equal(major.lane, 'major');
  assert.ok(close(major.margin, 0.25));
  const builder = leadOf({ major: 0.6, builder: 0.95, eventDate: new Date(now.getTime() - 2 * day) }, now)!;
  assert.equal(builder.lane, 'builder');
  assert.ok(close(builder.margin, 0.3));
  assert.equal(leadOf({ major: 0.5, builder: 0.5, eventDate: now }, now), null);
  assert.equal(leadOf({ major: null, builder: 0.95, eventDate: new Date(now.getTime() - 8 * day) }, now), null);
  assert.equal(leadOf({ major: 0.6, builder: 0.95, eventDate: new Date(now.getTime() - 8 * day) }, now)!.lane, 'major');
  assert.equal(leadOf({ major: null, builder: 0.7, eventDate: null }, now)!.lane, 'builder');
});

test('postedCheck: asks only already_posted with recently_posted; POSTED_MIN bar; no list → no calls', async () => {
  const none = stubJev();
  assert.equal((await postedCheck([mixed()], [], none.jev)).size, 0);
  assert.equal(none.social.length, 0);

  const hit = stubJev({ nouls: { already_posted: 0.7 } });
  const posted = await postedCheck([mixed()], ['An old headline'], hit.jev);
  assert.deepEqual([...posted], ['s1']);
  assert.deepEqual(Object.keys(hit.social[0]!.questions), ['already_posted']);
  assert.deepEqual(hit.social[0]!.state.recently_posted, ['An old headline']);
  assert.equal(hit.social[0]!.meta.version, 'story-scoring@4');

  const miss = stubJev({ nouls: { already_posted: 0.69 } });
  assert.equal((await postedCheck([mixed()], ['An old headline'], miss.jev)).size, 0);
});

test('postedCheck: a per-story Jev error (the cap included) counts as not posted and never throws (fix 2)', async () => {
  const capped = stubJev({ nouls: { already_posted: 0.9 }, capAfter: 1 });
  const a = mixed();
  const b = { ...mixed(), id: 's2' };
  const posted = await postedCheck([a, b], ['An old headline'], capped.jev);
  assert.equal(posted.size, 1, 'the first story was checked; the capped one is not posted');
  const broken = { asSocialAsk: () => { throw new Error('no transport'); } } as unknown as Parameters<typeof postedCheck>[2];
  assert.equal((await postedCheck([a], ['An old headline'], broken)).size, 0);
});
