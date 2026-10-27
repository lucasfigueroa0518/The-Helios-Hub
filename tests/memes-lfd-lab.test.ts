// The gate, the fault scorer, the placement rules and the LFD simulation (LFD lab plan). Offline: Jev and Claude are stubs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import { buildPost } from '@/lib/lfd/post';
import type { LfdRunDeps } from '@/lib/lfd/run';
import { carouselLane, lastCarouselRunAt } from '@/lib/lfd/sources';
import { insertPost, previousPosts } from '@/lib/lfd/store';
import { openLocalMemesDb, type MemesDb } from '@/lib/memes/db';
import { faultSubject, MEME_FAULTS, scoreFaults, tooLong } from '@/lib/memes/faults';
import { placeMemes } from '@/lib/memes/lfd-placement';
import { postWithMemes, readyFromSaved, type SavedStory } from '@/lib/memes/lfd-sim/post';
import { lfdCoverMemeBox } from '@/lib/social/render/lfd-meme-box';
import { readOnly, simQuery, splitSql, ensureLfdSchema } from '@/lib/memes/lfd-sim/router';
import { claimSim, inProcessEngine, requestSim, runSim, SIM_DIR, trimLetterbox, type SimDeps } from '@/lib/memes/lfd-sim/run';
import { fitOdds, gate, oddsFor, SHRINK_K, type OddsRow } from '@/lib/memes/odds';
import { getSettings, oddsRows, saveSettings, saveStoryTags } from '@/lib/memes/odds-store';
import { EQUIVALENT_REGIMES, evidenceRegimes, regimeId } from '@/lib/memes/regime';
import { STORY_TAGS, stripOutlet, tagsFromScores, TAGGER_VERSION, type StoryTags, type TagScores } from '@/lib/memes/story-tags';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';
import type { HubQuery } from '@/lib/social-hub/db';

import { seedCarouselRun, seedReelsIdea, seedScore, resetSeed } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

const traits = (o: Partial<Pick<StoryTags, 'irony' | 'launch' | 'numberStory' | 'shortHeadline' | 'conflict'>> = {}) => ({ irony: false, launch: false, numberStory: false, shortHeadline: false, conflict: false, ...o });
const row = (id: string, t: ReturnType<typeof traits>, anyGood: boolean): OddsRow => ({ storyId: id, tags: t, anyGood });

// ── Odds ─────────────────────────────────────────────────────────────────────

test('odds shrink each cell toward its parent, base first', () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => row(`a${i}`, traits({ irony: true, shortHeadline: true }), true)),
    ...Array.from({ length: 4 }, (_, i) => row(`b${i}`, traits(), i < 2)),
  ];
  const m = fitOdds(rows);
  const o = oddsFor(m, traits({ irony: true, shortHeadline: true }));
  const base = 8 / 10;
  const t = (6 + SHRINK_K * base) / (6 + SHRINK_K);
  const tn = (6 + SHRINK_K * t) / (6 + SHRINK_K);
  const tns = (6 + SHRINK_K * tn) / (6 + SHRINK_K);
  assert.ok(Math.abs(o.p - tns) < 1e-12);
  assert.equal(o.chain.length, 4);
  assert.match(o.why, /6 of 6 had a good meme/);
  // A cell nobody has graded falls back to its parents.
  const empty = oddsFor(m, traits({ irony: true, numberStory: true }));
  assert.ok(Math.abs(empty.p - t) < 1e-12);
});

test('a cell with too few graded stories of its own does not pass yet, however good its parents', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(`g${i}`, traits({ launch: true, shortHeadline: true }), true));
  rows.push(row('n1', traits({ launch: true, numberStory: true, shortHeadline: true }), true));
  const m = fitOdds(rows);
  const g = gate(m, [{ key: 'num', origIndex: 0, tags: traits({ launch: true, numberStory: true, shortHeadline: true }) }], 0.5);
  assert.ok(g[0]!.odds.p > 0.9);
  assert.equal(g[0]!.passes, false);
});

test('no graded stories means zero odds, so nothing passes', () => {
  const m = fitOdds([]);
  assert.equal(oddsFor(m, traits({ irony: true })).p, 0);
  assert.deepEqual(gate(m, [{ key: 'x', origIndex: 0, tags: traits({ irony: true }) }], 0.5).map((g) => g.chosen), [false]);
});

test('the gate takes at most 3 passing stories, best odds first, ties by original order', () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => row(`g${i}`, traits({ launch: true, shortHeadline: true }), true)),
    ...Array.from({ length: 20 }, (_, i) => row(`p${i}`, traits(), i % 2 === 0)),
  ];
  const m = fitOdds(rows);
  const stories = ['s0', 's1', 's2', 's3', 's4'].map((key, i) => ({ key, origIndex: i, tags: i === 1 ? traits() : traits({ launch: true, shortHeadline: true }) }));
  const g = gate(m, stories, 0.9);
  assert.deepEqual(g.filter((x) => x.passes).map((x) => x.key), ['s0', 's2', 's3', 's4']);
  assert.deepEqual(g.filter((x) => x.chosen).map((x) => x.key), ['s0', 's2', 's3']);
});

// ── Tags ─────────────────────────────────────────────────────────────────────

test('irony is any of its narrow questions; headline length ignores the outlet suffix', () => {
  const zero = Object.fromEntries(Object.keys(STORY_TAGS.questions).map((k) => [k, 0])) as TagScores;
  const t = tagsFromScores({ ...zero, backfire: 0.6, number_story: 0.7 }, 'OpenAI projected to bring in $20bn less in revenue than expected - The Guardian');
  assert.equal(t.irony, true);
  assert.equal(t.numberStory, true);
  assert.equal(t.launch, false);
  assert.equal(stripOutlet('A - B - SiliconANGLE'), 'A - B');
  assert.equal(t.headlineChars, 'OpenAI projected to bring in $20bn less in revenue than expected'.length);
  assert.equal(t.shortHeadline, true);
  assert.equal(t.version, TAGGER_VERSION);
});

// ── Faults ────────────────────────────────────────────────────

test('too long: a line over 45 characters or four written boxes', () => {
  assert.equal(tooLong(['short', 'also short']), false);
  assert.equal(tooLong(['x'.repeat(46)]), true);
  assert.equal(tooLong(['a', 'b', 'c', 'd']), true);
});

test('the fault scorer counts answers at 0.5 or above, plus too long', async () => {
  const jev: JevAsk = async (req, meta) => {
    assert.equal(meta.version, MEME_FAULTS.version);
    const state = req.state as { headline: string; meme: { template: string; printed: string[] } };
    assert.equal(state.headline, 'H');
    assert.equal(state.meme.template, 'Drake Hotline Bling');
    assert.deepEqual(state.meme.printed, ['Old way', 'New way']);
    return { answers: { confuses_viewer: { noul: 0.8 }, template_misuse: { noul: 0.5 }, no_joke: { noul: 0.2 } }, usage: { input_tokens: 1, output_tokens: 0 }, model: 'j' };
  };
  const s = faultSubject({ templateId: 'drake', fills: [{ slot: 'rejected', kind: 'text', text: 'Old way', factIds: [] }, { slot: 'preferred', kind: 'text', text: 'New way', factIds: [] }] }, { headline: 'H', theNews: 'N' }, 'm1');
  const f = await scoreFaults(jev, s);
  assert.deepEqual(f.flagged, ['confuses_viewer', 'template_misuse']);
  assert.equal(f.count, 2);
});

// ── Placement ────────────────────────────────────────────────────────────────

const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
const withMemes = (map: Record<string, string>) => keys.map((key) => ({ key, memeId: map[key] ?? null }));

test('#1 in the top 3 becomes the cover and its story leads with its photo; #2 and #3 stay in place with memes', () => {
  const p = placeMemes(withMemes({ c: 'mc', e: 'me', f: 'mf' }));
  assert.deepEqual(p.order, ['c', 'a', 'b', 'd', 'e', 'f']);
  assert.deepEqual(p.cover, { kind: 'meme', memeId: 'mc', storyKey: 'c' });
  assert.deepEqual(p.slideImage.c, { kind: 'photo' });
  assert.deepEqual(p.slideImage.e, { kind: 'meme', memeId: 'me' });
  assert.deepEqual(p.slideImage.f, { kind: 'meme', memeId: 'mf' });
  assert.deepEqual(p.placed.map((x) => [x.key, x.role, x.position]), [['c', 'cover', 1], ['e', 'slide', 5], ['f', 'slide', 6]]);
});

test('#1 outside the top 3 moves to the second slide with its meme; the cover stays the mosaic', () => {
  const p = placeMemes(withMemes({ e: 'me', f: 'mf' }));
  assert.deepEqual(p.order, ['a', 'e', 'b', 'c', 'd', 'f']);
  assert.deepEqual(p.cover, { kind: 'mosaic' });
  assert.deepEqual(p.slideImage.e, { kind: 'meme', memeId: 'me' });
  assert.deepEqual(p.placed.map((x) => [x.key, x.role, x.position]), [['e', 'slide', 2], ['f', 'slide', 6]]);
});

test('the first story keeps its place as #1 in the top 3; no memes changes nothing; at most 3 are placed', () => {
  assert.deepEqual(placeMemes(withMemes({ a: 'ma' })).order, keys);
  const none = placeMemes(withMemes({}));
  assert.deepEqual(none.order, keys);
  assert.deepEqual(none.cover, { kind: 'mosaic' });
  assert.equal(placeMemes(withMemes({ a: '1', b: '2', c: '3', d: '4' })).placed.length, 3);
});

const saved = (key: string, i: number): SavedStory => ({
  key, lane: 'rundown', origin: 'reels', url: `https://x.com/${key}`, outlet: 'Outlet', major: null, net: 0.5, lead: null,
  setup: '', headline: `Headline ${key}`, highlight: '', names: [], body: `Body ${i}`, photo: { src: `https://p/${key}.jpg`, credit: `C${i}`, kind: 'scene' },
});

test('the post with memes: the meme cover keeps the mosaic photos; meme slides show the meme whole', () => {
  const stories = keys.map(saved);
  const p = placeMemes(withMemes({ b: 'mb', e: 'me' }));
  const post = postWithMemes(stories, p, (id) => ({ url: `data:image/png;base64,${id}`, aspect: id === 'mb' ? 1.5 : 0.8 }), new Date('2026-10-13T07:00:00Z'));
  const cover = post.slides[0]!;
  assert.deepEqual(cover.lfdCover?.meme, { url: 'data:image/png;base64,mb', aspect: 1.5 });
  assert.deepEqual(cover.lfdCover?.photos.map((x) => x.url), p.order.map((k) => `https://p/${k}.jpg`));
  const slideOf = (k: string) => post.slides.find((s) => s.lfdStory?.headline === `Headline ${k}`)!;
  assert.equal(slideOf('b').position, 1);
  assert.equal(slideOf('b').photoUrl, 'https://p/b.jpg');
  assert.equal(slideOf('e').photoUrl, 'data:image/png;base64,me');
  assert.equal(slideOf('e').photoKind, 'meme');
  assert.equal(slideOf('e').photoAspect, 0.8, 'the slide box takes the meme\'s shape');
  assert.equal(slideOf('b').photoAspect, undefined);
  assert.match(post.caption, /– Headline b\n– Headline a/);
  const memed = stories.map((s, i) => (i === 4 ? { ...s, photoSource: 'meme' as const, photo: { ...s.photo, src: 'data:image/png;base64,meme' } } : s));
  const mosaicOnly = postWithMemes(memed, placeMemes(withMemes({})), () => ({ url: '' }), new Date('2026-10-13T07:00:00Z'));
  assert.ok(!mosaicOnly.slides[0]!.lfdCover!.photos.some((p) => p.url.includes('meme')));
  // Without memes it is exactly Tommy's post.
  const plain = postWithMemes(stories, placeMemes(withMemes({})), () => ({ url: '' }), new Date('2026-10-13T07:00:00Z'));
  assert.deepEqual(plain, buildPost(stories.map(readyFromSaved), new Date('2026-10-13T07:00:00Z')));
});

// ── The simulation's database handle and the replay bounds ───────────────────

test('the router keeps writes and lfd.runs local, sends other reads to the Hub, and the Hub refuses writes', async () => {
  const local: string[] = [];
  const hub: string[] = [];
  const q = simQuery({ query: async (t) => { local.push(t); return { rows: [] }; } }, async (t) => { hub.push(t); return { rows: [] }; });
  await q(`SELECT * FROM reels.idea_scores`);
  await q(`  WITH x AS (SELECT 1) SELECT * FROM x`);
  await q(`SELECT id FROM lfd.runs WHERE status = 'running'`);
  await q(`INSERT INTO lfd.posts (slug) VALUES ('x')`);
  await q(`UPDATE lfd.runs SET status = 'ok'`);
  assert.equal(hub.length, 2);
  assert.equal(local.length, 3);
  const guard = readOnly(async () => ({ rows: [] }));
  await assert.rejects(guard(`DELETE FROM social.runs`), /refused/);
  await assert.rejects(guard(`SELECT 1; DELETE FROM social.runs`), /refused/);
  assert.ok(splitSql('CREATE TABLE a (x int);\nINSERT INTO a VALUES (1);\n').length === 2);
});

test('replay bounds: previous posts before the day, carousel runs up to the moment; defaults unchanged', async () => {
  const { query } = await openHubTestDb();
  for (const ny of ['2026-10-06', '2026-10-09', '2026-10-13']) {
    await insertPost(query, { runId: null, slug: `lfd-${ny}`, nyDate: ny, ideaIds: [ny], stories: [{ headline: ny, body: '' }], render: {}, caption: '', slideObjects: [], fitProblems: [], short: false });
  }
  assert.deepEqual((await previousPosts(query, 2)).map((p) => p.nyDate), ['2026-10-13', '2026-10-09']);
  assert.deepEqual((await previousPosts(query, 2, '2026-10-10')).map((p) => p.nyDate), ['2026-10-09', '2026-10-06']);
  await seedCarouselRun(query, '2026-10-08T07:00:00Z', [{ id: 'https://a.com/1', headline: 'Early', source: 'S' }]);
  await seedCarouselRun(query, '2026-10-12T07:00:00Z', [{ id: 'https://a.com/2', headline: 'Late', source: 'S' }]);
  assert.deepEqual((await carouselLane(query, '2026-10-01T00:00:00Z')).map((c) => c.headline).sort(), ['Early', 'Late']);
  assert.deepEqual((await carouselLane(query, '2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z')).map((c) => c.headline), ['Early']);
  assert.match(String(await lastCarouselRunAt(query)), /2026-10-12/);
  assert.match(String(await lastCarouselRunAt(query, '2026-10-10T00:00:00Z')), /2026-10-08/);
});

// ── Stored evidence ──────────────────────────────────────────────────────────

async function seedGradedRun(db: MemesDb, o: { storyId: string; regime: string; ratings: Array<number | null> }) {
  const req = (await db.query<{ id: string }>(`INSERT INTO memes.requests (kind, post_id, status) VALUES ('single', $1, 'ok') RETURNING id::text`, [o.storyId])).rows[0]!.id;
  const slate = (await db.query<{ id: string }>(`INSERT INTO memes.slates (request_id, kind, stories, shape) VALUES ($1, 'single', '[]'::jsonb, $2::jsonb) RETURNING id::text`, [req, JSON.stringify({ regime: o.regime })])).rows[0]!.id;
  for (const [i, r] of o.ratings.entries()) {
    const m = (await db.query<{ id: string }>(`INSERT INTO memes.memes (slate_id, template_id, in_slate, rank, mapping) VALUES ($1, 'drake', true, $2, $3::jsonb) RETURNING id::text`, [slate, i + 1, JSON.stringify({ fill: { templateId: 'drake', fills: [{ slot: 'rejected', kind: 'text', text: 'Old', factIds: [] }, { slot: 'preferred', kind: 'text', text: 'New', factIds: [] }] } })])).rows[0]!.id;
    if (r != null) await db.query(`INSERT INTO memes.picks (slate_id, meme_id, verdict, rating) VALUES ($1, $2, $3, $4)`, [slate, m, r >= 3 ? 'picked' : 'rejected', r]);
  }
  return req;
}

const tagsOf = (o: Partial<StoryTags>): StoryTags => ({
  version: TAGGER_VERSION, scores: {} as TagScores, irony: false, launch: false, numberStory: false, conflict: false, headlineChars: 40, shortHeadline: true, ...o,
});

test('odds rows: one regime and one tagger version; a partly graded slate counts only once it has a good meme', async () => {
  const { db } = await openLocalMemesDb();
  await saveStoryTags(db, 's1', tagsOf({ irony: true }));
  await saveStoryTags(db, 's2', tagsOf({}));
  await saveStoryTags(db, 's3', tagsOf({}));
  await db.query(`INSERT INTO memes.story_tags (story_id, tagger_version, tags) VALUES ('s4', 'meme-story-tags@0', '{}'::jsonb)`);
  await seedGradedRun(db, { storyId: 's1', regime: 'R', ratings: [2, 3, null] });
  await seedGradedRun(db, { storyId: 's2', regime: 'R', ratings: [2, 2, 1] });
  await seedGradedRun(db, { storyId: 's3', regime: 'R', ratings: [2, null] });
  await seedGradedRun(db, { storyId: 's4', regime: 'R', ratings: [3] });
  await seedGradedRun(db, { storyId: 's1', regime: 'OLD', ratings: [1] });
  const rows = await oddsRows(db, 'R');
  assert.deepEqual(rows.map((r) => [r.storyId, r.anyGood]).sort(), [['s1', true], ['s2', false]]);
  // A new grade counts at once.
  const m = (await db.query<{ id: string }>(`SELECT m.id::text FROM memes.memes m LEFT JOIN memes.picks p ON p.meme_id = m.id JOIN memes.slates sl ON sl.id = m.slate_id JOIN memes.requests r ON r.id = sl.request_id WHERE r.post_id = 's3' AND p.id IS NULL`)).rows[0]!.id;
  await db.query(`INSERT INTO memes.picks (slate_id, meme_id, verdict, rating) SELECT slate_id, id, 'picked', 4 FROM memes.memes WHERE id = $1`, [m]);
  assert.equal((await oddsRows(db, 'R')).length, 3);
});

test('a declared equivalent regime counts as the same evidence; others do not', async () => {
  const e = EQUIVALENT_REGIMES[0]!;
  // The declared regimes form one chain (ME-138, ME-142), so each counts the whole chain, transitively.
  const chain = [...new Set(EQUIVALENT_REGIMES.flatMap((x) => [x.regime, x.sameAs]))].sort();
  assert.deepEqual(evidenceRegimes(e.regime).sort(), chain);
  assert.deepEqual(evidenceRegimes(e.sameAs).sort(), chain);
  assert.deepEqual(evidenceRegimes(EQUIVALENT_REGIMES.at(-1)!.sameAs).sort(), chain);
  assert.deepEqual(evidenceRegimes('other'), ['other']);
  assert.equal(regimeId(), e.regime, 'the current code is the declared layout-only regime');
  const { db } = await openLocalMemesDb();
  await saveStoryTags(db, 'a', tagsOf({}));
  await saveStoryTags(db, 'b', tagsOf({}));
  await saveStoryTags(db, 'c', tagsOf({}));
  await seedGradedRun(db, { storyId: 'a', regime: e.sameAs, ratings: [3] });
  await seedGradedRun(db, { storyId: 'b', regime: e.regime, ratings: [3] });
  await seedGradedRun(db, { storyId: 'c', regime: 'unrelated', ratings: [3] });
  assert.deepEqual((await oddsRows(db, e.regime)).map((r) => r.storyId).sort(), ['a', 'b']);
});

test('settings: the gate threshold, its default and validation', async () => {
  const { db } = await openLocalMemesDb();
  assert.deepEqual(await getSettings(db), { gateThreshold: 0.92 });
  assert.equal((await saveSettings(db, { gateThreshold: 0.85 })).gateThreshold, 0.85);
  assert.deepEqual(await getSettings(db), { gateThreshold: 0.85 });
  await assert.rejects(saveSettings(db, { gateThreshold: 1.5 }), /between 0 and 1/);
});

test('the gate and the fault scorer are not part of the generation regime', async () => {
  const before = regimeId();
  await import('@/lib/memes/faults');
  await import('@/lib/memes/odds');
  assert.equal(regimeId(), before);
});

// ── The whole simulation, offline ────────────────────────────────────────────

const NOW = new Date('2026-10-13T07:00:00Z');

function writer() {
  return async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    if ((p.tools?.[0] as { name?: string } | undefined)?.name === 'submit_verdict') {
      return { id: 'v', type: 'message', role: 'assistant', model: 'h', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'tool_use', id: 'v', name: 'submit_verdict', input: { shows_story_subject: true, generic_stock: false, reason: 'ok' } }] } as unknown as Anthropic.Message;
    }
    const user = String((p.messages.at(-1) as { content: unknown }).content);
    const material = JSON.parse(user.slice(user.indexOf('<material>') + 10, user.indexOf('</material>'))) as { stories: Array<{ key: string; headline: string }> };
    const stories = material.stories.map((s) => ({ key: s.key, setup: '', headline: s.headline.slice(0, 60), highlight: '', names: [], body: 'It happened this week. More is coming', photo: { kind: 'company', query: s.headline, subjects: [], alts: [] } }));
    return { id: 'm', type: 'message', role: 'assistant', model: 's', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'tool_use', id: 't', name: 'submit_rundown', input: { stories } }] } as unknown as Anthropic.Message;
  };
}

const answer = (answers: Record<string, number>): JevResult => ({ answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { noul: v }])), usage: { input_tokens: 10, output_tokens: 0 }, model: 'j' });

/** Jev for the engine (major news, grounding, same event) and for the lab (tags: "Backfire" headlines are ironic; faults: none). */
const simJev: JevAsk = async (req, meta) => {
  if (meta.version.startsWith('major-news')) return answer({ happened: 0, news_kind: 0, blockbuster_entity: 0, global_relevance: 0, political_relevance: 0, speculative: 0 });
  if (meta.version.startsWith('md-grounding')) return answer({ supported: 0.9 });
  if (meta.version.startsWith('meme-story-tags')) return answer({ backfire: /Backfire/.test((req.state as { headline: string }).headline) ? 0.9 : 0.1 });
  if (meta.version.startsWith('meme-faults')) return answer({});
  return answer({ same_event: 0.1 });
};

test('a simulation runs the engine with local writes, gates on the graded evidence, makes memes and places them', async () => {
  resetSeed();
  const { query: hubRaw } = await openHubTestDb();
  const headlines = ['Plain One', 'Backfire Two', 'Plain Three', 'Plain Four', 'Backfire Five', 'Plain Six'];
  for (const [i, h] of headlines.entries()) {
    const idea = await seedReelsIdea(hubRaw, { headline: h, url: `https://n.com/${i}` });
    await seedScore(hubRaw, idea, { nyDate: '2026-10-11', origin: 'timely', net: 0.9 - i / 20 });
  }
  const hubWrites: string[] = [];
  const hub: HubQuery = async (t, p) => {
    if (!/^\s*(select|with)\b/i.test(t)) hubWrites.push(t);
    return hubRaw(t, p);
  };
  const { db } = await openLocalMemesDb();
  await ensureLfdSchema(db);
  // Evidence: ironic stories always got a good meme, plain ones half the time.
  for (let i = 0; i < 12; i++) {
    await saveStoryTags(db, `g${i}`, tagsOf({ irony: true }));
    await seedGradedRun(db, { storyId: `g${i}`, regime: 'R', ratings: [3, 2] });
    await saveStoryTags(db, `p${i}`, tagsOf({}));
    await seedGradedRun(db, { storyId: `p${i}`, regime: 'R', ratings: i % 2 ? [3] : [2] });
  }
  let pending: Promise<void> = Promise.resolve();
  const fitCheck: SimDeps['fitCheck'] = async (post, opts) => {
    if (opts?.screenshotDir) {
      const sharp = (await import('sharp')).default;
      for (let i = 1; i <= post.slides.length; i++) {
        const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: i * 20, g: 0, b: 0 } } }).png().toBuffer();
        fs.writeFileSync(path.join(opts.screenshotDir, `slide-slide-${String(i).padStart(2, '0')}.png`), png);
      }
    }
    return { ok: true, violations: [], problems: [], slideText: [] };
  };
  const lfdDeps = async (o: { capUsd: number; now: Date }): Promise<{ deps: LfdRunDeps; spentUsd: () => number }> => ({
    deps: {
      query: hub, jev: simJev, create: writer(),
      photos: { usd: 0, find: async () => null, findSet: async (reqs) => reqs.map((r, i) => ({ src: `https://p/${i}-${encodeURIComponent(r.query)}.jpg`, credit: 'C', kind: 'scene' as const })) },
      fetchFeeds: async () => [], fetchBody: async () => 'b'.repeat(1200), readPage: async (url) => ({ ok: false, url, error: 'stub' }),
      fitCheck, upload: async () => undefined,
      now: o.now, trigger: 'manual', capUsd: o.capUsd, spend: () => ({ claudeUsd: 0.3, jevUsd: 0.01 }),
    },
    spentUsd: () => 0.31,
  });

  const deps: SimDeps = {
    db, engine: inProcessEngine({ local: db, hub, lfdDeps }), jev: simJev,
    briefs: async (ids) => {
      for (const id of ids) await db.query(`UPDATE memes.lfd_stories SET brief = '{"the_news":{"text":"n"}}'::jsonb, brief_source = 'from-body' WHERE id = $1`, [id]);
      return 0.08;
    },
    kickMemes: () => {
      pending = (async () => {
        const { rows } = await db.query<{ id: string; post_id: string }>(`SELECT id::text, post_id FROM memes.requests WHERE status = 'requested'`);
        for (const r of rows) {
          await db.query(`UPDATE memes.requests SET status = 'ok', cost_usd = 0.12 WHERE id = $1`, [r.id]);
          const slate = (await db.query<{ id: string }>(`INSERT INTO memes.slates (request_id, kind, stories, shape) VALUES ($1, 'single', '[]'::jsonb, '{"regime":"R"}'::jsonb) RETURNING id::text`, [r.id])).rows[0]!.id;
          for (const rank of [1, 2]) await db.query(`INSERT INTO memes.memes (slate_id, template_id, in_slate, rank, mapping) VALUES ($1, 'drake', true, $2, $3::jsonb)`, [slate, rank, JSON.stringify({ fill: { templateId: 'drake', fills: [{ slot: 'rejected', kind: 'text', text: 'Old', factIds: [] }, { slot: 'preferred', kind: 'text', text: 'New', factIds: [] }] } })]);
        }
      })();
    },
    fitCheck, regime: 'R', now: () => NOW, sleep: async () => pending,
  };
  await saveSettings(db, { gateThreshold: 0.9 });
  const id = await requestSim(db, { asOf: null, by: 'test' }, NOW);
  const sim = (await claimSim(db))!;
  await runSim(deps, sim);
  const { rows } = await db.query<{ status: string; error: string | null; placement: { placed: Array<{ key: string; role: string }>; order: string[] }; final_post: { slides: string[] }; original_post: { stories: SavedStory[] } }>(
    `SELECT status, error, placement, final_post, original_post FROM memes.lfd_sims WHERE id = $1`, [id],
  );
  const r = rows[0]!;
  assert.equal(r.status, 'ok', r.error ?? '');
  assert.deepEqual(hubWrites, [], 'nothing was written to the Hub');
  const { rows: st } = await db.query<{ headline: string; gated: boolean; picked_meme_id: string | null }>(`SELECT headline, gated, picked_meme_id FROM memes.lfd_sim_stories WHERE sim_id = $1 ORDER BY orig_index`, [id]);
  assert.equal(st.length, 6);
  assert.deepEqual(st.filter((s) => s.gated).map((s) => s.headline).sort(), ['Backfire Five', 'Backfire Two']);
  assert.ok(st.filter((s) => s.gated).every((s) => s.picked_meme_id));
  const { rows: firsts } = await db.query<{ ok: boolean }>(
    `SELECT bool_and(m.rank = 1) AS ok FROM memes.lfd_sim_stories x JOIN memes.memes m ON m.id = x.picked_meme_id WHERE x.sim_id = $1`, [id],
  );
  assert.equal(firsts[0]!.ok, true, 'every story uses its slate\'s #1');
  assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM memes.meme_faults`)).rows[0]!.n, 4, 'fault counts saved for reference');
  assert.equal(r.placement.placed.length, 2);
  assert.ok(r.final_post.slides.length >= 7);
  // The live run report: the engine's steps (read off its calls) and every lab stage, in order.
  const { rows: ev } = await db.query<{ stage: string; message: string; count: number }>(`SELECT stage, message, count FROM memes.lfd_sim_events WHERE sim_id = $1 ORDER BY id`, [id]);
  const stagesSeen = [...new Set(ev.map((e) => e.stage))];
  assert.deepEqual(stagesSeen, ['lfd', 'tags', 'gate', 'briefs', 'memes', 'faults', 'render', 'done']);
  assert.ok(ev.some((e) => e.message === 'Fact-checking the written copy' && e.count > 1), 'repeated steps fold into one line with a count');
  assert.ok(ev.some((e) => /^Gate at 90% on \d+ graded stories: 2 of 6 pass/.test(e.message)));
  assert.match(ev.at(-1)!.message, /^Done: 2 memes placed/);
  // The engine's own run and post live in the lab database.
  assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM lfd.posts`)).rows[0]!.n, 1);
  fs.rmSync(path.join(SIM_DIR, id), { recursive: true, force: true });
});

test('the meme cover takes the meme\'s shape: wide memes run full bleed, squarer ones sit whole as a card, no bands', () => {
  const wide = lfdCoverMemeBox(2);
  assert.deepEqual({ fit: wide.fit, w: wide.w, h: wide.h, copy: wide.copy }, { fit: 'bleed', w: 1080, h: 540, copy: 'l' });
  const mid = lfdCoverMemeBox(1.25);
  assert.deepEqual({ fit: mid.fit, w: mid.w, h: mid.h, copy: mid.copy }, { fit: 'bleed', w: 1080, h: 864, copy: 'm' });
  const square = lfdCoverMemeBox(1);
  assert.equal(square.fit, 'card');
  assert.ok(square.w <= 1080 - 96 && square.h <= 1350 - 330 - 48);
  const tall = lfdCoverMemeBox(0.5);
  assert.equal(tall.fit, 'card');
  assert.ok(Math.abs(tall.w / tall.h - 0.5) < 0.01, 'never stretched');
  for (const a of [0.45, 0.75, 1, 1.06, 1.3, 2.2]) {
    const b = lfdCoverMemeBox(a);
    assert.ok(b.areaH <= 1350 - 330, `the hook keeps its room at ${a}`);
    assert.ok(Math.abs(b.w / b.h - a) < 0.01, `the meme keeps its shape at ${a}`);
  }
});

test('a placed meme loses the white canvas and a thin template frame; white-ground text touching an edge gets room', async () => {
  const box = (w: number, h: number, bg: string) => sharp({ create: { width: w, height: h, channels: 3, background: bg } });
  // A 400×300 picture with its own 8px off-white frame, on the white render canvas.
  const framed = await box(416, 316, '#f7f6f2').composite([{ input: await box(400, 300, '#336699').png().toBuffer(), left: 8, top: 8 }]).png().toBuffer();
  const canvas = await box(1080, 1350, '#ffffff').composite([{ input: framed, left: 332, top: 517 }]).png().toBuffer();
  const out = await sharp(await trimLetterbox(canvas)).metadata();
  assert.deepEqual([out.width, out.height], [400, 300]);
  // A white-ground meme whose dark text runs to the left edge: white comes back on that side only.
  const text = await box(40, 20, '#111111').png().toBuffer();
  const whiteGround = await box(1080, 1350, '#ffffff').composite([
    { input: await box(500, 400, '#fdfdfd').composite([{ input: text, left: 0, top: 190 }]).png().toBuffer(), left: 290, top: 475 },
    { input: await box(4, 4, '#999999').png().toBuffer(), left: 785, top: 870 },
  ]).png().toBuffer();
  const padded = await sharp(await trimLetterbox(whiteGround)).metadata();
  assert.ok(padded.width! > 500, 'room on the touched side');
});
