/**
 * Targeted Revisions task 8: the Last Few Days description on PGlite. Offline: the render, the
 * article read, Jev grounding, the Sonnet rewrite, the photo finder and the Haiku vision check are stubs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPost, composeCaption, creditsFor } from '@/lib/lfd/post';
import { readyFromSaved, type SavedStory } from '@/lib/memes/lfd-sim/post';
import { meteredCreate, meteredJev } from '@/lib/revisions/descriptions/carousels-live';
import {
  createLastFewDaysDescription,
  LFD_WORDING_ESTIMATE_USD,
  type LastFewDaysDeps,
} from '@/lib/revisions/descriptions/last-few-days';
import { descriptionFor } from '@/lib/revisions/registry';
import { CeilingReached, createCostMeter } from '@/lib/revisions/caps';
import type { Interpretation, PartRef } from '@/lib/revisions/types';
import type { Post as RenderPost } from '@/lib/social/render/types';
import type { Query } from '@/lib/social/store/pg';
import { CALL_RESERVE_USD } from '@/lib/social/pipeline/live-stages';
import type { Photo } from '@/lib/stories/render/types';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const SLUG = 'lfd-2026-10-28';
const OBJECTS = [1, 2, 3, 4, 5].map((i) => `lfd/${SLUG}/slide-0${i}.jpg`);
const ASK = { kind: 'person', query: 'Dario Amodei', subjects: [{ name: 'Dario Amodei', type: 'person' as const }], alts: [] };

type Story = SavedStory & { photoAsk?: typeof ASK; photoTrace?: string[] };

function stories(): Story[] {
  const base = { lane: 'major' as const, origin: 'feed' as const, major: 90, net: null, lead: null };
  return [
    { ...base, key: 'k1', url: 'https://a.test/1', outlet: 'The Verge', setup: 'Big week:', headline: 'Anthropic ships Claude Haiku 5.5', highlight: 'Haiku 5.5', names: ['Anthropic'], body: 'It is faster and cheaper than before', photo: { src: 'https://img.test/one.jpg', credit: 'Anthropic', kind: 'scene', focus: { x: 0.5, y: 0.5 } }, photoSource: 'lead', photoAsk: ASK, photoTrace: ['lead image'] },
    { ...base, key: 'k2', url: 'https://a.test/2', outlet: 'Wired', setup: '', headline: 'OpenAI opens a London office', highlight: '', names: ['OpenAI'], body: 'The office will hire 200 people', photo: { src: 'https://img.test/logo.png', credit: 'OpenAI', kind: 'logo' }, photoSource: 'finder', photoAsk: ASK, photoTrace: [] },
    { ...base, key: 'k3', url: 'https://a.test/3', outlet: 'Reuters', setup: '', headline: 'Nvidia posts record revenue', highlight: '', names: ['Nvidia'], body: 'Data center sales doubled', photo: { src: 'https://img.test/three.jpg', credit: 'Jane Doe / CC BY', kind: 'person' }, photoSource: 'finder', photoAsk: ASK, photoTrace: [] },
  ];
}

type Seeded = { id: string; stories: Story[]; render: RenderPost; caption: string };

async function seed(q: Query, o: { status?: string; caption?: 'template' | 'model'; coverMeme?: boolean } = {}): Promise<Seeded> {
  const st = stories();
  const ready = st.map(readyFromSaved);
  const render = buildPost(ready, new Date('2026-10-28T12:00:00Z'), undefined, o.coverMeme ? { coverMeme: { url: 'storage:lfd/x/meme-1.png' } } : undefined);
  const caption = o.caption === 'model'
    ? ['Swipe to catch up on the week', 'Haiku got faster. OpenAI is hiring in London.', 'Which one caught your eye?', 'Retail teams should watch the price drop. Helios thinks so.', creditsFor(ready)].join('\n\n')
    : composeCaption(ready, null).caption;
  render.caption = caption;
  const { rows } = await q(
    `INSERT INTO lfd.posts (slug, ny_date, status, idea_ids, stories, render, caption, slide_objects, fit_problems, short)
     VALUES ($1, '2026-10-28', $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, '[]'::jsonb, true) RETURNING id::text AS id`,
    [SLUG, o.status ?? 'review', st.map((s) => s.key), JSON.stringify(st), JSON.stringify(render), caption, JSON.stringify(OBJECTS)],
  );
  // The 7-day rule's set, and the last post's photos (the repeat check).
  await q(`INSERT INTO social.used_photos (url, used_at, story_id, slide) VALUES ('https://img.test/recent.jpg', now() - interval '2 days', 'lfd:x', 2)`);
  await q(
    `INSERT INTO lfd.posts (slug, ny_date, status, idea_ids, stories, render, caption) VALUES ('lfd-2026-10-24', '2026-10-24', 'published', '{}', $1::jsonb, '{}'::jsonb, 'c')`,
    [JSON.stringify([{ headline: 'old', body: 'old', photo: { src: 'https://img.test/last-post.jpg', credit: 'x', kind: 'scene' } }])],
  );
  // As stored (jsonb drops undefined fields).
  return { id: rows[0]!.id as string, stories: st, render: JSON.parse(JSON.stringify(render)) as RenderPost, caption };
}

type Opts = {
  grounded?: boolean[];
  rewrite?: Partial<Story> | null;
  photo?: Photo | null;
  vision?: { ok: boolean; reason: string };
  fitProblems?: string[];
  renderProblems?: string[];
  source?: string | null;
  deps?: Partial<LastFewDaysDeps>;
};

function setup(o: Opts = {}) {
  const calls = {
    rendered: [] as Array<{ post: RenderPost; slides: Array<{ slide: number; key: string }> }>,
    grounded: [] as Array<{ headline: string; setup: string; body: string }>,
    rewrites: [] as Array<{ note: string }>,
    photos: [] as Array<{ exclude: ReadonlySet<string>; query: string }>,
    vision: [] as Array<{ headline: string }>,
    unschedule: [] as string[],
  };
  const answers = [...(o.grounded ?? [true])];
  let ids = 0;
  const deps: LastFewDaysDeps = {
    async renderSlides({ post, slides }) {
      calls.rendered.push({ post, slides });
      return slides.map((s) => ({ slide: s.slide, file: s.key, fitProblems: o.fitProblems ?? [], renderProblems: o.renderProblems ?? [], png: Buffer.from(`png ${s.slide}`) }));
    },
    async sourceText() {
      return o.source === undefined ? 'The full article text. '.repeat(40) : o.source;
    },
    async grounded(copy, _source, m) {
      calls.grounded.push({ headline: copy.headline, setup: copy.setup, body: copy.body });
      m.spend(0.001);
      return answers.length > 1 ? answers.shift()! : answers[0]!;
    },
    async rewrite(input, m) {
      calls.rewrites.push({ note: input.note });
      m.spend(0.05);
      if (o.rewrite === null) return null;
      const s = stories().find((x) => x.key === input.pick.key)!;
      return { key: s.key, setup: s.setup, headline: s.headline, highlight: s.highlight, names: s.names, body: s.body, photo: ASK, ...(o.rewrite ?? {}) } as never;
    },
    async findPhoto(input, m) {
      calls.photos.push({ exclude: input.exclude, query: input.copy.photo.query });
      m.spend(0.02);
      const photo = o.photo === undefined ? { src: 'https://img.test/new.jpg', credit: 'Reuters / CC BY 4.0', kind: 'scene' as const } : o.photo;
      return { photo, trace: ['finder: stub'] };
    },
    async vision(_png, story, m) {
      calls.vision.push({ headline: story.headline });
      m.spend(0.003);
      return { ...(o.vision ?? { ok: true, reason: 'shows the subject' }), costUsd: 0.003 };
    },
    async unschedule(_q, postId) {
      calls.unschedule.push(postId);
      return { ok: true, note: 'Unscheduled.' };
    },
    newId: () => `r${++ids}`,
    ...(o.deps ?? {}),
  };
  return { desc: createLastFewDaysDescription(deps), calls };
}

const story = (n: number | 'cover'): PartRef => ({ kind: 'story', key: String(n) });
const interp = (part: PartRef, fixKind: Interpretation['fixKind'], args?: Record<string, string>): Interpretation => ({
  vertical: 'last_few_days', part, fixKind, stageTag: 'write', instruction: 'fix it', ...(args ? { args } : {}),
});
const meter = () => createCostMeter(5);
type Row = { stories: Story[]; render: RenderPost; caption: string; slide_objects: string[]; status: string };
const row = async (q: Query, id: string) => (await q(`SELECT stories, render, caption, slide_objects, status FROM lfd.posts WHERE id = $1`, [id])).rows[0] as Row;
const db = async () => (await openHubTestDb()).query as unknown as Query;
const refsOf = (id: string) => ({ lfdPostId: id });

test('the registry carries the Last Few Days description: layout is free, wording and photo are priced', () => {
  const d = descriptionFor('last_few_days')!;
  assert.ok(d);
  assert.equal(d.vertical, 'last_few_days');
  assert.equal(d.label, 'last few days');
  assert.deepEqual([...d.fixKinds].sort(), ['layout', 'photo', 'wording']);
  assert.equal(d.estimate('layout'), 0);
  assert.equal(LFD_WORDING_ESTIMATE_USD, CALL_RESERVE_USD);
  assert.ok(d.estimate('wording') >= LFD_WORDING_ESTIMATE_USD);
  assert.ok(d.estimate('photo') > 0);
  for (const k of d.fixKinds) assert.ok(d.argsGuide?.[k], k);
  assert.match(d.argsGuide!.wording!, /headline/);
  assert.match(d.argsGuide!.wording!, /setup/);
  assert.match(d.argsGuide!.layout!, /top/);
  assert.deepEqual([...d.stageTags], ['pick', 'write', 'ground', 'photo', 'meme', 'render']);
});

test('wording fix re-runs grounding, re-renders only that story slide, and rebuilds the template caption', async () => {
  const q = await db();
  const p = await seed(q);
  const { desc, calls } = setup();
  const m = meter();
  const res = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(3), 'wording', { field: 'headline', value: 'Nvidia posts a record quarter' }), meter: m });
  assert.equal(res.ok, true, JSON.stringify(res));
  if (!res.ok) return;
  assert.equal(calls.grounded.length, 1);
  assert.equal(calls.grounded[0]!.headline, 'Nvidia posts a record quarter');
  assert.equal(calls.rewrites.length, 0);
  assert.ok(m.spent > 0);
  assert.equal(calls.rendered.length, 1);
  assert.deepEqual(calls.rendered[0]!.slides, [{ slide: 4, key: `lfd/${SLUG}/slide-04.revr1.jpg` }]);
  const after = await row(q, p.id);
  assert.equal(after.stories[2]!.headline, 'Nvidia posts a record quarter');
  assert.equal(after.render.slides[3]!.lfdStory!.headline, 'Nvidia posts a record quarter');
  assert.match(after.render.slides[3]!.altText, /record quarter/);
  // The template caption lists the headlines: rebuilt by the pipeline's own composeCaption.
  assert.match(after.caption, /– Nvidia posts a record quarter/);
  assert.equal(after.render.caption, after.caption);
  // Other stories, slides and files untouched; the old file stays in before.files.
  assert.deepEqual(after.stories.slice(0, 2), p.stories.slice(0, 2));
  assert.deepEqual(after.render.slides.slice(0, 3), p.render.slides.slice(0, 3));
  assert.deepEqual(after.slide_objects, [...OBJECTS.slice(0, 3), `lfd/${SLUG}/slide-04.revr1.jpg`, OBJECTS[4]]);
  assert.ok(res.before.files.includes(OBJECTS[3]!));
  assert.ok(res.after.files.includes(`lfd/${SLUG}/slide-04.revr1.jpg`));
});

test('wording fix: a grounding miss gets ONE rewrite; a second miss returns blocked and writes nothing', async () => {
  const q = await db();
  const p = await seed(q);
  const { desc, calls } = setup({ grounded: [false, false], rewrite: { headline: 'Nvidia posts record sales' } });
  const res = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(3), 'wording', { field: 'headline', value: 'Nvidia triples its revenue' }), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, 'blocked');
    assert.match(res.note, /fact check/i);
  }
  assert.equal(calls.grounded.length, 2);
  assert.equal(calls.rewrites.length, 1);
  assert.match(calls.rewrites[0]!.note, /Nvidia triples its revenue/);
  assert.equal(calls.rendered.length, 0);
  const after = await row(q, p.id);
  assert.deepEqual(after.stories, p.stories);
  assert.deepEqual(after.slide_objects, OBJECTS);
});

test('wording fix: a miss whose rewrite passes keeps only the targeted field from the rewrite', async () => {
  const q = await db();
  const p = await seed(q);
  const { desc, calls } = setup({ grounded: [false, true], rewrite: { headline: 'Nvidia posts record sales', body: 'A body the person did not ask for' } });
  const res = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(3), 'wording', { field: 'headline', value: 'Nvidia triples its revenue' }), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(calls.grounded[1]!.headline, 'Nvidia posts record sales');
  const after = await row(q, p.id);
  assert.equal(after.stories[2]!.headline, 'Nvidia posts record sales');
  assert.equal(after.stories[2]!.body, p.stories[2]!.body);
});

test('wording over the limits, a third setup, or a highlight not in the headline is refused before any paid call', async () => {
  const q = await db();
  const p = await seed(q);
  const { desc, calls } = setup();
  const refs = refsOf(p.id);
  const long = await desc.revise({ q, refs, interpretation: interp(story(3), 'wording', { field: 'headline', value: 'x'.repeat(71) }), meter: meter() });
  assert.equal(long.ok, false);
  if (!long.ok) assert.equal(long.reason, 'blocked');
  // Story 1 already has a setup; give story 2 one (2 setups), then a third is refused.
  const two = await desc.revise({ q, refs, interpretation: interp(story(2), 'wording', { field: 'setup', value: 'Meanwhile' }), meter: meter() });
  assert.equal(two.ok, true, JSON.stringify(two));
  assert.equal((await row(q, p.id)).stories[1]!.setup, 'Meanwhile:');
  const third = await desc.revise({ q, refs, interpretation: interp(story(3), 'wording', { field: 'setup', value: 'Also:' }), meter: meter() });
  assert.equal(third.ok, false);
  if (!third.ok) { assert.equal(third.reason, 'blocked'); assert.match(third.note, /2/); }
  const hl = await desc.revise({ q, refs, interpretation: interp(story(1), 'wording', { field: 'highlight', value: 'not there' }), meter: meter() });
  assert.equal(hl.ok, false);
  // A highlight needs no fact check (no new words) and costs nothing.
  const before = calls.grounded.length;
  const hl2 = await desc.revise({ q, refs, interpretation: interp(story(1), 'wording', { field: 'highlight', value: 'Claude' }), meter: meter() });
  assert.equal(hl2.ok, true, JSON.stringify(hl2));
  assert.equal(calls.grounded.length, before);
});

test('photo fix runs findPhotos and the vision check, excluding the post\'s other photos', async () => {
  const q = await db();
  const p = await seed(q);
  const { desc, calls } = setup();
  const res = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(3), 'photo', { hint: 'a GPU factory' }), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  if (!res.ok) return;
  assert.equal(calls.photos.length, 1);
  const ex = calls.photos[0]!.exclude;
  for (const u of ['https://img.test/one.jpg', 'https://img.test/logo.png', 'https://img.test/three.jpg', 'https://img.test/recent.jpg', 'https://img.test/last-post.jpg']) assert.ok(ex.has(u), u);
  assert.equal(calls.photos[0]!.query, 'a GPU factory');
  assert.equal(calls.vision.length, 1);
  assert.equal(calls.vision[0]!.headline, 'Nvidia posts record revenue');
  // The story slide and the cover mosaic (which shows the story's photo) are drawn again, to new keys.
  assert.deepEqual(calls.rendered[0]!.slides.map((s) => s.slide).sort(), [1, 4]);
  const after = await row(q, p.id);
  assert.equal(after.stories[2]!.photo.src, 'https://img.test/new.jpg');
  assert.equal(after.stories[2]!.photoSource, 'finder');
  assert.equal(after.render.slides[3]!.photoUrl, 'https://img.test/new.jpg');
  assert.equal(after.render.slides[3]!.photoCredit, 'Reuters / CC BY 4.0');
  assert.deepEqual(after.render.slides[0]!.lfdCover!.photos.map((t) => t.url), ['https://img.test/one.jpg', 'https://img.test/logo.png', 'https://img.test/new.jpg']);
  // The caption's Photos credits follow the new photo (CC BY needs attribution).
  assert.match(after.caption, /Reuters \/ CC BY 4\.0/);
  assert.doesNotMatch(after.caption, /Jane Doe/);
  assert.deepEqual(after.slide_objects, [`lfd/${SLUG}/slide-01.revr1.jpg`, OBJECTS[1], OBJECTS[2], `lfd/${SLUG}/slide-04.revr1.jpg`, OBJECTS[4]]);
  assert.deepEqual([...res.before.files].sort(), [OBJECTS[0], OBJECTS[3]].sort());
});

test('photo fix: no photo, an excluded photo, or a vision rejection fails and keeps the original', async () => {
  for (const o of [{ photo: null }, { photo: { src: 'https://img.test/one.jpg', credit: 'x', kind: 'scene' as const } }, { vision: { ok: false, reason: 'a stack of newspapers' } }] as Opts[]) {
    const q = await db();
    const p = await seed(q);
    const { desc } = setup(o);
    const res = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(3), 'photo'), meter: meter() });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'failed');
    const after = await row(q, p.id);
    assert.deepEqual(after.stories, p.stories);
    assert.deepEqual(after.slide_objects, OBJECTS);
  }
});

test('photo fix on a model caption swaps only the Photos credit line', async () => {
  const q = await db();
  const p = await seed(q, { caption: 'model' });
  const { desc } = setup();
  const res = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(3), 'photo'), meter: meter() });
  assert.equal(res.ok, true);
  const after = await row(q, p.id);
  assert.ok(after.caption.startsWith('Swipe to catch up on the week\n\nHaiku got faster.'));
  assert.match(after.caption, /Photos: Anthropic; OpenAI; Reuters \/ CC BY 4\.0$/);
});

test('layout fix needs no model', async () => {
  const q = await db();
  const p = await seed(q);
  const { desc, calls } = setup();
  const m = meter();
  const res = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(3), 'layout', { crop: 'top' }), meter: m });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(m.spent, 0);
  assert.equal(calls.grounded.length + calls.rewrites.length + calls.photos.length + calls.vision.length, 0);
  const after = await row(q, p.id);
  assert.deepEqual(after.stories[2]!.photo.focus, { x: 0.5, y: 0 });
  assert.deepEqual(after.render.slides[3]!.photoFocus, { x: 0.5, y: 0 });
  assert.deepEqual(after.render.slides[0]!.lfdCover!.photos[2]!.focus, { x: 0.5, y: 0 });
});

test('layout fix: a logo (shown whole) is refused; unknown crops fail', async () => {
  const q = await db();
  const p = await seed(q);
  const { desc, calls } = setup();
  const logo = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(2), 'layout', { crop: 'top' }), meter: meter() });
  assert.equal(logo.ok, false);
  if (!logo.ok) assert.equal(logo.reason, 'blocked');
  const bad = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(3), 'layout', { crop: 'diagonal' }), meter: meter() });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, 'failed');
  assert.equal(calls.rendered.length, 0);
  assert.deepEqual((await row(q, p.id)).stories, p.stories);
});

test('fit_problems after rebuild returns failed, original kept', async () => {
  for (const o of [{ fitProblems: ['slide 4 text fit: headline "x" (too tall, min 40px)'] }, { renderProblems: ['image failed to load: https://img.test/new.jpg'] }] as Opts[]) {
    const q = await db();
    const p = await seed(q);
    const { desc } = setup(o);
    const res = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(3), 'layout', { crop: 'bottom' }), meter: meter() });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'failed');
    const after = await row(q, p.id);
    assert.deepEqual(after.stories, p.stories);
    assert.deepEqual(after.render, p.render);
    assert.deepEqual(after.slide_objects, OBJECTS);
  }
});

test('a post with publishing off still revises (publishing_live affects approval only)', async () => {
  for (const live of ['false', 'true']) {
    const q = await db();
    await q(`UPDATE lfd.settings SET value = $1::jsonb WHERE key = 'publishing_live'`, [live]);
    const p = await seed(q);
    const { desc } = setup();
    const res = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(1), 'layout', { crop: 'left' }), meter: meter() });
    assert.equal(res.ok, true, `publishing_live ${live}`);
  }
});

test('missing or invalid args fail with a plain note and change nothing', async () => {
  const q = await db();
  const p = await seed(q);
  const { desc, calls } = setup();
  for (const it of [
    interp(story(3), 'wording'),
    interp(story(3), 'wording', { field: 'title', value: 'x' }),
    interp(story(3), 'wording', { field: 'headline' }),
    interp(story(3), 'layout'),
    interp(story(9), 'photo'),
    interp({ kind: 'slide', key: '2' }, 'photo'),
  ]) {
    const res = await desc.revise({ q, refs: refsOf(p.id), interpretation: it, meter: meter() });
    assert.equal(res.ok, false, JSON.stringify(it));
    if (!res.ok) { assert.equal(res.reason, 'failed'); assert.ok(res.note.length > 10); }
  }
  assert.equal(calls.grounded.length + calls.photos.length + calls.rendered.length, 0);
  assert.deepEqual((await row(q, p.id)).stories, p.stories);
});

test('the cover refuses every fix kind with a plain note; a meme story refuses a photo swap', async () => {
  const q = await db();
  const p = await seed(q);
  const { desc, calls } = setup();
  for (const kind of ['wording', 'photo', 'layout'] as const) {
    const res = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story('cover'), kind, { field: 'headline', value: 'x', crop: 'top' }), meter: meter() });
    assert.equal(res.ok, false, kind);
    if (!res.ok) { assert.equal(res.reason, 'blocked'); assert.match(res.note, /cover/i); }
  }
  await q(`UPDATE lfd.posts SET stories = jsonb_set(stories, '{0,photoSource}', '"meme"') WHERE id = $1`, [p.id]);
  const meme = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(1), 'photo'), meter: meter() });
  assert.equal(meme.ok, false);
  if (!meme.ok) { assert.equal(meme.reason, 'blocked'); assert.match(meme.note, /meme/); }
  assert.equal(calls.photos.length + calls.rendered.length, 0);
});

test('a rejected or published post is refused and nothing changes', async () => {
  for (const status of ['rejected', 'published']) {
    const q = await db();
    const p = await seed(q, { status });
    const { desc, calls } = setup();
    const res = await desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(3), 'layout', { crop: 'top' }), meter: meter() });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'blocked');
    assert.equal(calls.rendered.length, 0);
  }
});

test('after the ceiling exactly one paid call happens, even when the pipeline code swallows the error', async () => {
  const q = await db();
  const p = await seed(q);
  let paid = 0;
  const swallow = async (f: () => Promise<unknown>) => { try { await f(); } catch { /* the finder logs a step and goes on */ } };
  const { desc } = setup({
    deps: {
      async findPhoto(_input, m) {
        const create = meteredCreate(async (_params: never) => { paid++; return {}; }, m, () => 0.5);
        const jev = meteredJev(async (_request: never) => { paid++; return { usage: { input_tokens: 1000, output_tokens: 0 } }; }, m, () => 0.5);
        for (let i = 0; i < 3; i++) {
          await swallow(() => create(undefined as never));
          await swallow(() => jev(undefined as never));
        }
        return { photo: null, trace: [] };
      },
    },
  });
  await assert.rejects(
    desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(3), 'photo'), meter: createCostMeter(0.1) }),
    CeilingReached,
  );
  assert.equal(paid, 1);
  assert.deepEqual((await row(q, p.id)).stories, p.stories);

  // Wording: the grounding dep swallows too; the rewrite is never paid for.
  let jevPaid = 0;
  const w = setup({
    deps: {
      async grounded(_c, _s, m) {
        const jev = meteredJev(async (_request: never) => { jevPaid++; return { usage: { input_tokens: 1, output_tokens: 0 } }; }, m, () => 0.5);
        await swallow(() => jev(undefined as never));
        return false;
      },
    },
  });
  await assert.rejects(
    w.desc.revise({ q, refs: refsOf(p.id), interpretation: interp(story(3), 'wording', { field: 'body', value: 'Data center sales doubled again' }), meter: createCostMeter(0.1) }),
    CeilingReached,
  );
  assert.equal(jevPaid, 1);
  assert.equal(w.calls.rewrites.length, 0);
});

test('restore puts back the story, its slides and old files for every fix kind, and is idempotent', async () => {
  const q = await db();
  const p = await seed(q);
  const { desc } = setup();
  const refs = refsOf(p.id);
  const w = await desc.revise({ q, refs, interpretation: interp(story(3), 'wording', { field: 'body', value: 'Data center sales doubled again' }), meter: meter() });
  const ph = await desc.revise({ q, refs, interpretation: interp(story(3), 'photo'), meter: meter() });
  const l = await desc.revise({ q, refs, interpretation: interp(story(3), 'layout', { crop: 'right' }), meter: meter() });
  assert.ok(w.ok && ph.ok && l.ok);
  if (!w.ok || !ph.ok || !l.ok) return;
  for (const r of [l, ph, w]) await desc.restore({ q, refs, part: story(3), state: r.before });
  const back = await row(q, p.id);
  assert.deepEqual(back.stories, p.stories);
  assert.deepEqual(back.render, p.render);
  assert.equal(back.caption, p.caption);
  assert.deepEqual(back.slide_objects, OBJECTS);
  await desc.restore({ q, refs, part: story(3), state: w.before });
  assert.deepEqual(await row(q, p.id), back);
  // Redo: restoring an `after` state brings the revision back.
  await desc.restore({ q, refs, part: story(3), state: w.after });
  assert.equal((await row(q, p.id)).stories[2]!.body, 'Data center sales doubled again');
});

test('undo out of order: swap story 1, swap story 3, undo story 1 keeps story 3\'s credit and redraws the cover', async () => {
  const q = await db();
  const p = await seed(q);
  const refs = refsOf(p.id);
  const one = setup({ photo: { src: 'https://img.test/a.jpg', credit: 'AP / CC BY 2.0', kind: 'scene' } });
  const a = await one.desc.revise({ q, refs, interpretation: interp(story(1), 'photo'), meter: meter() });
  const three = setup({ photo: { src: 'https://img.test/b.jpg', credit: 'Flickr / CC BY 4.0', kind: 'scene' } });
  const b = await three.desc.revise({ q, refs, interpretation: interp(story(3), 'photo'), meter: meter() });
  assert.ok(a.ok && b.ok);
  if (!a.ok) return;
  const restorer = setup();
  await restorer.desc.restore({ q, refs, part: story(1), state: a.before });
  const r = await row(q, p.id);
  assert.equal(r.stories[0]!.photo.src, 'https://img.test/one.jpg');
  assert.equal(r.stories[2]!.photo.src, 'https://img.test/b.jpg');
  assert.match(r.caption, /Photos: Anthropic; OpenAI; Flickr \/ CC BY 4\.0/);
  assert.doesNotMatch(r.caption, /AP \/ CC BY 2\.0|Jane Doe/);
  assert.deepEqual(r.render.slides[0]!.lfdCover!.photos.map((t) => t.url), ['https://img.test/one.jpg', 'https://img.test/logo.png', 'https://img.test/b.jpg']);
  // No saved cover image shows that mix, so the cover alone is drawn again (render only, no model call).
  assert.equal(restorer.calls.rendered.length, 1);
  assert.deepEqual(restorer.calls.rendered[0]!.slides.map((s) => s.slide), [1]);
  assert.equal(r.slide_objects[0], restorer.calls.rendered[0]!.slides[0]!.key);
  assert.equal(r.slide_objects[1], OBJECTS[1]);
  assert.equal(restorer.calls.grounded.length + restorer.calls.photos.length + restorer.calls.vision.length, 0);
});

test('load maps status: review, approved, scheduled, published, rejected, and lists the cover and stories as parts', async () => {
  const q = await db();
  const p = await seed(q);
  const { desc } = setup();
  const refs = refsOf(p.id);
  const snap = await desc.load(q, refs);
  assert.ok(snap);
  assert.equal(snap!.status, 'review');
  assert.deepEqual(snap!.parts.map((x) => x.ref), [story('cover'), story(1), story(2), story(3)]);
  assert.match(snap!.parts[0]!.text!, /cover/i);
  assert.match(snap!.parts[3]!.text!, /Nvidia posts record revenue/);
  assert.equal(snap!.parts[3]!.photoUrl, 'https://img.test/three.jpg');
  assert.equal(snap!.parts[3]!.photoCredit, 'Jane Doe / CC BY');
  const item = (await q(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('last_few_days', 'feed', $1) RETURNING id::text AS id`, [p.id])).rows[0]!.id as string;
  await q(`INSERT INTO social_hub.approvals (content_item_id, decision, via) VALUES ($1, 'approved', 'user')`, [item]);
  assert.equal((await desc.load(q, refs))?.status, 'approved');
  await q(`INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'last_few_days', '2026-10-29', 'morning', '2026-10-29T13:30:00Z', 'scheduled', 'user')`, [item]);
  assert.equal((await desc.load(q, refs))?.status, 'scheduled');
  for (const s of ['published', 'rejected']) {
    await q(`UPDATE lfd.posts SET status = $2 WHERE id = $1`, [p.id, s]);
    assert.equal((await desc.load(q, refs))?.status, s);
  }
  assert.equal(await desc.load(q, { lfdPostId: '00000000-0000-0000-0000-000000000000' }), null);
});

test('unschedule delegates to the type\'s own unscheduleLfdPost', async () => {
  const q = await db();
  const { desc, calls } = setup();
  assert.deepEqual(await desc.unschedule(q, { lfdPostId: 'abc' }), { ok: true, note: 'Unscheduled.' });
  assert.deepEqual(calls.unschedule, ['abc']);
});
