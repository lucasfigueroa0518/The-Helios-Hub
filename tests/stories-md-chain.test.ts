/**
 * Morning Download on the locked news chain (WIRING-CONTRACT Phase 2 Owner D): candidates → shortlist → rerank →
 * cleanup → photos/video → choosePosts → writer → frames. Every client is a stub; nothing reaches the network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HeldOfferInput } from '@/lib/media-library/held';
import type { BuildDeps } from '@/lib/stories/build/common';
import { buildMorningDownload, frameCopy, mdVerdict } from '@/lib/stories/build/morning-download';
import { SAME_EVENT } from '@/lib/news-ranker/questions';
import { DEVELOPMENT_BAR, SAME_EVENT_BAR } from '@/lib/news-ranker/scores';
import { createStoriesJev } from '@/lib/stories/jev';
import { schemaSql } from '@/lib/stories/local-db';
import { claimNextRequested, requestSet } from '@/lib/stories/repository';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

import { harnessDb, stubJev, stubPhotos, stubWriter } from './stories-harness';
import { newsStubs, slug, type NewsScript } from './stories-md-news-stubs';

const NOW = new Date('2026-10-08T05:00:00Z');
const DATE = '2026-10-08';

/** One story's script: how the rerank grades it and what media it has (tests/stories-md-news-stubs.ts). */
type Script = NewsScript & { url?: string };

const urlOf = (s: Script) => s.url ?? `https://news.test/${slug(s.headline)}`;

async function chain(scripts: Script[], o: { bank?: NonNullable<BuildDeps['news']>['bank'] } = {}) {
  const { news, video, calls } = await newsStubs(scripts);
  if (o.bank !== undefined) news.bank = o.bank;

  const { db } = await harnessDb();
  const { set } = await requestSet(db, { series: 'morning_download', nyDate: DATE, trigger: 'click', style: DEFAULT_SETTINGS.series.morning_download.style });
  await claimNextRequested(db);
  const deps: BuildDeps = {
    db, sourceDb: db, jev: createStoriesJev(stubJev(), db), write: stubWriter({}), photos: stubPhotos(), settings: DEFAULT_SETTINGS, now: NOW, setId: set.id, nyDate: DATE, news, video,
  };
  const pool: StoryCandidate[] = scripts.map((s, i) => ({ key: urlOf(s), origin: 'reels', ref: `idea-${i}`, headline: s.headline, sourceName: 'The Verge', url: urlOf(s), body: `${s.headline}. The full story text.`, publishedAt: '2026-10-07T12:00:00Z', nativeScore: 5 }));
  const r = await buildMorningDownload(deps, { reels: async () => pool, carousel: async () => [] });
  const stories = r.ok ? r.frames.filter((f) => f.role === 'story').map((f) => f.copy as { headline: string; source: { name: string }; photo?: { src: string; contained?: boolean; credit: string }; video?: unknown }) : [];
  const posted = stories.map((f) => scripts.find((s) => f.headline.startsWith(s.headline))!.headline);
  return { r, stories, posted, calls, db, setId: set.id };
}

test('verdicts (WC3) and the frame line', () => {
  assert.equal(mdVerdict({ video: 'golden', photo: 'none' }), 'good');
  assert.equal(mdVerdict({ video: 'good', photo: 'usable' }), 'good');
  assert.equal(mdVerdict({ video: 'none', photo: 'usable' }), 'usable');
  assert.equal(mdVerdict({ video: 'none', photo: 'none' }), 'none');
  assert.equal(frameCopy('OpenAI ships GPT-6', 'It matters.'), 'OpenAI ships GPT-6. It matters.');
  assert.equal(frameCopy('Is it here?', 'Yes.'), 'Is it here? Yes.');
});

test('MD chain: the walk posts top-tier stories with good media; a usable photo fills in only to reach 2; a golden video past the top-tier stop does not post', async () => {
  const { r, stories, posted, calls, db, setId } = await chain([
    { headline: 'OpenAI ships GPT-6', top: true, photo: 'good' },
    { headline: 'OpenAI GPT-6 launch recap', top: true, photo: 'good', duplicateOf: 'OpenAI ships GPT-6' },
    { headline: 'Nvidia earnings beat', top: true, photo: 'none' },
    { headline: 'Google trims Gemini prices', top: true, photo: 'usable' },
    { headline: 'Robot dog dances', top: false, photo: 'none', video: 'golden' },
    { headline: 'Meta opens a lab', top: true, photo: 'good' },
  ]);
  assert.equal(r.ok, true, r.ok ? '' : r.skip);
  if (!r.ok) return;
  // Walk: GPT-6 posts (good); Nvidia has no media; Google is only usable; the robot dog is not top tier → stop.
  // Under 2: Google's usable photo fills the second place. Meta (past the stop) and the golden video never post.
  assert.deepEqual(posted, ['OpenAI ships GPT-6', 'Google trims Gemini prices']);
  assert.ok(!posted.includes('Robot dog dances'));
  // The rerank got the shortlist under short ids with the NY date as its window, from a cached prefix.
  const rr = calls.rerank[0]! as { system: Array<{ cache_control?: unknown }>; tools: Array<{ cache_control?: unknown }>; messages: Array<{ content: string }> };
  assert.ok(rr.system.at(-1)!.cache_control && rr.tools.at(-1)!.cache_control);
  assert.match(rr.messages[0]!.content, /^Shortlist for 2026-10-08:/);
  assert.ok(!rr.messages[0]!.content.includes('news.test'));
  // The duplicate's page was read for the GPT-6 photo (cleanup's merged URLs).
  assert.ok(calls.readPage.includes('https://news.test/openai-gpt-6-launch-recap'));
  // The writer wrote the posts with the editor's angles revealed, and its prefix is cached.
  const reveal = calls.writer.find((p) => (p.messages as unknown[]).length === 3)! as { messages: Array<{ content: Array<{ type: string; text?: string }> }>; system: Array<{ cache_control?: unknown }> };
  assert.ok(reveal.system.at(-1)!.cache_control);
  assert.match(reveal.messages[2]!.content.find((c) => c.type === 'text')!.text!, /editor angle for OpenAI ships GPT-6/);
  // Frames: "<headline>. <body>", code's source line, band photos stored with their credit.
  assert.equal(stories[0]!.headline, 'OpenAI ships GPT-6. Here is why it matters to you today.');
  assert.equal(stories[0]!.source.name, 'The Verge');
  assert.ok(stories.every((f) => f.photo?.src.startsWith('https://store.test/sets/') && f.photo.credit === 'Photo: Wire'));
  assert.equal(calls.uploads.length, 2);
  // 1200×900 into the 1080×1180 band with the subject kept in view: too short to cover, so contained (CONTAINED_FADE).
  assert.equal(stories[0]!.photo!.contained, true);
  const cand = r.candidates.find((c) => (c.payload as { headline: string }).headline === 'Robot dog dances')!;
  assert.equal(cand.chosen, false);
  assert.match(cand.reason!, /not top tier/);
  assert.match(r.candidates.find((c) => (c.payload as { headline: string }).headline === 'OpenAI GPT-6 launch recap')!.reason!, /^duplicate of/);
  // Every chain stage is costed against the set.
  const { rows } = await db.query<{ component: string }>(`SELECT DISTINCT component FROM stories.cost_events WHERE set_id = $1 ORDER BY component`, [setId]);
  assert.deepEqual(rows.map((x) => x.component), ['news-photos', 'news-photos-band', 'news-rerank@1', 'news-shortlist@r8', 'news-writer@1']);
});

test('MD chain: with two good top-tier stories the usable photo stays out; a golden video on a top-tier story posts as video', async () => {
  const { r, stories, posted } = await chain([
    { headline: 'OpenAI ships GPT-6', top: true, photo: 'good' },
    { headline: 'Google trims Gemini prices', top: true, photo: 'usable' },
    { headline: 'Tesla robot walks', top: true, photo: 'none', video: 'golden' },
    { headline: 'Startup raises seed', top: false, photo: 'good' },
  ]);
  assert.equal(r.ok, true, r.ok ? '' : r.skip);
  assert.deepEqual(posted, ['OpenAI ships GPT-6', 'Tesla robot walks']);
  assert.ok(stories[1]!.video);
  assert.equal(stories[1]!.photo!.src, 'https://poster.test/tesla-robot-walks.jpg');
  if (r.ok) assert.deepEqual((r.frames[0]!.copy as { peek: Array<{ src: string } | null> }).peek.map((p) => p?.src), stories.map((s) => s.photo!.src));
});

/* ── spin-offs: a different article about a story we ran (lib/news-ranker/repeats) ── */

const SPIN_NOW = new Date('2026-11-12T08:00:00Z');
const SPIN_DATE = '2026-11-12';
const SPIN_POSTED = new Date('2026-11-09T13:30:00Z');
const spinSid = (i: number) => `00000000-0000-4000-8000-00000000000${i}`;

/**
 * We ran "Acme ships its Rocket" (intake story 0). Today's pool: "Acme Rocket review" (a different intake story, 1)
 * with one article since we posted, plus two unrelated stories. Jev says the Acme pair is one event; md-development's
 * new_event is `newEvent`.
 */
async function spinOff(newEvent: number) {
  const { db, pg } = await harnessDb();
  await pg.exec(schemaSql('db/intake_schema.sql'));
  const heads = ['Acme Rocket review', 'Nvidia earnings beat', 'Google trims Gemini prices'];
  for (let i = 0; i < 4; i++) await db.query(`INSERT INTO intake.stories (id, representative_key, headline) VALUES ($1, $2, $3)`, [spinSid(i), `x.test/${i}`, heads[i - 1] ?? 'Acme ships its Rocket']);
  const ran = (await db.query<{ id: string }>(
    `INSERT INTO stories.sets (series, ny_date, status, trigger, style, payload, published_at) VALUES ('morning_download', '2026-11-09', 'published', 'auto', 'polished', $1, $2) RETURNING id`,
    [JSON.stringify({ stories: [{ key: 'x.test/0', headline: 'Acme ships its Rocket', storyId: spinSid(0) }], historyKeys: ['x.test/0'] }), SPIN_POSTED],
  )).rows[0]!.id;
  await db.query(`INSERT INTO stories.frames (set_id, seq, role, backdrop, copy) VALUES ($1, 2, 'story', 'black', $2)`, [ran, JSON.stringify({ role: 'story', headline: 'Acme ships its Rocket' })]);
  await db.query(`INSERT INTO stories.history (series, key, set_id, shown_at) VALUES ('morning_download', 'x.test/0', $1, $2)`, [ran, SPIN_POSTED]);
  await db.query(
    `INSERT INTO intake.items (key, family, source_id, source_name, source_type, headline, body, url, first_seen_at, story_id) VALUES ('https://a.test/1', 'feeds', 'feed:x', 'Outlet', 'rss', 'Acme Rocket review', 'Acme Rocket new detail.', 'https://a.test/1', $1, $2)`,
    [new Date(SPIN_POSTED.getTime() + 86_400_000), spinSid(1)],
  );
  const { set } = await requestSet(db, { series: 'morning_download', nyDate: SPIN_DATE, trigger: 'click', style: DEFAULT_SETTINGS.series.morning_download.style });
  await claimNextRequested(db);
  const storiesJev = stubJev((k) => (k === 'new_event' ? newEvent : k === 'supported' ? 0.9 : 0.1));
  const { news } = await newsStubs(heads.map((h) => ({ headline: h, top: true, photo: 'good' as const })));
  const sameEvent: Array<[string, string]> = [];
  const ask = news.jevAsk;
  news.jevAsk = async (req, meta) => {
    if (meta.version !== SAME_EVENT.version) return ask(req, meta);
    const st = req.state as { story_a: { headline: string }; story_b: { headline: string } };
    sameEvent.push([st.story_a.headline, st.story_b.headline]);
    return { answers: { same_event: { noul: st.story_b.headline.startsWith('Acme') ? SAME_EVENT_BAR + 0.2 : 0.1 } }, usage: { input_tokens: 100, output_tokens: 1 }, model: 'jev-stub' };
  };
  const pool: StoryCandidate[] = heads.map((h, i) => ({
    key: `x.test/${i + 1}`, origin: 'carousel', ref: `https://x.test/${i + 1}`, headline: h, sourceName: 'Outlet', url: `https://x.test/${i + 1}`, body: `${h}. The full story text.`,
    publishedAt: SPIN_NOW.toISOString(), nativeScore: 1, photo: null, intake: { storyId: spinSid(i + 1), major: 0.9, builder: null, eventDate: SPIN_NOW.toISOString(), memberKeys: [`x.test/${i + 1}`] },
  }));
  const deps: BuildDeps = {
    db, sourceDb: db, jev: createStoriesJev(storiesJev, db), write: stubWriter({}), photos: stubPhotos(), settings: DEFAULT_SETTINGS, now: SPIN_NOW, setId: set.id, nyDate: SPIN_DATE,
    pool: { stories: pool, leads: [] }, intake: true, news,
  };
  const r = await buildMorningDownload(deps);
  const keys = r.ok ? (r.payload.stories as Array<{ key: string }>).map((s) => s.key) : [];
  return { r, keys, sameEvent, devCalls: storiesJev.calls.filter((c) => c.keys.includes('new_event')) };
}

test('MD spin-off: a different article about a story we ran is blocked unless it is a real new development', async () => {
  const blocked = await spinOff(DEVELOPMENT_BAR - 0.2);
  assert.equal(blocked.r.ok, true, blocked.r.ok ? '' : blocked.r.skip);
  assert.deepEqual(blocked.sameEvent, [['Acme ships its Rocket', 'Acme Rocket review']], 'one Jev pair: the only one sharing a name');
  assert.equal(blocked.devCalls.length, 1);
  assert.deepEqual(blocked.keys, ['x.test/2', 'x.test/3']);
  const row = blocked.r.candidates.filter((c) => (c.payload as { headline: string }).headline === 'Acme Rocket review');
  assert.equal(row.length, 1, 'one candidate row for the blocked story');
  assert.match(row[0]!.reason!, /^spin-off of a story we ran; new articles but no new event/);

  const back = await spinOff(DEVELOPMENT_BAR + 0.2);
  assert.equal(back.r.ok, true, back.r.ok ? '' : back.r.skip);
  assert.equal(back.devCalls.length, 1);
  assert.ok(back.keys.includes('x.test/1'), 'a real development posts');
  const story = (back.r.ok ? (back.r.payload.stories as Array<{ key: string; we_already_said?: { headline: string } }>) : []).find((s) => s.key === 'x.test/1')!;
  assert.equal(story.we_already_said?.headline, 'Acme ships its Rocket');
});

/* ── the photo bank (D49): the build offers its news-finder photos ── */

const BANK_SCRIPTS: Script[] = [
  { headline: 'OpenAI ships GPT-6', top: true, photo: 'good' },
  { headline: 'Nvidia earnings beat', top: true, photo: 'none' },
  { headline: 'Google trims Gemini prices', top: true, photo: 'usable' },
];

test('MD photo bank: each posted story\'s pick is offered as picked at its slide; a story with nothing is not offered', async () => {
  const offers: HeldOfferInput[] = [];
  const { r, posted } = await chain(BANK_SCRIPTS, { bank: { offerHeld: (input) => void offers.push(input) } });
  assert.equal(r.ok, true, r.ok ? '' : r.skip);
  assert.deepEqual(posted, ['OpenAI ships GPT-6', 'Google trims Gemini prices']);
  assert.equal(offers.length, 2);
  assert.ok(offers.every((o) => o.runKind === 'story' && o.runRef === `stories-build:${NOW.toISOString()}`));
  const picked = offers.flatMap((o) => o.items.filter((i) => i.outcome === 'picked'));
  assert.deepEqual(picked.map((i) => [i.slide, i.url]), [
    [2, 'https://news.test/openai-ships-gpt-6/photo.jpg'],
    [3, 'https://news.test/google-trims-gemini-prices/photo.jpg'],
  ]);
  for (const i of picked) {
    assert.ok(i.bytes.length > 0);
    assert.equal(i.credit, 'Photo: Wire');
    // A news photo's credit is not a licence: stored as unknown, never reusable (policy.ts storedLicence).
    assert.equal(i.licence, 'unknown');
    assert.equal(i.reuseOk, false);
    assert.equal(i.lane, 'news-photos');
  }
  assert.equal(picked[0]!.title, 'OpenAI ships GPT-6');
  assert.ok(!offers.some((o) => o.items.some((i) => i.url.includes('nvidia'))));
});

test('MD photo bank: no bank changes nothing, and a throwing bank never fails the build', async () => {
  const plain = await chain(BANK_SCRIPTS);
  const throwing = await chain(BANK_SCRIPTS, { bank: { offerHeld: () => { throw new Error('bank down'); } } });
  assert.equal(plain.r.ok, true);
  assert.equal(throwing.r.ok, true);
  assert.deepEqual(throwing.posted, plain.posted);
  assert.deepEqual(throwing.stories.map((f) => f.photo?.credit), plain.stories.map((f) => f.photo?.credit));
});
