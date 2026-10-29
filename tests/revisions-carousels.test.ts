/** Targeted Revisions task 7: the Carousels description on PGlite. Offline: render, fact-check, photo chain and storage are stubs. */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { createCarouselsDescription, FACT_CHECK_CALL_ESTIMATE_USD, type CarouselsDeps } from '@/lib/revisions/descriptions/carousels';
import { CALL_RESERVE_USD } from '@/lib/social/pipeline/live-stages';
import { descriptionFor } from '@/lib/revisions/registry';
import { CeilingReached, createCostMeter } from '@/lib/revisions/caps';
import type { Interpretation, PartRef } from '@/lib/revisions/types';
import type { Photo } from '@/lib/social/photos/find';
import type { Post as RenderPost, SlideCopy } from '@/lib/social/render/types';
import type { Query } from '@/lib/social/store/pg';
import { schemaSql } from '@/lib/stories/local-db';

async function openDb(): Promise<Query> {
  const pg = new PGlite();
  await pg.exec(schemaSql(path.join(process.cwd(), 'db', 'social_schema.sql')));
  await pg.exec(schemaSql(path.join(process.cwd(), 'db', 'social_hub_schema.sql')));
  return async (text, params) => ({ rows: (await pg.query<Record<string, unknown>>(text, params)).rows });
}

const SLUG = 'post-2026-10-28-1';
const OBJECTS = [1, 2, 3, 4].map((i) => `posts/${SLUG}/slide-0${i}.jpg`);

/** cover (subject photo) · text slide (scene photo) · stat slide (no photo, green) · follow. */
function render(): RenderPost {
  const slides: SlideCopy[] = [
    { position: 0, layoutVariant: 'cover', headline: [{ text: 'Crusoe raises ', role: 'narrative' }, { text: '$3.9B', role: 'hook' }], altText: 'Crusoe raises $3.9B', photoUrl: 'https://img.test/cover.jpg', photoCredit: 'WIKIMEDIA COMMONS · CC BY-SA 4.0', photoKind: 'subject' },
    { position: 1, layoutVariant: 'text', headline: [{ text: 'The money goes to data centers', role: 'narrative' }], body: [{ text: 'Crusoe will build in ', role: 'narrative' }, { text: 'Texas', role: 'pivot' }, { text: ' first.', role: 'narrative' }], altText: 'The money goes to data centers', photoUrl: 'https://img.test/scene.jpg', photoCredit: 'OPENVERSE · CC0', photoKind: 'scene', photoPlacement: 'below' },
    { position: 2, layoutVariant: 'stat', title: [{ text: '$3.9B', role: 'hook' }], numberNote: 'raised', headline: [{ text: 'The biggest round this year', role: 'narrative' }], altText: 'The biggest round this year', canvas: 'green' },
    { position: 3, layoutVariant: 'follow', altText: 'Follow Helios' },
  ];
  return { format: 'carousel', storyType: 'tech', source: 'TechCrunch', sourceUrl: 'https://example.com/a', publishedAt: '2026-10-28', issueNumber: 0, slides, caption: 'Crusoe raised $3.9B.' } as RenderPost;
}

const DRAFT = {
  cover_options: [{ text: 'Crusoe raises $3.9B', facts: ['F1'] }],
  chosen_cover: 1,
  slides: [
    { type: 'story', headline: { text: 'The money goes to data centers', facts: ['F2'] }, body: { text: 'Crusoe will build in Texas first.', facts: ['F2'] } },
    { type: 'stat', headline: { text: 'The biggest round this year', facts: ['F1'] }, body: null },
  ],
};
const BRIEF = { the_news: { text: 'Crusoe raised $3.9B' } };

async function seed(q: Query, status = 'review') {
  const r = render();
  const { rows } = await q(
    `INSERT INTO social.posts (slug, story_id, title, status, brief, draft, render, caption, origin, slide_objects)
     VALUES ($1, 'story-1', 'Crusoe raises $3.9B', $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, 'pipeline', $7::jsonb) RETURNING id::text AS id`,
    [SLUG, status, JSON.stringify(BRIEF), JSON.stringify(DRAFT), JSON.stringify(r), r.caption, JSON.stringify(OBJECTS)],
  );
  const id = rows[0]!.id as string;
  // 7-day rule: one photo used two days ago, one used ten days ago (free again).
  await q(`INSERT INTO social.used_photos (url, used_at, story_id, slide) VALUES ('https://img.test/recent.jpg', now() - interval '2 days', 'story-0', 2), ('https://img.test/old.jpg', now() - interval '10 days', 'story-0', 2)`);
  return { id, render: r };
}

const photo = (url: string, extra: Partial<Photo> = {}): Photo => ({ url, credit: 'OPENVERSE · CC0', source: 'stock', width: 1600, height: 1000, qid: null, subject: null, ...extra });

type Opts = { photo?: Photo | null; factCheck?: { ok: true } | { ok: false; flagged: boolean; reason: string }; renderThrows?: boolean; renderedText?: (post: RenderPost, n: number) => string; spend?: number };

function setup(o: Opts = {}) {
  const calls = {
    rendered: [] as Array<{ slug: string; post: RenderPost; slide: number; key: string }>,
    factChecks: [] as Array<{ draft: unknown; slide: number }>,
    photos: [] as Array<{ slide: number; exclude: ReadonlySet<string>; hint?: string }>,
    unschedule: [] as string[],
  };
  let ids = 0;
  const spanText = (s?: Array<{ text: string }>) => (s ?? []).map((x) => x.text).join('');
  const deps: CarouselsDeps = {
    async renderSlide(input) {
      if (o.renderThrows) throw new Error('slide 2 faces: headline covers a face');
      calls.rendered.push(input);
      const sl = input.post.slides[input.slide - 1]!;
      return { file: input.key, text: o.renderedText ? o.renderedText(input.post, input.slide) : `${spanText(sl.headline)} ${spanText(sl.body)}` };
    },
    async factCheck(input, spend) {
      calls.factChecks.push({ draft: input.draft, slide: input.slide });
      spend(o.spend ?? 0.04);
      return o.factCheck ?? { ok: true };
    },
    async findPhoto(input, spend) {
      calls.photos.push({ slide: input.slide, exclude: input.exclude, ...(input.hint ? { hint: input.hint } : {}) });
      spend(o.spend ?? 0.02);
      return o.photo === undefined ? photo('https://img.test/new.jpg') : o.photo;
    },
    async unschedule(_q, postId) {
      calls.unschedule.push(postId);
      return { ok: true, note: 'Unscheduled.' };
    },
    newId: () => `r${++ids}`,
  };
  return { desc: createCarouselsDescription(deps), calls };
}

const slide = (n: number): PartRef => ({ kind: 'slide', key: String(n) });
const interp = (part: PartRef, fixKind: Interpretation['fixKind'], args?: Record<string, string>): Interpretation => ({
  vertical: 'carousels', part, fixKind, stageTag: 'render', instruction: 'fix it', ...(args ? { args } : {}),
});
const meter = () => createCostMeter(5);
type Row = { render: RenderPost; slide_objects: string[]; draft: typeof DRAFT; status: string };
const row = async (q: Query, id: string) => (await q(`SELECT render, slide_objects, draft, status FROM social.posts WHERE id = $1`, [id])).rows[0] as Row;
const text = (s?: Array<{ text: string }>) => (s ?? []).map((x) => x.text).join('');

test('the registry carries the Carousels description: render-only fixes cost 0, wording and photo cost one call each', () => {
  const d = descriptionFor('carousels')!;
  assert.ok(d);
  assert.equal(d.vertical, 'carousels');
  assert.deepEqual([...d.fixKinds].sort(), ['color', 'layout', 'photo', 'wording']);
  assert.equal(d.estimate('color'), 0);
  assert.equal(d.estimate('layout'), 0);
  assert.equal(d.estimate('wording'), CALL_RESERVE_USD);
  assert.equal(FACT_CHECK_CALL_ESTIMATE_USD, CALL_RESERVE_USD);
  assert.ok(d.estimate('photo') > 0);
  for (const k of d.fixKinds) assert.ok(d.argsGuide?.[k], k);
  for (const t of ['fact-check', 'photo', 'layout', 'canvas', 'render']) assert.ok(d.stageTags.includes(t), t);
});

test('color fix changes canvas on one slide, zero model calls', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc, calls } = setup();
  const m = meter();
  const res = await desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'color', { canvas: 'orange' }), meter: m });
  assert.equal(res.ok, true);
  assert.equal(m.spent, 0);
  assert.equal(calls.factChecks.length + calls.photos.length, 0);
  assert.equal(calls.rendered.length, 1);
  assert.equal(calls.rendered[0]!.slide, 2);
  assert.equal(calls.rendered[0]!.key, `posts/${SLUG}/slide-02.revr1.jpg`);
  const after = await row(q, p.id);
  assert.equal(after.render.slides[1]!.canvas, 'orange');
  assert.deepEqual(after.render.slides.filter((_, i) => i !== 1), p.render.slides.filter((_, i) => i !== 1));
  assert.deepEqual(after.slide_objects, [OBJECTS[0], `posts/${SLUG}/slide-02.revr1.jpg`, OBJECTS[2], OBJECTS[3]]);
  if (res.ok) {
    assert.deepEqual(res.before.files, [OBJECTS[1]]);
    assert.deepEqual(res.after.files, [`posts/${SLUG}/slide-02.revr1.jpg`]);
  }
});

test('wording fix runs the fact-check once and a failure returns blocked with the checker\'s reason', async () => {
  const q = await openDb();
  const p = await seed(q);
  const bad = setup({ factCheck: { ok: false, flagged: true, reason: 'the brief says $3.9B, not $4B' } });
  const res = await bad.desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'headline', value: 'The $4B goes to data centers' }), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, 'blocked');
    assert.match(res.note, /the brief says \$3\.9B, not \$4B/);
  }
  assert.equal(bad.calls.factChecks.length, 1);
  assert.equal(bad.calls.rendered.length, 0);
  assert.deepEqual(await row(q, p.id), { ...(await row(q, p.id)), render: p.render, slide_objects: OBJECTS, draft: DRAFT });

  // A passing check: the copy, the draft line and the one slide's JPEG change; the checker saw the new words.
  const good = setup();
  const m = meter();
  const ok = await good.desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'body', value: 'Crusoe builds in Texas first, then Wyoming.' }), meter: m });
  assert.equal(ok.ok, true);
  assert.equal(good.calls.factChecks.length, 1);
  assert.equal(good.calls.factChecks[0]!.slide, 2);
  assert.equal((good.calls.factChecks[0]!.draft as typeof DRAFT).slides[0]!.body!.text, 'Crusoe builds in Texas first, then Wyoming.');
  assert.ok(m.spent > 0);
  const after = await row(q, p.id);
  assert.equal(text(after.render.slides[1]!.body), 'Crusoe builds in Texas first, then Wyoming.');
  // The pivot phrase keeps its colour role where the new words still carry it.
  assert.ok(after.render.slides[1]!.body!.some((s) => s.text === 'Texas' && s.role === 'pivot'));
  assert.equal(after.draft.slides[0]!.body!.text, 'Crusoe builds in Texas first, then Wyoming.');
  assert.deepEqual(after.draft.slides[0]!.body!.facts, ['F2']);
  assert.deepEqual(after.render.slides[0], p.render.slides[0]);
  assert.deepEqual(after.render.slides[2], p.render.slides[2]);
});

test('a fact-check that could not run fails (not blocked) and changes nothing', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc } = setup({ factCheck: { ok: false, flagged: false, reason: 'the checker returned no answer' } });
  const res = await desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'headline', value: 'The money goes to new data centers' }), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'failed');
  assert.deepEqual((await row(q, p.id)).render, p.render);
});

test('wording over the copy limits is blocked before any fact-check; the dash rule is applied silently', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc, calls } = setup();
  const long = await desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'headline', value: 'x'.repeat(46) }), meter: meter() });
  assert.equal(long.ok, false);
  if (!long.ok) { assert.equal(long.reason, 'blocked'); assert.match(long.note, /45/); }
  const short = await desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'headline', value: 'Too short' }), meter: meter() });
  assert.equal(short.ok, false);
  if (!short.ok) assert.equal(short.reason, 'blocked');
  assert.equal(calls.factChecks.length, 0);
  const dash = await desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'headline', value: 'The money — all of it — goes to chips' }), meter: meter() });
  assert.equal(dash.ok, true);
  assert.equal(text((await row(q, p.id)).render.slides[1]!.headline), 'The money, all of it, goes to chips');
});

test('new words missing from the rendered slide fail the fix (dropped-text check) and keep the original', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc } = setup({ renderedText: () => 'The money goes to' });
  const res = await desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'headline', value: 'The money goes to new chip plants' }), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'failed');
  const after = await row(q, p.id);
  assert.deepEqual(after.render, p.render);
  assert.deepEqual(after.slide_objects, OBJECTS);
});

test('photo fix excludes every URL already in the post and the 7-day used_photos set', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc, calls } = setup({ photo: photo('https://img.test/new.jpg', { source: 'commons-search' }) });
  const m = meter();
  const res = await desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'photo', { hint: 'a data center' }), meter: m });
  assert.equal(res.ok, true);
  assert.equal(calls.photos.length, 1);
  const ex = calls.photos[0]!.exclude;
  for (const u of ['https://img.test/cover.jpg', 'https://img.test/scene.jpg', 'https://img.test/recent.jpg']) assert.ok(ex.has(u), u);
  assert.equal(ex.has('https://img.test/old.jpg'), false);
  assert.equal(calls.photos[0]!.hint, 'a data center');
  assert.ok(m.spent > 0);
  const after = await row(q, p.id);
  const s2 = after.render.slides[1]!;
  assert.equal(s2.photoUrl, 'https://img.test/new.jpg');
  assert.equal(s2.photoCredit, 'OPENVERSE · CC0');
  assert.equal(s2.photoKind, 'scene');
  assert.deepEqual(after.render.slides[0], p.render.slides[0]);
  // The new photo now counts for the 7-day rule.
  const used = (await q(`SELECT story_id, slide, post_id::text AS post_id FROM social.used_photos WHERE url = 'https://img.test/new.jpg'`)).rows;
  assert.deepEqual(used, [{ story_id: 'story-1', slide: 2, post_id: p.id }]);
  if (res.ok) assert.equal((res.before.photo as { photoUrl?: string }).photoUrl, 'https://img.test/scene.jpg');
});

test('a photo swap that returns a photo already used is refused; a subject photo leaves the full-photo layout', async () => {
  const q = await openDb();
  const p = await seed(q);
  const dup = setup({ photo: photo('https://img.test/recent.jpg') });
  const res = await dup.desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'photo'), meter: meter() });
  assert.equal(res.ok, false);
  assert.deepEqual((await row(q, p.id)).render, p.render);

  await q(`UPDATE social.posts SET render = jsonb_set(render, '{slides,1,layoutVariant}', '"image"') WHERE id = $1`, [p.id]);
  const person = setup({ photo: photo('https://img.test/person.jpg', { source: 'commons', credit: 'WIKIMEDIA COMMONS · CC BY 4.0' }) });
  const ok = await person.desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'photo'), meter: meter() });
  assert.equal(ok.ok, true);
  const s2 = (await row(q, p.id)).render.slides[1]!;
  assert.equal(s2.photoKind, 'subject');
  assert.equal(s2.layoutVariant, 'text');
  assert.equal(s2.photoPlacement, 'top');
});

test('a photo swap with no candidates returns failed and keeps the original', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc, calls } = setup({ photo: null });
  const res = await desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'photo'), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) { assert.equal(res.reason, 'failed'); assert.match(res.note, /couldn't find a different usable photo/); }
  assert.equal(calls.rendered.length, 0);
  const after = await row(q, p.id);
  assert.deepEqual(after.render, p.render);
  assert.deepEqual(after.slide_objects, OBJECTS);
});

test('fit-check failure returns failed and keeps the original', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc } = setup({ renderThrows: true });
  for (const it of [interp(slide(2), 'color', { canvas: 'white' }), interp(slide(2), 'photo'), interp(slide(2), 'layout', { photoPlacement: 'top' })]) {
    const res = await desc.revise({ q, refs: { postId: p.id }, interpretation: it, meter: meter() });
    assert.equal(res.ok, false, it.fixKind);
    if (!res.ok) { assert.equal(res.reason, 'failed'); assert.match(res.note, /faces/); }
  }
  const after = await row(q, p.id);
  assert.deepEqual(after.render, p.render);
  assert.deepEqual(after.slide_objects, OBJECTS);
  assert.equal((await q(`SELECT 1 FROM social.used_photos WHERE url = 'https://img.test/new.jpg'`)).rows.length, 0);
});

test('before state holds the previous slide JSON and storage path', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc } = setup();
  const res = await desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'layout', { photoPlacement: 'top', photoTreatment: 'bottom-fade' }), meter: meter() });
  assert.ok(res.ok);
  if (!res.ok) return;
  const old = p.render.slides[1]!;
  assert.deepEqual(res.before.files, [OBJECTS[1]]);
  assert.deepEqual((res.before.copy as { headline: unknown }).headline, old.headline);
  assert.deepEqual((res.before.copy as { body: unknown }).body, old.body);
  assert.equal((res.before.photo as { photoUrl: string }).photoUrl, old.photoUrl);
  assert.deepEqual(res.before.colors, { canvas: null });
  assert.equal((res.before.layout as { layoutVariant: string }).layoutVariant, 'text');
  assert.equal((res.before.layout as { photoPlacement: string }).photoPlacement, 'below');
  assert.equal((res.after.layout as { photoPlacement: string }).photoPlacement, 'top');
  assert.equal((res.after.layout as { photoTreatment: string }).photoTreatment, 'bottom-fade');
  // The old JPEG is still the path undo restores to; it was never overwritten.
  assert.notEqual(res.after.files[0], OBJECTS[1]);
});

test('layout fix: full photo needs a photo that may sit under text; unknown values fail', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc } = setup();
  const refs = { postId: p.id };
  const ok = await desc.revise({ q, refs, interpretation: interp(slide(2), 'layout', { layoutVariant: 'image' }), meter: meter() });
  assert.equal(ok.ok, true);
  assert.equal((await row(q, p.id)).render.slides[1]!.layoutVariant, 'image');
  const subj = await desc.revise({ q, refs, interpretation: interp(slide(1), 'layout', { photoBleed: 'true' }), meter: meter() });
  assert.equal(subj.ok, false);
  if (!subj.ok) assert.equal(subj.reason, 'blocked');
  const stat = await desc.revise({ q, refs, interpretation: interp(slide(3), 'layout', { layoutVariant: 'image' }), meter: meter() });
  assert.equal(stat.ok, false);
  if (!stat.ok) assert.equal(stat.reason, 'blocked');
});

test('missing or invalid args fail with a plain note and change nothing, per fix kind', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc, calls } = setup();
  const refs = { postId: p.id };
  const bads: Array<[Interpretation['fixKind'], Record<string, string> | undefined]> = [
    ['wording', undefined],
    ['wording', { value: 'No field given at all here' }],
    ['wording', { field: 'caption', value: 'The money goes to data centers' }],
    ['wording', { field: 'headline', value: '   ' }],
    ['color', undefined],
    ['color', { canvas: 'purple' }],
    ['layout', undefined],
    ['layout', { layoutVariant: 'sideways' }],
    ['layout', { photoPlacement: 'left' }],
    ['layout', { photoTreatment: 'glow' }],
    ['layout', { photoBleed: 'maybe' }],
  ];
  for (const [kind, args] of bads) {
    const res = await desc.revise({ q, refs, interpretation: interp(slide(2), kind, args), meter: meter() });
    assert.equal(res.ok, false, `${kind} ${JSON.stringify(args)}`);
    if (!res.ok) { assert.equal(res.reason, 'failed', `${kind} ${JSON.stringify(args)}`); assert.ok(res.note.length > 10); }
  }
  const noSlide = await desc.revise({ q, refs, interpretation: interp(slide(9), 'color', { canvas: 'white' }), meter: meter() });
  assert.equal(noSlide.ok, false);
  assert.equal(calls.rendered.length + calls.factChecks.length + calls.photos.length, 0);
  const after = await row(q, p.id);
  assert.deepEqual(after.render, p.render);
  assert.deepEqual(after.slide_objects, OBJECTS);
});

test('the follow slide and spread halves refuse the fixes that would break them', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc, calls } = setup();
  const refs = { postId: p.id };
  const follow = await desc.revise({ q, refs, interpretation: interp(slide(4), 'wording', { field: 'headline', value: 'Follow us for more AI news' }), meter: meter() });
  assert.equal(follow.ok, false);
  if (!follow.ok) assert.equal(follow.reason, 'blocked');
  await q(`UPDATE social.posts SET render = jsonb_set(render, '{slides,1,panoramaSide}', '"right"') WHERE id = $1`, [p.id]);
  const spread = await desc.revise({ q, refs, interpretation: interp(slide(2), 'photo'), meter: meter() });
  assert.equal(spread.ok, false);
  if (!spread.ok) assert.equal(spread.reason, 'blocked');
  assert.equal(calls.photos.length, 0);
});

test('a rejected or published post is refused and nothing changes', async () => {
  for (const status of ['rejected', 'published']) {
    const q = await openDb();
    const p = await seed(q, status);
    const { desc, calls } = setup();
    const res = await desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'color', { canvas: 'white' }), meter: meter() });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'blocked');
    assert.equal(calls.rendered.length, 0);
  }
});

test('the ceiling propagates out of a billable call and nothing is written', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc } = setup({ spend: 0.5 });
  await assert.rejects(
    desc.revise({ q, refs: { postId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'headline', value: 'The money goes to new chip plants' }), meter: createCostMeter(0.1) }),
    CeilingReached,
  );
  assert.deepEqual((await row(q, p.id)).render, p.render);
});

test('restore puts back the slide and the old file for every fix kind, and is idempotent', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc } = setup();
  const refs = { postId: p.id };
  const w = await desc.revise({ q, refs, interpretation: interp(slide(2), 'wording', { field: 'headline', value: 'The money goes to new chip plants' }), meter: meter() });
  const c = await desc.revise({ q, refs, interpretation: interp(slide(2), 'color', { canvas: 'white' }), meter: meter() });
  const ph = await desc.revise({ q, refs, interpretation: interp(slide(2), 'photo'), meter: meter() });
  const l = await desc.revise({ q, refs, interpretation: interp(slide(2), 'layout', { photoPlacement: 'top' }), meter: meter() });
  assert.ok(w.ok && c.ok && ph.ok && l.ok);
  if (!w.ok || !c.ok || !ph.ok || !l.ok) return;
  for (const r of [l, ph, c, w]) await desc.restore({ q, refs, part: slide(2), state: r.before });
  const back = await row(q, p.id);
  assert.deepEqual(back.render, p.render);
  assert.deepEqual(back.slide_objects, OBJECTS);
  assert.deepEqual(back.draft, DRAFT);
  await desc.restore({ q, refs, part: slide(2), state: w.before });
  assert.deepEqual(await row(q, p.id), back);
  // Redo: restoring an `after` state brings the revision back.
  await desc.restore({ q, refs, part: slide(2), state: c.after });
  assert.equal((await row(q, p.id)).render.slides[1]!.canvas, 'white');
});

test('load maps status: review, approved, scheduled, published, rejected, and lists the slides as parts', async () => {
  const q = await openDb();
  const p = await seed(q);
  const { desc } = setup();
  const refs = { postId: p.id };
  const snap = await desc.load(q, refs);
  assert.equal(snap?.status, 'review');
  assert.equal(snap?.parts.length, 4);
  assert.deepEqual(snap!.parts[1]!.ref, slide(2));
  assert.match(snap!.parts[1]!.text!, /The money goes to data centers/);
  assert.equal(snap!.parts[1]!.photoUrl, 'https://img.test/scene.jpg');
  assert.equal(snap!.parts[1]!.photoCredit, 'OPENVERSE · CC0');
  assert.equal(snap!.parts[1]!.color, 'black');
  assert.equal(snap!.parts[2]!.color, 'green');
  assert.match(snap!.parts[1]!.layout!, /text/);

  const item = (await q(`INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref) VALUES ('carousels', 'feed', $1, 'story-1') RETURNING id::text AS id`, [p.id])).rows[0]!.id as string;
  assert.equal((await desc.load(q, refs))?.status, 'review');
  await q(`INSERT INTO social_hub.approvals (content_item_id, decision, via) VALUES ($1, 'approved', 'user')`, [item]);
  assert.equal((await desc.load(q, refs))?.status, 'approved');
  await q(`INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'carousels', '2026-10-29', 'morning', '2026-10-29T13:30:00Z', 'scheduled', 'user')`, [item]);
  assert.equal((await desc.load(q, refs))?.status, 'scheduled');
  await q(`UPDATE social.posts SET status = 'published' WHERE id = $1`, [p.id]);
  assert.equal((await desc.load(q, refs))?.status, 'published');
  await q(`UPDATE social.posts SET status = 'rejected' WHERE id = $1`, [p.id]);
  assert.equal((await desc.load(q, refs))?.status, 'rejected');
  await q(`UPDATE social.posts SET status = 'preview' WHERE id = $1`, [p.id]);
  assert.equal((await desc.load(q, refs))?.status, 'preview');
  assert.equal(await desc.load(q, { postId: '00000000-0000-0000-0000-000000000000' }), null);
});

test('unschedule delegates to the type\'s own unschedulePost', async () => {
  const q = await openDb();
  const { desc, calls } = setup();
  assert.deepEqual(await desc.unschedule(q, { postId: 'abc' }), { ok: true, note: 'Unscheduled.' });
  assert.deepEqual(calls.unschedule, ['abc']);
});
