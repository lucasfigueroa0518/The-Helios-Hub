/** Targeted Revisions task 6: the AI Events description on PGlite. Offline: render, storage and image sources are stubs. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiEventsDescription, type AiEventsDeps } from '@/lib/revisions/descriptions/ai-events';
import { descriptionFor } from '@/lib/revisions/registry';
import { createCostMeter } from '@/lib/revisions/caps';
import { buildAiEventsCityPost, COPY_MAX } from '@/lib/ai-events/post';
import { aiEventsItemId } from '@/lib/ai-events/items';
import { scheduleAiEventsPost } from '@/lib/ai-events/schedule';
import { approveItem } from '@/lib/social-hub/spine';
import type { HubQuery } from '@/lib/social-hub/db';
import type { Query } from '@/lib/social/store/pg';
import type { Post as RenderPost } from '@/lib/social/render/types';
import type { Interpretation, PartRef } from '@/lib/revisions/types';

import { openAiEventsDb, SUN_NOON, WEEK } from './fixtures/ai-events/seed';

const pick = (n: number) => ({
  id: `e${n}`, title: `Event number ${n}`, start: `2026-10-2${6 + n}T22:30:00Z`, end: null, timezone: 'America/New_York', metro: 'miami' as const,
  organizer: `Host ${n}`, venue: `Venue ${n}`, city: 'Miami Beach', price: { free: true, minCents: null, maxCents: null, currency: null },
  access: 'open' as const, soldOut: false, waitlist: false, going: 10, rsvpUrl: `https://luma.com/e${n}`, image: `https://img.test/e${n}.jpg`,
});

/** A review post as a run leaves it: cover, #2, #3, tease, cta (5 slides); #2 is slide 2 and #3 is slide 3 (1-based). */
async function seed(q: HubQuery, status = 'review') {
  const picks = [1, 2, 3].map(pick);
  const render = buildAiEventsCityPost({ weekKey: WEEK, weekStart: '2026-10-26', weekEnd: '2026-11-01', metro: 'miami', picks, totalCount: 5, look: 'glass' });
  const slug = 'ai-events-2026-w44-miami';
  const objects = render.slides.map((_, i) => `ai-events/${slug}/v1/slide-${String(i + 1).padStart(2, '0')}.jpg`);
  const { rows } = await q<{ id: string }>(
    `INSERT INTO ai_events.posts (week_key, slug, ny_date, status, hook, look, event_ids, cities, render, caption, slide_objects, metro)
     VALUES ($1, $2, '2026-10-25', $3, 'ranked', 'glass', $4, '[]'::jsonb, $5::jsonb, $6, $7::jsonb, 'miami') RETURNING id::text AS id`,
    [WEEK, slug, status, ['e1', 'e2', 'e3'], JSON.stringify(render), render.caption, JSON.stringify(objects)],
  );
  return { id: rows[0]!.id, slug, objects, render };
}

function setup(o: { candidates?: string[]; renderThrows?: boolean } = {}) {
  const calls = { rendered: [] as RenderPost[], slugs: [] as string[], unschedule: [] as string[], candidates: [] as string[] };
  const deps: AiEventsDeps = {
    renderSlide: async (slug, post) => {
      if (o.renderThrows) throw new Error('the render has 1 problem(s): title overflows');
      calls.rendered.push(post);
      calls.slugs.push(slug);
      return [`ai-events/${slug}/slide-01.jpg`];
    },
    imageCandidates: async (_q, eventId) => {
      calls.candidates.push(eventId);
      return o.candidates ?? [];
    },
    unschedule: async (_q, postId) => {
      calls.unschedule.push(postId);
      return { ok: true, note: 'Unscheduled.' };
    },
  };
  return { desc: createAiEventsDescription(deps), calls };
}

const slide = (n: number): PartRef => ({ kind: 'slide', key: String(n) });
const interp = (part: PartRef, fixKind: Interpretation['fixKind'], args?: Record<string, string>): Interpretation => ({
  vertical: 'ai_events', part, fixKind, stageTag: 'copy', instruction: 'fix it', ...(args ? { args } : {}),
});
const meter = () => createCostMeter(1);
const row = async (q: HubQuery, id: string) =>
  (await q<{ render: RenderPost; slide_objects: string[]; render_version: number; status: string }>(
    `SELECT render, slide_objects, render_version, status FROM ai_events.posts WHERE id = $1`, [id])).rows[0]!;
const ai = (r: RenderPost, i: number) => r.slides[i - 1]!.aiEvents as unknown as { pick: { title: string; host?: string; place?: string; image?: string }; layout?: string; treat?: string[] };

test('the registry carries the AI Events description, with no model cost and the fix kinds it implements', () => {
  const d = descriptionFor('ai_events')!;
  assert.ok(d);
  assert.deepEqual([...d.fixKinds].sort(), ['layout', 'photo', 'wording']);
  assert.ok(d.stageTags.length >= 3);
  for (const k of ['photo', 'wording', 'layout'] as const) assert.equal(d.estimate(k), 0);
});

test('wording fix patches the slide title and re-renders only that slide\'s JPEG', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const { desc, calls } = setup();
  const res = await desc.revise({ q: query as unknown as Query, refs: { aiEventsPostId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'title', value: 'Miami AI Night' }), meter: meter() });
  assert.equal(res.ok, true);
  assert.equal(calls.rendered.length, 1);
  assert.equal(calls.rendered[0]!.slides.length, 1);
  assert.equal(ai(calls.rendered[0]!, 1).pick.title, 'Miami AI Night');
  const after = await row(query, p.id);
  assert.equal(ai(after.render, 2).pick.title, 'Miami AI Night');
  assert.equal(ai(after.render, 3).pick.title, ai(p.render, 3).pick.title);
});

test('other slides\' storage paths are unchanged, the old path stays in before.files, render_version is bumped', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const { desc } = setup();
  const res = await desc.revise({ q: query as unknown as Query, refs: { aiEventsPostId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'host', value: 'AI Tinkerers' }), meter: meter() });
  assert.ok(res.ok);
  if (!res.ok) return;
  const after = await row(query, p.id);
  p.objects.forEach((o, i) => { if (i !== 1) assert.equal(after.slide_objects[i], o); });
  assert.notEqual(after.slide_objects[1], p.objects[1]);
  assert.deepEqual(res.before.files, [p.objects[1]]);
  assert.deepEqual(res.after.files, [after.slide_objects[1]]);
  assert.equal(after.render_version, 2);
  assert.equal(ai(after.render, 2).pick.host, 'Hosted by AI Tinkerers');
});

test('a title over COPY_MAX.title is blocked and nothing is written or rendered', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const { desc, calls } = setup();
  const res = await desc.revise({ q: query as unknown as Query, refs: { aiEventsPostId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'title', value: 'x'.repeat(COPY_MAX.title + 1) }), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) { assert.equal(res.reason, 'blocked'); assert.match(res.note, /80/); }
  assert.equal(calls.rendered.length, 0);
  const after = await row(query, p.id);
  assert.equal(after.render_version, 1);
  assert.deepEqual(after.slide_objects, p.objects);
});

test('a render failure fails the fix and leaves the post untouched', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const { desc } = setup({ renderThrows: true });
  const res = await desc.revise({ q: query as unknown as Query, refs: { aiEventsPostId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'title', value: 'Fine title' }), meter: meter() });
  assert.deepEqual(res.ok ? null : res.reason, 'failed');
  const after = await row(query, p.id);
  assert.equal(after.render_version, 1);
  assert.equal(ai(after.render, 2).pick.title, ai(p.render, 2).pick.title);
});

test('a photo swap uses another candidate for the same event and skips the current photo and photos on other slides', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const { desc, calls } = setup({ candidates: [ai(p.render, 2).pick.image!, ai(p.render, 3).pick.image!, 'https://img.test/e2-alt.jpg'] });
  const res = await desc.revise({ q: query as unknown as Query, refs: { aiEventsPostId: p.id }, interpretation: interp(slide(2), 'photo'), meter: meter() });
  assert.equal(res.ok, true);
  assert.deepEqual(calls.candidates, ['e2']);
  const after = await row(query, p.id);
  assert.equal(ai(after.render, 2).pick.image, 'https://img.test/e2-alt.jpg');
  assert.equal(ai(after.render, 3).pick.image, ai(p.render, 3).pick.image);
  if (res.ok) assert.deepEqual(res.before.photo, { image: ai(p.render, 2).pick.image });
});

test('a photo swap that would duplicate another slide\'s image is rejected', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const { desc, calls } = setup({ candidates: [ai(p.render, 3).pick.image!] });
  const res = await desc.revise({ q: query as unknown as Query, refs: { aiEventsPostId: p.id }, interpretation: interp(slide(2), 'photo'), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'blocked');
  assert.equal(calls.rendered.length, 0);
  assert.equal((await row(query, p.id)).render_version, 1);
});

test('a photo swap with no other image for the event fails with a plain note', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const { desc } = setup({ candidates: [] });
  const res = await desc.revise({ q: query as unknown as Query, refs: { aiEventsPostId: p.id }, interpretation: interp(slide(2), 'photo'), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) { assert.equal(res.reason, 'failed'); assert.match(res.note, /other image/i); }
});

test('a layout fix changes the rank slide\'s layout and treat, and rejects an unknown layout', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const { desc } = setup();
  const refs = { aiEventsPostId: p.id };
  const bad = await desc.revise({ q: query as unknown as Query, refs, interpretation: interp(slide(3), 'layout', { layout: 'sideways' }), meter: meter() });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, 'failed');
  const res = await desc.revise({ q: query as unknown as Query, refs, interpretation: interp(slide(3), 'layout', { layout: 'type', treat: 'ghost' }), meter: meter() });
  assert.equal(res.ok, true);
  const after = await row(query, p.id);
  assert.equal(ai(after.render, 3).layout, 'type');
  assert.deepEqual(ai(after.render, 3).treat, ['ghost']);
  assert.equal(ai(after.render, 2).layout, 'poster');
});

test('a slide with fixed copy (the cover) cannot be reworded', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const { desc } = setup();
  const res = await desc.revise({ q: query as unknown as Query, refs: { aiEventsPostId: p.id }, interpretation: interp(slide(1), 'wording', { field: 'title', value: 'New' }), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'blocked');
});

test('a rejected post is refused and nothing changes', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query, 'rejected');
  const { desc, calls } = setup();
  const res = await desc.revise({ q: query as unknown as Query, refs: { aiEventsPostId: p.id }, interpretation: interp(slide(2), 'wording', { field: 'title', value: 'New title' }), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'blocked');
  assert.equal(calls.rendered.length, 0);
  assert.equal((await row(query, p.id)).render_version, 1);
});

test('restore puts back the copy, photo, layout and the old file, and is idempotent', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const { desc } = setup({ candidates: ['https://img.test/alt.jpg'] });
  const refs = { aiEventsPostId: p.id };
  const q = query as unknown as Query;
  const w = await desc.revise({ q, refs, interpretation: interp(slide(2), 'wording', { field: 'title', value: 'Changed' }), meter: meter() });
  assert.ok(w.ok);
  if (!w.ok) return;
  await desc.restore({ q, refs, part: slide(2), state: w.before });
  const back = await row(query, p.id);
  assert.deepEqual(back.slide_objects, p.objects);
  assert.deepEqual(ai(back.render, 2).pick, ai(p.render, 2).pick);
  assert.equal(back.render.slides[1]!.altText, p.render.slides[1]!.altText);
  const version = back.render_version;
  await desc.restore({ q, refs, part: slide(2), state: w.before });
  assert.equal((await row(query, p.id)).render_version, version);
  // photo and layout round trips
  const ph = await desc.revise({ q, refs, interpretation: interp(slide(3), 'photo'), meter: meter() });
  const ly = await desc.revise({ q, refs, interpretation: interp(slide(3), 'layout', { layout: 'ambient' }), meter: meter() });
  assert.ok(ph.ok && ly.ok);
  if (!ph.ok || !ly.ok) return;
  await desc.restore({ q, refs, part: slide(3), state: ly.before });
  await desc.restore({ q, refs, part: slide(3), state: ph.before });
  const end = await row(query, p.id);
  assert.deepEqual(ai(end.render, 3), ai(p.render, 3));
  assert.equal(end.slide_objects[2], p.objects[2]);
});

test('load maps status: review, approved, scheduled, published, rejected, and lists the slides as parts', async () => {
  const { query } = await openAiEventsDb({ publishingLive: true });
  const { desc } = setup();
  const q = query as unknown as Query;
  const p = await seed(query);
  const refs = { aiEventsPostId: p.id };
  const snap = await desc.load(q, refs);
  assert.equal(snap?.status, 'review');
  assert.equal(snap?.parts.length, 5);
  assert.deepEqual(snap?.parts[1]!.ref, slide(2));
  assert.match(snap!.parts[1]!.text!, /Event number 2/);
  assert.equal(snap!.parts[1]!.photoUrl, 'https://img.test/e2.jpg');
  assert.equal(snap!.parts[1]!.layout, 'poster');
  assert.equal(snap!.parts[1]!.color, 'glass');

  await approveItem(q, (await aiEventsItemId(q, p.id))!, 'user');
  assert.equal((await desc.load(q, refs))?.status, 'approved');
  await scheduleAiEventsPost(q, p.id, 'user', SUN_NOON, '2026-10-25', () => 0);
  assert.equal((await desc.load(q, refs))?.status, 'scheduled');

  await query(`UPDATE ai_events.posts SET status = 'published' WHERE id = $1`, [p.id]);
  assert.equal((await desc.load(q, refs))?.status, 'published');
  await query(`UPDATE ai_events.posts SET status = 'rejected' WHERE id = $1`, [p.id]);
  assert.equal((await desc.load(q, refs))?.status, 'rejected');
  assert.equal(await desc.load(q, { aiEventsPostId: '00000000-0000-0000-0000-000000000000' }), null);
});

test('unschedule delegates to the type\'s own unschedule', async () => {
  const { query } = await openAiEventsDb();
  const { desc, calls } = setup();
  const out = await desc.unschedule(query as unknown as Query, { aiEventsPostId: 'abc' });
  assert.deepEqual(out, { ok: true, note: 'Unscheduled.' });
  assert.deepEqual(calls.unschedule, ['abc']);
});

test('the description has an argsGuide for every fix kind it offers', () => {
  const d = descriptionFor('ai_events')!;
  for (const k of d.fixKinds) assert.ok(d.argsGuide?.[k], k);
});

test('missing or invalid args fail with a plain note and change nothing, per fix kind', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const { desc, calls } = setup();
  const refs = { aiEventsPostId: p.id };
  const bads: Array<[Interpretation['fixKind'], Record<string, string> | undefined]> = [
    ['wording', undefined],
    ['wording', { value: 'No field given' }],
    ['wording', { field: 'subtitle', value: 'x' }],
    ['wording', { field: 'title', value: '   ' }],
    ['layout', undefined],
    ['layout', { layout: 'sideways' }],
    ['layout', { treat: 'sparkle' }],
  ];
  for (const [kind, args] of bads) {
    const res = await desc.revise({ q: query as unknown as Query, refs, interpretation: interp(slide(2), kind, args), meter: meter() });
    assert.equal(res.ok, false, `${kind} ${JSON.stringify(args)}`);
    if (!res.ok) { assert.equal(res.reason, 'failed'); assert.ok(res.note.length > 10); }
  }
  assert.equal(calls.rendered.length, 0);
  const after = await row(query, p.id);
  assert.equal(after.render_version, 1);
  assert.deepEqual(after.slide_objects, p.objects);
});

test('an unsafe image URL candidate is ignored', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const unsafe = setup({ candidates: ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x'] });
  const res = await unsafe.desc.revise({ q: query as unknown as Query, refs: { aiEventsPostId: p.id }, interpretation: interp(slide(2), 'photo'), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'failed');
  const mixed = setup({ candidates: ['javascript:alert(1)', 'https://img.test/e2-safe.jpg'] });
  const ok = await mixed.desc.revise({ q: query as unknown as Query, refs: { aiEventsPostId: p.id }, interpretation: interp(slide(2), 'photo'), meter: meter() });
  assert.equal(ok.ok, true);
  assert.equal(ai((await row(query, p.id)).render, 2).pick.image, 'https://img.test/e2-safe.jpg');
});

test('missing or mismatched slide_objects fails up front, in revise and restore, writing nothing', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query);
  const { desc, calls } = setup();
  const q = query as unknown as Query;
  const refs = { aiEventsPostId: p.id };
  for (const objects of [null, JSON.stringify(p.objects.slice(0, 2))]) {
    await query(`UPDATE ai_events.posts SET slide_objects = $2::jsonb WHERE id = $1`, [p.id, objects]);
    const res = await desc.revise({ q, refs, interpretation: interp(slide(2), 'wording', { field: 'title', value: 'New title' }), meter: meter() });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'failed');
    await assert.rejects(desc.restore({ q, refs, part: slide(2), state: { files: [p.objects[1]!] } }));
  }
  assert.equal(calls.rendered.length, 0);
  assert.equal((await row(query, p.id)).render_version, 1);
});

test('a preview post is refused up front with an honest note, and nothing is rendered or written', async () => {
  const { query } = await openAiEventsDb();
  const p = await seed(query, 'preview');
  const { desc, calls } = setup();
  for (const [fix, args] of [['wording', { field: 'title', value: 'New title' }], ['layout', { layout: 'poster' }], ['photo', undefined]] as const) {
    const res = await desc.revise({ q: query as unknown as Query, refs: { aiEventsPostId: p.id }, interpretation: interp(slide(2), fix, args), meter: meter() });
    assert.equal(res.ok, false, fix);
    if (!res.ok) {
      assert.equal(res.reason, 'blocked');
      assert.equal(res.note, 'This post is still a preview; revise it once it is in review.');
    }
  }
  assert.equal(calls.rendered.length, 0);
  assert.equal(calls.candidates.length, 0);
  const r = await row(query, p.id);
  assert.equal(r.render_version, 1);
  assert.equal(r.status, 'preview');
});
