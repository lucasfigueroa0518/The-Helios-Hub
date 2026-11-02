/**
 * Targeted Revisions task 9: the IG Stories description on PGlite (openLocalStoriesDb). Offline: the
 * renderer, the article read, Jev grounding, the Sonnet rewrite and the photo finder are stubs.
 *
 * The motivating case (the Dario case): a Morning Download set whose frame 3 repeats frame 1's
 * photo; "frame 3 repeats frame 1's photo, use a different one" redoes only frame 3.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { CeilingReached, createCostMeter, resetCapsForTest, setCapsForTest } from '@/lib/revisions/caps';
import { meteredCreate, meteredJev } from '@/lib/revisions/descriptions/carousels-live';
import { createStoriesDescription, storiesDescription, STORIES_STAGE_TAGS, type StoriesDeps } from '@/lib/revisions/descriptions/stories';
import { runRevision } from '@/lib/revisions/engine';
import { descriptionFor, registerDescription, restoreRegistryForTest } from '@/lib/revisions/registry';
import { claimNextRequested, createRequest, listForItem, markRunning } from '@/lib/revisions/store';
import type { Interpretation, PartRef } from '@/lib/revisions/types';
import type { Query } from '@/lib/social/store/pg';
import type { StoriesDb } from '@/lib/stories/db';
import { openLocalStoriesDb, schemaSql } from '@/lib/stories/local-db';
import type { PhotoRequest } from '@/lib/stories/photos';
import { FREE_VS_PAID } from '@/lib/stories/render/fixtures/m1';
import type { Frame, FrameData, Photo } from '@/lib/stories/render/types';
import { approveSet, claimNextRequested as claimSet, markPublished, markPublishing, markReady, rejectSet, requestSet, saveBuild, saveFrameRender, scheduleSet, type FrameRow } from '@/lib/stories/repository';

const DARIO: Photo = { src: 'https://img.test/dario-1.jpg', credit: 'Photo: Anthropic', kind: 'person', focus: { x: 0.5, y: 0.1 } };
const OPENAI: Photo = { src: 'https://img.test/openai-office.jpg', credit: 'Photo: Jane Doe · CC BY 4.0', kind: 'scene' };
const NVIDIA: Photo = { src: 'https://img.test/nvidia-logo.png', credit: 'Logo: Nvidia', kind: 'logo' };
const FRESH: Photo = { src: 'https://img.test/dario-2.jpg', credit: 'Photo: Reuters · CC BY 4.0', kind: 'person' };
const HELD = 'https://img.test/used-this-week.jpg';

/** A Morning Download set: opener + 3 stories + closer; frame 3 (story 2) repeats the opener's Dario photo. */
const MD: FrameData[] = [
  { role: 'opener', date: 'Wednesday, October 28', storyCount: 3, photo: DARIO },
  { role: 'story', headline: 'OpenAI opened a London office that will hire 200 people.', source: { verb: 'via', name: 'Wired' }, photo: OPENAI },
  { role: 'story', headline: 'Anthropic says Claude now writes most of its own code.', source: { verb: 'reported by', name: 'Bloomberg' }, photo: DARIO },
  { role: 'story', headline: 'Nvidia posted record revenue as data center sales doubled.', source: { verb: 'via', name: 'Reuters' }, photo: NVIDIA },
  { role: 'closer' },
];
const STORIES = [
  { key: 'wired.com/openai-london', headline: (MD[1] as { headline: string }).headline, url: 'https://wired.com/openai-london', source: 'Wired', score: 0.8 },
  { key: 'bloomberg.com/anthropic-code', headline: (MD[2] as { headline: string }).headline, url: 'https://bloomberg.com/anthropic-code', source: 'Bloomberg', score: 0.9 },
  { key: 'reuters.com/nvidia', headline: (MD[3] as { headline: string }).headline, url: 'https://reuters.com/nvidia', source: 'Reuters', score: 0.7 },
];
const PHOTO_LOG = [
  { frame: 'opener', picked: DARIO.src, steps: ['person: "Dario Amodei"', 'picked'] },
  { frame: 'story 1', picked: OPENAI.src, steps: ['thematic: "OpenAI London office"', 'picked'] },
  { frame: 'story 2', picked: DARIO.src, steps: ['person: "Dario Amodei"', 'picked'] },
  { frame: 'story 3', picked: NVIDIA.src, steps: ['logo: "Nvidia"', 'picked'] },
];
const pathOf = (setId: string, seq: number, role: string) => `sets/${setId}/0${seq}-${role}.jpg`;

type Seeded = { db: StoriesDb; q: Query; setId: string; frames: FrameRow[]; payload: Record<string, unknown> };

async function seed(o: { status?: 'ready' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'rejected'; series?: 'morning_download' | 'free_vs_paid' } = {}): Promise<Seeded> {
  const { db, pg } = await openLocalStoriesDb();
  await pg.exec(schemaSql(path.join(process.cwd(), 'db', 'revisions_schema.sql')));
  const series = o.series ?? 'morning_download';
  const data = series === 'morning_download' ? MD : FREE_VS_PAID;
  const { set } = await requestSet(db, { series, nyDate: '2026-10-28', trigger: 'click', style: series === 'morning_download' ? 'polished' : 'homemade' });
  await claimSet(db);
  const payload = series === 'morning_download' ? { stories: STORIES, pool: 9, log: [], photo_log: PHOTO_LOG, historyKeys: STORIES.map((s) => s.key) } : { pair: { paid: 'Photoshop', free: 'GIMP' } };
  const rows = await saveBuild(db, set.id, {
    payload,
    frames: data.map((copy, i) => ({ seq: i + 1, role: copy.role, backdrop: 'black' as const, copy, photo: 'photo' in copy ? (copy.photo ?? null) : 'logo' in copy ? (copy.logo ?? null) : null })),
    candidates: [],
  });
  for (const f of rows) await saveFrameRender(db, f.id, { storagePath: pathOf(set.id, f.seq, f.role), jpegBytes: 1000 + f.seq, review: { round1: 'ok' } });
  await markReady(db, set.id, false);
  if (o.status && o.status !== 'ready') {
    if (o.status === 'rejected') await rejectSet(db, set.id, { note: 'no' });
    else {
      await approveSet(db, set.id);
      if (o.status !== 'approved') await scheduleSet(db, set.id, new Date('2026-10-28T13:00:00Z'));
      if (o.status === 'publishing' || o.status === 'published') await markPublishing(db, set.id);
      if (o.status === 'published') await markPublished(db, set.id);
    }
  }
  const q: Query = async (text, params) => ({ rows: (await db.query(text, params)).rows as never[] });
  return { db, q, setId: set.id, frames: await framesOf(q, set.id), payload: await payloadOf(q, set.id) };
}

const framesOf = async (q: Query, setId: string) =>
  (await q(`SELECT id::text AS id, seq, role, template, backdrop, copy, photo, storage_path, jpeg_bytes, review, flagged FROM stories.frames WHERE set_id = $1 ORDER BY seq`, [setId])).rows as FrameRow[];
const payloadOf = async (q: Query, setId: string) => (await q(`SELECT payload FROM stories.sets WHERE id = $1`, [setId])).rows[0]!.payload as Record<string, unknown>;
const statusOf = async (q: Query, setId: string) => (await q(`SELECT status FROM stories.sets WHERE id = $1`, [setId])).rows[0]!.status as string;

type Opts = {
  /** Photos the finder returns, one per call (null = nothing found). */
  finds?: Array<Photo | null>;
  /** Grounding scores, one per call. */
  scores?: number[];
  rewrite?: string | null;
  problems?: string[];
  source?: string | null;
  /** Pixel sizes by URL (default 2000×1500); null = unreadable. */
  sizes?: Record<string, { w: number; h: number } | null>;
  deps?: Partial<StoriesDeps>;
};

function setup(o: Opts = {}) {
  const calls = {
    rendered: [] as Array<{ frame: Frame; key: string }>,
    finds: [] as PhotoRequest[],
    grounded: [] as string[],
    rewrites: [] as string[],
    unschedule: [] as string[],
    paid: 0,
    sized: [] as string[],
  };
  const finds = [...(o.finds ?? [FRESH])];
  const scores = [...(o.scores ?? [0.9])];
  let ids = 0;
  const deps: StoriesDeps = {
    async renderFrame({ frame, key }) {
      calls.rendered.push({ frame, key });
      return { file: o.problems?.length ? '' : key, bytes: 4242, problems: o.problems ?? [] };
    },
    async heldPhotos() {
      return new Set([HELD]);
    },
    async sourceText() {
      return o.source === undefined ? 'The full article text. '.repeat(40) : o.source;
    },
    async grounded({ headline }, m) {
      calls.grounded.push(headline);
      calls.paid++;
      m.spend(0.001);
      return scores.length > 1 ? scores.shift()! : scores[0]!;
    },
    async rewrite({ note }, m) {
      calls.rewrites.push(note);
      calls.paid++;
      m.spend(0.03);
      return o.rewrite === null ? null : { headline: o.rewrite ?? 'Anthropic says Claude writes most of its code.' };
    },
    async findPhoto({ request }, m) {
      calls.finds.push(request);
      calls.paid++;
      m.spend(0.02);
      return finds.length > 1 ? finds.shift()! : (finds[0] ?? null);
    },
    async photoSize(url) {
      calls.sized.push(url);
      return o.sizes && url in o.sizes ? o.sizes[url]! : { w: 2000, h: 1500 };
    },
    async unschedule(_q, setId) {
      calls.unschedule.push(setId);
      return { ok: true, note: 'Unscheduled.' };
    },
    newId: () => `r${++ids}`,
    ...(o.deps ?? {}),
  };
  return { desc: createStoriesDescription(deps), calls };
}

const frame = (seq: number): PartRef => ({ kind: 'frame', key: String(seq) });
const interp = (part: PartRef, fixKind: Interpretation['fixKind'], args?: Record<string, string>): Interpretation => ({
  vertical: 'stories', part, fixKind, stageTag: 'photo', instruction: 'fix it', ...(args ? { args } : {}),
});
const meter = () => createCostMeter(5);
const refsOf = (setId: string) => ({ setId });
const srcOf = (f: FrameRow) => (f.copy as { photo?: Photo }).photo?.src;

test('the registry carries the Stories description: color and layout are free, wording and photo are priced', () => {
  const d = descriptionFor('stories')!;
  assert.ok(d);
  assert.equal(d.vertical, 'stories');
  assert.equal(d.label, 'stories');
  assert.deepEqual([...d.fixKinds].sort(), ['color', 'layout', 'photo', 'wording']);
  assert.deepEqual([...d.stageTags], [...STORIES_STAGE_TAGS]);
  assert.deepEqual([...d.stageTags], ['pick', 'write', 'ground', 'photo', 'backdrop', 'render']);
  assert.equal(d.estimate('color'), 0);
  assert.equal(d.estimate('layout'), 0);
  assert.ok(d.estimate('wording') > 0);
  assert.ok(d.estimate('photo') > 0);
  for (const k of d.fixKinds) assert.ok(d.argsGuide?.[k], k);
  assert.match(d.argsGuide!.wording!, /headline/);
  assert.match(d.argsGuide!.color!, /black.*white.*orange.*green/);
  assert.match(d.argsGuide!.layout!, /top/);
});

test('the Dario case: frame 3 repeating frame 1\'s photo is replaced with a photo not used by any other frame in the set', async () => {
  const s = await seed();
  assert.equal(srcOf(s.frames[2]!), srcOf(s.frames[0]!), 'fixture: frame 3 repeats frame 1');
  // The finder first hands back the repeated photo (the opener's), then a fresh one.
  const { desc, calls } = setup({ finds: [DARIO, FRESH] });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'photo', { hint: 'a different photo of Dario Amodei' }), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  if (!res.ok) return;
  assert.equal(calls.finds.length, 2);
  // Every other frame's photo (the opener counts), the replaced photo and the 7-day set are excluded.
  for (const r of calls.finds) {
    for (const u of [DARIO.src, OPENAI.src, NVIDIA.src, HELD]) assert.ok(r.exclude.has(u), u);
    assert.equal(r.exclude.has(FRESH.src), false);
  }
  assert.equal(calls.finds[0]!.query, 'a different photo of Dario Amodei');
  const after = await framesOf(s.q, s.setId);
  const f3 = after[2]!;
  assert.equal(srcOf(f3), FRESH.src);
  assert.deepEqual(f3.photo, (f3.copy as { photo?: Photo }).photo, 'copy.photo and photo stay in sync');
  for (const other of after.filter((f) => f.seq !== 3)) assert.notEqual(srcOf(other), FRESH.src);
  assert.equal((f3.copy as { headline: string }).headline, (MD[2] as { headline: string }).headline);
  // The set's photo log says what frame 3 shows now; the other entries are as they were.
  const log = (await payloadOf(s.q, s.setId)).photo_log as typeof PHOTO_LOG;
  assert.equal(log[2]!.picked, FRESH.src);
  assert.ok(log[2]!.steps.some((x) => /revision/.test(x)));
  assert.deepEqual(log.filter((_, i) => i !== 2), PHOTO_LOG.filter((_, i) => i !== 2));
  assert.deepEqual(res.before.files, [pathOf(s.setId, 3, 'story')]);
  assert.deepEqual(res.after.files, [`sets/${s.setId}/03-story.revr1.jpg`]);
});

test('only frame 3\'s row and JPEG change', async () => {
  const s = await seed();
  const { desc, calls } = setup({ finds: [DARIO, FRESH] });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'photo'), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(calls.rendered.length, 1);
  assert.equal(calls.rendered[0]!.frame.index, 3);
  assert.equal(calls.rendered[0]!.frame.total, 5);
  assert.equal(calls.rendered[0]!.frame.series, 'morning_download');
  assert.equal(calls.rendered[0]!.key, `sets/${s.setId}/03-story.revr1.jpg`);
  const after = await framesOf(s.q, s.setId);
  assert.deepEqual(after.filter((f) => f.seq !== 3), s.frames.filter((f) => f.seq !== 3));
  assert.equal(after[2]!.storage_path, `sets/${s.setId}/03-story.revr1.jpg`);
  assert.equal(after[2]!.jpeg_bytes, 4242);
  assert.ok(res.ok && res.before.files.includes(s.frames[2]!.storage_path!), 'the old JPEG stays referenced for undo');
});

test('opener photo counts as used: a finder that only returns the opener\'s photo fails', async () => {
  const s = await seed();
  const { desc, calls } = setup({ finds: [DARIO] });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(2), 'photo'), meter: meter() });
  assert.equal(res.ok, false);
  assert.ok(calls.finds.every((r) => r.exclude.has(DARIO.src)));
  assert.equal(calls.rendered.length, 0);
  assert.deepEqual(await framesOf(s.q, s.setId), s.frames);
});

test('finder returning only used photos returns failed, original kept', async () => {
  const s = await seed();
  const { desc, calls } = setup({ finds: [OPENAI, { ...HELD_PHOTO() }, null] });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'photo'), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, 'failed');
    assert.match(res.note, /original was kept/);
  }
  assert.ok(calls.finds.length >= 1 && calls.finds.length <= 2);
  assert.equal(calls.rendered.length, 0);
  assert.deepEqual(await framesOf(s.q, s.setId), s.frames);
  assert.deepEqual(await payloadOf(s.q, s.setId), s.payload);
});
function HELD_PHOTO(): Photo {
  return { src: HELD, credit: 'x', kind: 'scene' };
}

test('wording fix re-grounds the new headline, re-renders only that frame and updates the set\'s story list', async () => {
  const s = await seed();
  const { desc, calls } = setup({ scores: [0.85] });
  const value = 'Anthropic says Claude writes most of its own code now.';
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'wording', { field: 'headline', value }), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(calls.grounded, [value]);
  assert.equal(calls.rewrites.length, 0);
  assert.equal(calls.finds.length, 0);
  const after = await framesOf(s.q, s.setId);
  assert.equal((after[2]!.copy as { headline: string }).headline, value);
  assert.deepEqual((after[2]!.copy as { source: unknown }).source, (MD[2] as { source: unknown }).source);
  assert.deepEqual(after.filter((f) => f.seq !== 3), s.frames.filter((f) => f.seq !== 3));
  const stories = (await payloadOf(s.q, s.setId)).stories as typeof STORIES;
  assert.equal(stories[1]!.headline, value);
  assert.deepEqual([stories[0], stories[2]], [STORIES[0], STORIES[2]]);
});

test('wording fix blocked when grounding is under 0.6 (after the one rewrite), nothing written', async () => {
  const s = await seed();
  const { desc, calls } = setup({ scores: [0.4, 0.5] });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'wording', { field: 'headline', value: 'Anthropic says Claude writes all of its code.' }), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, 'blocked');
    assert.match(res.note, /fact check/i);
  }
  assert.equal(calls.grounded.length, 2);
  assert.equal(calls.rewrites.length, 1);
  assert.match(calls.rewrites[0]!, /Anthropic says Claude writes all of its code\./);
  assert.equal(calls.rendered.length, 0);
  assert.deepEqual(await framesOf(s.q, s.setId), s.frames);
  assert.deepEqual(await payloadOf(s.q, s.setId), s.payload);
});

test('wording fix: a miss whose rewrite grounds is kept', async () => {
  const s = await seed();
  const { desc } = setup({ scores: [0.3, 0.8], rewrite: 'Anthropic says Claude now writes most of its code.' });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'wording', { field: 'headline', value: 'Claude writes all Anthropic code.' }), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(((await framesOf(s.q, s.setId))[2]!.copy as { headline: string }).headline, 'Anthropic says Claude now writes most of its code.');
});

test('wording is refused on frames whose words cannot be grounded (opener, closer, Free vs. Paid) before any paid call', async () => {
  const s = await seed();
  const { desc, calls } = setup();
  for (const seq of [1, 5]) {
    const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(seq), 'wording', { field: 'headline', value: 'New words.' }), meter: meter() });
    assert.equal(res.ok, false, String(seq));
  }
  const fvp = await seed({ series: 'free_vs_paid' });
  const res = await desc.revise({ q: fvp.q, refs: refsOf(fvp.setId), interpretation: interp(frame(2), 'wording', { field: 'tease', value: 'Cheaper.' }), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'blocked');
  assert.equal(calls.paid, 0);
  assert.deepEqual(await framesOf(fvp.q, fvp.setId), fvp.frames);
});

test('wording over two sentences or 260 characters is refused before any paid call', async () => {
  const s = await seed();
  const { desc, calls } = setup();
  const long = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'wording', { field: 'headline', value: `${'Anthropic said a lot. '.repeat(14)}` }), meter: meter() });
  assert.equal(long.ok, false);
  const three = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'wording', { field: 'headline', value: 'One thing. Two things. Three things.' }), meter: meter() });
  assert.equal(three.ok, false);
  assert.equal(calls.paid, 0);
});

test('color fix cycles backdrop among black|white|orange|green without a model call', async () => {
  const s = await seed();
  const { desc, calls } = setup();
  for (const backdrop of ['white', 'orange', 'green', 'black']) {
    const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(4), 'color', { backdrop }), meter: meter() });
    assert.equal(res.ok, true, `${backdrop}: ${JSON.stringify(res)}`);
    assert.equal((await framesOf(s.q, s.setId))[3]!.backdrop, backdrop);
    assert.equal(calls.rendered.at(-1)!.frame.backdrop, backdrop);
  }
  assert.equal(calls.paid, 0);
  const after = await framesOf(s.q, s.setId);
  assert.deepEqual(after.filter((f) => f.seq !== 4), s.frames.filter((f) => f.seq !== 4));
  assert.equal(after[3]!.storage_path, `sets/${s.setId}/04-story.revr4.jpg`);
  // Same backdrop again or an unknown one: failed, nothing written.
  const same = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(4), 'color', { backdrop: 'black' }), meter: meter() });
  assert.equal(same.ok, false);
  const bad = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(4), 'color', { backdrop: 'purple' }), meter: meter() });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, 'failed');
});

test('layout fix moves the photo crop without a model call; a logo or the closer is refused', async () => {
  const s = await seed();
  const { desc, calls } = setup();
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(2), 'layout', { crop: 'top' }), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  const f2 = (await framesOf(s.q, s.setId))[1]!;
  assert.deepEqual((f2.copy as { photo: Photo }).photo.focus, { x: 0.5, y: 0 });
  assert.deepEqual(f2.photo, (f2.copy as { photo: Photo }).photo);
  assert.equal(calls.paid, 0);
  const logo = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(4), 'layout', { crop: 'top' }), meter: meter() });
  assert.equal(logo.ok, false);
  const closer = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(5), 'layout', { crop: 'top' }), meter: meter() });
  assert.equal(closer.ok, false);
});

test('render problems on the revised frame return failed, original kept', async () => {
  const s = await seed();
  const { desc } = setup({ problems: ['text fit: headline below its minimum size'] });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'photo'), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'failed');
  assert.deepEqual(await framesOf(s.q, s.setId), s.frames);
  assert.deepEqual(await payloadOf(s.q, s.setId), s.payload);
});

test('missing or invalid args fail with a plain note and change nothing', async () => {
  const s = await seed();
  const { desc, calls } = setup();
  const cases: Array<[number, Interpretation['fixKind'], Record<string, string> | undefined]> = [
    [3, 'wording', undefined],
    [3, 'wording', { field: 'headline' }],
    [3, 'wording', { field: 'source', value: 'The Verge' }],
    [3, 'color', undefined],
    [3, 'layout', undefined],
    [3, 'layout', { crop: 'sideways' }],
    [9, 'photo', undefined],
  ];
  for (const [seq, kind, args] of cases) {
    const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(seq), kind, args), meter: meter() });
    assert.equal(res.ok, false, `${seq} ${kind} ${JSON.stringify(args)}`);
    if (!res.ok) {
      assert.equal(res.reason, 'failed', `${seq} ${kind} ${JSON.stringify(args)}`);
      assert.ok(res.note.length > 10);
    }
  }
  assert.equal(calls.paid, 0);
  assert.deepEqual(await framesOf(s.q, s.setId), s.frames);
});

test('published, mid-publish and rejected sets are refused and nothing changes', async () => {
  for (const status of ['published', 'publishing', 'rejected'] as const) {
    const s = await seed({ status });
    const { desc, calls } = setup();
    const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(4), 'color', { backdrop: 'white' }), meter: meter() });
    assert.equal(res.ok, false, status);
    if (!res.ok) assert.equal(res.reason, 'blocked', status);
    assert.equal(calls.rendered.length, 0);
    assert.deepEqual(await framesOf(s.q, s.setId), s.frames);
  }
});

test('after the ceiling exactly one paid call happens, even when the pipeline code swallows the error', async () => {
  const s = await seed();
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
        return null;
      },
    },
  });
  await assert.rejects(desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'photo'), meter: createCostMeter(0.1) }), CeilingReached);
  assert.equal(paid, 1);
  assert.deepEqual(await framesOf(s.q, s.setId), s.frames);

  // Wording: the grounding dep swallows too; the rewrite is never paid for.
  let jevPaid = 0;
  const w = setup({
    deps: {
      async grounded(_input, m) {
        const jev = meteredJev(async (_request: never) => { jevPaid++; return { usage: { input_tokens: 1, output_tokens: 0 } }; }, m, () => 0.5);
        await swallow(() => jev(undefined as never));
        return 0;
      },
    },
  });
  await assert.rejects(
    w.desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'wording', { field: 'headline', value: 'Anthropic says Claude writes most code.' }), meter: createCostMeter(0.1) }),
    CeilingReached,
  );
  assert.equal(jevPaid, 1);
  assert.equal(w.calls.rewrites.length, 0);
});

test('restore puts back the frame, its old JPEG and the photo log for every fix kind, and is idempotent', async () => {
  const fixes: Array<[number, Interpretation['fixKind'], Record<string, string> | undefined]> = [
    [3, 'photo', undefined],
    [3, 'wording', { field: 'headline', value: 'Anthropic says Claude writes most of its own code now.' }],
    [4, 'color', { backdrop: 'orange' }],
    [2, 'layout', { crop: 'bottom' }],
  ];
  for (const [seq, kind, args] of fixes) {
    const s = await seed();
    const { desc, calls } = setup({ finds: [FRESH] });
    const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(seq), kind, args), meter: meter() });
    assert.equal(res.ok, true, `${kind}: ${JSON.stringify(res)}`);
    if (!res.ok) continue;
    const renders = calls.rendered.length;
    await desc.restore({ q: s.q, refs: refsOf(s.setId), part: frame(seq), state: res.before });
    assert.deepEqual(await framesOf(s.q, s.setId), s.frames, kind);
    assert.deepEqual(await payloadOf(s.q, s.setId), s.payload, kind);
    await desc.restore({ q: s.q, refs: refsOf(s.setId), part: frame(seq), state: res.before });
    assert.deepEqual(await framesOf(s.q, s.setId), s.frames, `${kind} twice`);
    assert.equal(calls.rendered.length, renders, 'restore never renders or pays');
    assert.equal(calls.paid, kind === 'photo' ? 1 : kind === 'wording' ? 1 : 0);
    // Redo: `after` comes back too.
    await desc.restore({ q: s.q, refs: refsOf(s.setId), part: frame(seq), state: res.after });
    assert.deepEqual((await framesOf(s.q, s.setId))[seq - 1]!.storage_path, res.after.files[0]);
  }
});

test('undo out of order: swap frame 3, swap frame 2, undo frame 3 keeps frame 2\'s photo and its photo log entry', async () => {
  const s = await seed();
  const OTHER: Photo = { src: 'https://img.test/london.jpg', credit: 'Photo: Bob · CC BY 4.0', kind: 'scene' };
  const a = setup({ finds: [FRESH] });
  const r3 = await a.desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'photo'), meter: meter() });
  assert.equal(r3.ok, true);
  const b = setup({ finds: [OTHER] });
  const r2 = await b.desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(2), 'photo'), meter: meter() });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  // The second swap excluded the first swap's new photo.
  assert.ok(b.calls.finds[0]!.exclude.has(FRESH.src));
  if (!r3.ok) return;
  await a.desc.restore({ q: s.q, refs: refsOf(s.setId), part: frame(3), state: r3.before });
  const after = await framesOf(s.q, s.setId);
  assert.equal(srcOf(after[2]!), DARIO.src);
  assert.equal(srcOf(after[1]!), OTHER.src);
  const log = (await payloadOf(s.q, s.setId)).photo_log as typeof PHOTO_LOG;
  assert.equal(log[2]!.picked, DARIO.src);
  assert.equal(log[1]!.picked, OTHER.src);
});

test('load maps status (ready, approved, scheduled, publishing, published, rejected) and labels each frame with its role, words and photo', async () => {
  const want = { ready: 'review', approved: 'approved', scheduled: 'scheduled', publishing: 'published', published: 'published', rejected: 'rejected' } as const;
  for (const [status, mapped] of Object.entries(want)) {
    const s = await seed({ status: status as keyof typeof want });
    const snap = await setup().desc.load(s.q, refsOf(s.setId));
    assert.equal(snap?.status, mapped, status);
  }
  const s = await seed();
  const snap = (await setup().desc.load(s.q, refsOf(s.setId)))!;
  assert.equal(snap.vertical, 'stories');
  assert.deepEqual(snap.parts.map((p) => p.ref), [1, 2, 3, 4, 5].map(frame));
  const p3 = snap.parts[2]!;
  assert.match(p3.text!, /Frame 3/);
  assert.match(p3.text!, /story/);
  assert.match(p3.text!, /Claude now writes most of its own code/);
  assert.match(p3.text!, /same photo as frame 1/);
  assert.equal(p3.photoUrl, DARIO.src);
  assert.equal(p3.photoCredit, DARIO.credit);
  assert.equal(p3.color, 'black');
  assert.match(snap.parts[0]!.text!, /opener/i);
  assert.match(snap.parts[4]!.text!, /closer/i);
  assert.equal(await setup().desc.load(s.q, refsOf('00000000-0000-0000-0000-000000000000')), null);
});

test('unschedule delegates to the Stories repository\'s unscheduleSet: an approved set goes back to ready', async () => {
  const s = await seed({ status: 'scheduled' });
  const out = await storiesDescription.unschedule(s.q, refsOf(s.setId));
  assert.equal(out.ok, true, out.note);
  assert.equal(await statusOf(s.q, s.setId), 'ready');
  const snap = await storiesDescription.load(s.q, refsOf(s.setId));
  assert.equal(snap?.status, 'review');
});

test('an approved set goes back to review when one of its frames is revised (engine run)', async () => {
  const s = await seed({ status: 'approved' });
  const { calls } = setup();
  // The real repository unschedule, so the set really leaves approval.
  const real = createStoriesDescription(depsWithRealUnschedule(calls));
  registerDescription(real);
  setCapsForTest({ stories: { color: { capUsd: 0.5, ceilingUsd: 1 } } });
  try {
    const item = (await s.q(`SELECT id::text AS id FROM social_hub.content_items WHERE vertical = 'stories' AND native_ref = $1`, [s.setId])).rows[0]!.id as string;
    const approvedBefore = await s.q(`SELECT 1 FROM social_hub.approvals WHERE content_item_id = $1 AND decision = 'approved'`, [item]);
    assert.equal(approvedBefore.rows.length, 1);
    await createRequest(s.q, { vertical: 'stories', refs: refsOf(s.setId), itemId: item, by: 'tommy', instruction: 'make frame 4 white' });
    const row = (await claimNextRequested(s.q))!;
    const it = interp(frame(4), 'color', { backdrop: 'white' });
    await markRunning(s.q, row.id, it, 0, 0);
    await runRevision({ q: s.q, notify: async () => {}, now: () => new Date() }, { ...row, interpretation: it });
    const [done] = await listForItem(s.q, item);
    assert.equal(done!.status, 'applied', done!.note ?? '');
    assert.equal(await statusOf(s.q, s.setId), 'ready');
    const approvedAfter = await s.q(`SELECT 1 FROM social_hub.approvals WHERE content_item_id = $1 AND decision = 'approved'`, [item]);
    assert.equal(approvedAfter.rows.length, 0);
    assert.equal((await framesOf(s.q, s.setId))[3]!.backdrop, 'white');
  } finally {
    restoreRegistryForTest();
    resetCapsForTest();
  }
});

/** The stub deps with the real Stories unschedule (repository unscheduleSet through the live deps). */
function depsWithRealUnschedule(calls: ReturnType<typeof setup>['calls']): StoriesDeps {
  let ids = 0;
  return {
    async renderFrame({ frame: f, key }) {
      calls.rendered.push({ frame: f, key });
      return { file: key, bytes: 10, problems: [] };
    },
    heldPhotos: async () => new Set<string>(),
    sourceText: async () => null,
    grounded: async () => 0,
    rewrite: async () => null,
    findPhoto: async () => null,
    photoSize: async () => null,
    unschedule: (q, setId) => storiesDescription.unschedule(q, { setId }),
    newId: () => `e${++ids}`,
  };
}

/* ── Fix round 1: opener cover rules, honest rewrite errors, no rejected photos back ── */

test('opener photo swap applies the cover rules: a logo is rejected, then a good photo is accepted', async () => {
  const s = await seed();
  const GOOD: Photo = { src: 'https://img.test/anthropic-hq.jpg', credit: 'Photo: Ann · CC BY 4.0', kind: 'scene' };
  const LOGO: Photo = { src: 'https://img.test/anthropic-logo.png', credit: 'Logo: Anthropic', kind: 'logo' };
  const { desc, calls } = setup({ finds: [LOGO, GOOD] });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(1), 'photo'), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(calls.finds.length, 2);
  assert.ok(calls.finds[1]!.exclude.has(LOGO.src), 'the rejected logo is not offered again');
  assert.equal(srcOf((await framesOf(s.q, s.setId))[0]!), GOOD.src);
  assert.deepEqual(calls.sized, [GOOD.src]);
});

test('opener photo swap applies the cover rules: an undersized photo is rejected, then one over 1080 is accepted', async () => {
  const s = await seed();
  const SMALL: Photo = { src: 'https://img.test/small.jpg', credit: 'Photo: Sam · CC BY 4.0', kind: 'person' };
  const BIG: Photo = { src: 'https://img.test/big.jpg', credit: 'Photo: Bea · CC BY 4.0', kind: 'person' };
  const { desc, calls } = setup({ finds: [SMALL, BIG], sizes: { [SMALL.src]: { w: 1200, h: 900 }, [BIG.src]: { w: 1600, h: 1080 } } });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(1), 'photo'), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(calls.sized, [SMALL.src, BIG.src]);
  assert.equal(srcOf((await framesOf(s.q, s.setId))[0]!), BIG.src);
});

test('opener photo swap: only undersized or unreadable photos fails with a plain note and writes nothing', async () => {
  const s = await seed();
  const SMALL: Photo = { src: 'https://img.test/small.jpg', credit: 'Photo: Sam · CC BY 4.0', kind: 'person' };
  const UNKNOWN: Photo = { src: 'https://img.test/unknown.jpg', credit: 'Photo: Uma · CC BY 4.0', kind: 'scene' };
  const { desc, calls } = setup({ finds: [SMALL, UNKNOWN], sizes: { [SMALL.src]: { w: 800, h: 600 }, [UNKNOWN.src]: null } });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(1), 'photo'), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, 'failed');
    assert.match(res.note, /too small for the opening frame/);
  }
  assert.equal(calls.rendered.length, 0);
  assert.deepEqual(await framesOf(s.q, s.setId), s.frames);
  assert.deepEqual(await payloadOf(s.q, s.setId), s.payload);
});

test('story frame photo swaps are not held to the cover floor', async () => {
  const s = await seed();
  const { desc, calls } = setup({ finds: [FRESH], sizes: { [FRESH.src]: { w: 700, h: 600 } } });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'photo'), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(calls.sized, []);
});

test('wording: a writer outage is failed with an honest note, never a fact-check block; nothing written', async () => {
  const s = await seed();
  const { desc } = setup({ scores: [0.3], deps: { rewrite: async () => { throw new Error('529 overloaded'); } } });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'wording', { field: 'headline', value: 'Claude writes all Anthropic code.' }), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, 'failed');
    assert.match(res.note, /couldn't reach the writer/);
    assert.doesNotMatch(res.note, /fact check could not/);
  }
  assert.deepEqual(await framesOf(s.q, s.setId), s.frames);

  const g = setup({ deps: { grounded: async () => { throw new Error('Jev timeout'); } } });
  const res2 = await g.desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'wording', { field: 'headline', value: 'Claude writes all Anthropic code.' }), meter: meter() });
  assert.equal(res2.ok, false);
  if (!res2.ok) {
    assert.equal(res2.reason, 'failed');
    assert.match(res2.note, /couldn't reach the fact check/);
  }
  const n = setup({ scores: [0.3], rewrite: null });
  const res3 = await n.desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(3), 'wording', { field: 'headline', value: 'Claude writes all Anthropic code.' }), meter: meter() });
  assert.equal(res3.ok, false);
  if (!res3.ok) assert.equal(res3.reason, 'failed');
  assert.deepEqual(await framesOf(s.q, s.setId), s.frames);
});

test('swap frame 2 twice: the second result differs from both the original and the first replacement', async () => {
  const s = await seed();
  const SECOND: Photo = { src: 'https://img.test/london-2.jpg', credit: 'Photo: Lee · CC BY 4.0', kind: 'scene' };
  const a = setup({ finds: [FRESH] });
  assert.equal((await a.desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(2), 'photo'), meter: meter() })).ok, true);
  // The finder offers the original (turned down) first, then the first replacement, then a new one.
  const b = setup({ finds: [OPENAI, FRESH, SECOND] });
  const res = await b.desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(2), 'photo', { hint: 'the London office' }), meter: meter() });
  assert.ok(b.calls.finds.every((r) => r.exclude.has(OPENAI.src) && r.exclude.has(FRESH.src)));
  // Two searches: the original and the first replacement are both refused, so the swap fails honestly.
  assert.equal(res.ok, false);
  assert.equal(srcOf((await framesOf(s.q, s.setId))[1]!), FRESH.src);
  const c = setup({ finds: [SECOND] });
  const ok = await c.desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(2), 'photo'), meter: meter() });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const now = srcOf((await framesOf(s.q, s.setId))[1]!);
  assert.equal(now, SECOND.src);
  assert.notEqual(now, OPENAI.src);
  assert.notEqual(now, FRESH.src);
});

test('a photo turned down in an applied revision (revisions log) is excluded even without a photo log entry', async () => {
  const s = await seed();
  const TURNED_DOWN = 'https://img.test/turned-down.jpg';
  const item = (await s.q(`SELECT id::text AS id FROM social_hub.content_items WHERE vertical = 'stories' AND native_ref = $1`, [s.setId])).rows[0]!.id as string;
  await s.q(
    `INSERT INTO revisions.requests (vertical, item_id, refs, instruction, status, part, fix_kind, before)
     VALUES ('stories', $1, $2::jsonb, 'different photo', 'applied', $3::jsonb, 'photo', $4::jsonb)`,
    [item, JSON.stringify(refsOf(s.setId)), JSON.stringify(frame(4)), JSON.stringify({ copy: { ...MD[3], photo: { src: TURNED_DOWN, credit: 'x', kind: 'scene' } }, files: [] })],
  );
  const { desc, calls } = setup({ finds: [{ src: TURNED_DOWN, credit: 'x', kind: 'scene' }, FRESH] });
  const res = await desc.revise({ q: s.q, refs: refsOf(s.setId), interpretation: interp(frame(4), 'photo'), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(calls.finds[0]!.exclude.has(TURNED_DOWN));
  assert.equal(srcOf((await framesOf(s.q, s.setId))[3]!), FRESH.src);
});
