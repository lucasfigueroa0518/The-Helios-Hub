/**
 * The photo pivot (Lucas, 2026-10-09): a slide whose visual and fallback find
 * nothing tries the Writer's alt_visuals, in an order Jev picks (photo-pivot@1).
 * Offline: Jev, the sheet tags and the close-up check are stubs; the web is
 * the photo fixtures' fake. No live API.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce, TC_URL } from '@/fixtures/social/briefs';
import { sifDraft, sifDraftHandoff } from '@/fixtures/social/drafts';
import { createFakeHttp, SIF_WEB } from '@/fixtures/social/photo-http';
import type { JevAnswer, JevAsk } from '@/lib/social/jev/client';
import * as PhotoFit from '@/lib/social/jev/questions/photo-fit.v2';
import * as Pivot from '@/lib/social/jev/questions/photo-pivot.v1';
import * as Identity from '@/lib/social/jev/questions/subject-identity.v1';
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v5';
import { photosForDraft } from '@/lib/social/photos/design';
import { choosePivots, pivotOptions } from '@/lib/social/photos/pivot';
import type { TagSheet, TileTag } from '@/lib/social/photos/tag-sheet';
import { setTuning } from '@/lib/social/photos/tuning';
import type { VisionCheck, VisionVerdict } from '@/lib/social/photos/vision';
import { keepAltVisuals } from '@/lib/social/editor/editor';
import { fillDraft, type DraftSubmission, type VisualRequest } from '@/lib/social/writer/draft';
import { dropFailingVisuals, visualHandoffFailures } from '@/lib/social/writer/writer';

const v = (kind: VisualRequest['kind'], query: string): VisualRequest => ({ kind, query });
const usage = { input_tokens: 300, output_tokens: 0 };

/* ── The question: pure parts ─────────────────────────────────────── */

test('pivotOptions: drops empties, anything already tried and repeats, and caps the list', () => {
  const tried = [v('person', 'Sam Altman'), v('company', 'OpenAI')];
  const alts = [v('person', 'sam altman'), v('thematic', ''), v('thematic', 'banknotes'), v('thematic', 'Banknotes'), v('event', 'fine hearing'), v('setting', 'courtroom'), v('thematic', 'gavel'), v('thematic', 'scales')];
  const out = pivotOptions(alts, tried);
  assert.deepEqual(out.map((o) => o.query), ['banknotes', 'fine hearing', 'courtroom', 'gavel']);
  assert.equal(out.length, Pivot.MAX_OPTIONS);
  assert.deepEqual(pivotOptions(undefined, tried), []);
});

test('photo-pivot@1 questions: belongs and different for each option, best only with two or more', () => {
  assert.deepEqual(Object.keys(Pivot.buildQuestions(1)), ['belongs_0', 'different_0']);
  assert.deepEqual(Object.keys(Pivot.buildQuestions(3)), ['belongs_0', 'different_0', 'belongs_1', 'different_1', 'belongs_2', 'different_2', 'best']);
});

test('keepPivots: below either threshold is dropped, the rest go best first, at most KEEP', () => {
  const opts = ['a', 'b', 'c', 'd', 'e'];
  const scores = [
    { belongs: 0.9, different: 0.9, best: 0.1 },
    { belongs: 0.4, different: 0.9, best: 0.9 }, // doesn't belong
    { belongs: 0.9, different: 0.3, best: 0.8 }, // the same picture reworded
    { belongs: 0.8, different: 0.8, best: 0.5 },
    { belongs: 0.7, different: 0.7, best: 0.3 },
  ];
  assert.deepEqual(Pivot.keepPivots(opts, scores), ['d', 'e']);
  assert.equal(Pivot.KEEP, 2);
});

test('choosePivots: Jev sees the slide, what failed and the options; its answers pick the order; an error means no pivot', async () => {
  const seen: unknown[] = [];
  const jev: JevAsk = async (req, meta) => {
    assert.equal(meta.version, Pivot.VERSION);
    seen.push(req.state);
    return { answers: { belongs_0: { noul: 0.9 }, different_0: { noul: 0.9 }, belongs_1: { noul: 0.9 }, different_1: { noul: 0.9 }, best: { choice: 'option_1', probabilities: { option_0: 0.2, option_1: 0.8 } } }, usage, model: 'stub' };
  };
  const input = {
    jev,
    story: 'OpenAI fined',
    slide: { position: 3, kind: 'story', headline: 'OpenAI owes a huge fine', body: '' },
    alts: [v('thematic', 'banknotes'), v('setting', 'courtroom')],
    tried: [{ request: v('person', 'Sam Altman'), outcome: 'no candidates found' }, { request: v('company', 'OpenAI'), outcome: 'candidates found but none passed the checks' }],
    photosInPost: [],
  };
  const r = await choosePivots(input);
  assert.deepEqual(r.chosen.map((c) => c.query), ['courtroom', 'banknotes']);
  const state = seen[0] as Pivot.PivotState;
  assert.deepEqual(state.tried.map((t) => t.request), ['person: Sam Altman', 'company: OpenAI']);
  assert.deepEqual(state.options.map((o) => o.request), ['thematic: banknotes', 'setting: courtroom']);
  assert.match(r.steps[0]!, /photo-pivot@1/);

  const failing = await choosePivots({ ...input, jev: async () => { throw new Error('jev down'); } });
  assert.deepEqual(failing.chosen, []);
  assert.match(failing.steps[0]!, /error \(jev down\) → no pivot/);

  let asked = 0;
  const none = await choosePivots({ ...input, alts: [v('person', 'Sam Altman')], jev: async () => { asked++; throw new Error('should not ask'); } });
  assert.deepEqual(none.chosen, []);
  assert.equal(asked, 0, 'nothing left to ask about: no Jev call');
});

/* ── The Writer's alt_visuals ─────────────────────────────────────── */

test('Writer handoff: alt_visuals are required (2–3), pass the visual rules, differ from each other, and a scene slide keeps them scenes', () => {
  const brief = briefSuperIntelligenceForce();
  const fails = (edit: (d: DraftSubmission) => void) => {
    const d = sifDraftHandoff();
    edit(d);
    return visualHandoffFailures(d, brief, null).map((e) => `${e.section}: ${e.message}`).join(' | ');
  };
  assert.equal(fails(() => {}), '');
  assert.match(fails((d) => delete d.slides[0]!.alt_visuals), /slide 2\.alt_visuals: give 2–3 alt_visuals/);
  assert.match(fails((d) => (d.slides[0]!.alt_visuals = [v('thematic', 'server racks')])), /slide 2\.alt_visuals: give 2–3 alt_visuals: .*got 1/);
  assert.match(fails((d) => (d.slides[0]!.alt_visuals = [v('thematic', 'server racks'), v('thematic', 'Server Racks')])), /slide 2\.alt_visuals\[1\]: this alternative repeats/);
  assert.match(fails((d) => (d.slides[0]!.alt_visuals = [v('thematic', 'server racks'), { ...d.slides[0]!.visual }])), /slide 2\.alt_visuals\[1\]: this alternative repeats the visual/);
  assert.match(fails((d) => (d.slides[0]!.alt_visuals = [v('thematic', 'server racks'), v('thematic', 'Donald Trump podium')])), /slide 2\.alt_visuals\[1\]: scene "Donald Trump podium" names Donald Trump/);
  // A scene slide's alternatives are scenes: never a face or a logo (the 2026-10-08 CEO-portrait lesson).
  assert.match(fails((d) => { d.slides[0]!.visual = v('thematic', 'data center'); d.slides[0]!.alt_visuals = [v('thematic', 'server racks'), v('person', 'Donald Trump')]; }), /slide 2\.alt_visuals\[1\]: the visual is thematic, so every alternative is a thematic, setting, product or event visual too, never person:/);
  // A subject alternative must be tagged on the slide, like any visual.
  assert.match(fails((d) => (d.slides[4]!.alt_visuals = [v('thematic', 'server racks'), v('person', 'Donald Trump')])), /slide 6\.alt_visuals\[1\]: person: Donald Trump isn't tagged on this slide/);
});

test('final attempt: failing alternatives are dropped (logged), the rest stay; the story survives', () => {
  const d = sifDraftHandoff();
  d.slides[0]!.alt_visuals = [v('thematic', 'server racks'), v('thematic', 'Donald Trump podium'), v('setting', 'empty meeting room')];
  const failures = visualHandoffFailures(d, briefSuperIntelligenceForce(), null);
  const { draft, dropped } = dropFailingVisuals(d, failures);
  assert.deepEqual(draft.slides[0]!.alt_visuals!.map((a) => a.query), ['server racks', 'empty meeting room']);
  assert.ok(dropped.some((l) => /^alt-visual-dropped: slide 2 thematic: Donald Trump podium/.test(l)));
});

test('the Editor: a slide it echoes without alt_visuals gets them back from the Writer slide with the same visual and fallback', () => {
  const writer = sifDraftHandoff();
  writer.slides[1]!.alt_visuals = [v('thematic', 'banknotes'), v('setting', 'courtroom')];
  const edited = structuredClone(writer);
  edited.slides.forEach((s) => delete s.alt_visuals);
  edited.cover_options.forEach((c) => delete c.alt_visuals);
  edited.slides.reverse(); // the Editor may reorder
  const out = keepAltVisuals(writer, edited);
  const moved = out.slides.find((s) => s.headline.text === writer.slides[1]!.headline.text)!;
  assert.deepEqual(moved.alt_visuals!.map((a) => a.query), ['banknotes', 'courtroom']);
  assert.ok(out.cover_options.every((c) => (c.alt_visuals ?? []).length === 2), 'covers come back too');
  const kept = keepAltVisuals(writer, structuredClone(writer));
  assert.deepEqual(kept.slides[1]!.alt_visuals, writer.slides[1]!.alt_visuals, 'alternatives the Editor kept are untouched');
});

/* ── The design stage: the pivot ──────────────────────────────────── */

const verdict = (over: Partial<VisionVerdict> = {}): VisionVerdict => ({ what_it_shows: 'a wall clock on a desk', shows_requested: true, shows_requested_confidence: 0.9, person_prominent: false, landmark_visible: false, text_banner: false, ...over }) as VisionVerdict;
const vision: VisionCheck = async ({ url }) => {
  const bad = /-1\.jpg$/.test(url);
  return { ok: true, pass: !bad, verdict: verdict(bad ? { shows_requested: false } : {}), costUsd: 0.003 };
};
const tagSheet: TagSheet = async (_png, n) => ({ ok: true, costUsd: 0.004, tiles: Array.from({ length: n }, (_, i): TileTag => ({ tile: i + 1, tags: ['wall clock'], person: false, landmark: false, logo: false, named_place: false, text_banner: false })) });

function pivotJev(log: string[], options: { belongs?: number } = {}): JevAsk {
  return async (req, meta) => {
    log.push(meta.version);
    const answers: Record<string, JevAnswer> = {};
    if (meta.version === Identity.VERSION) {
      const state = req.state as ReturnType<typeof Identity.buildState>;
      answers.is_person = { noul: 0.9 };
      state.candidates.forEach((_, k) => (answers[Identity.matchId(k)] = { noul: 0.02 }));
    } else if (meta.version === Prescreen.VERSION) {
      const state = req.state as ReturnType<typeof Prescreen.buildState>;
      state.candidates.forEach((_, k) => {
        answers[Prescreen.fitId(k)] = { noul: 0.9 };
        answers[Prescreen.peopleId(k)] = { noul: 0.05 };
      });
    } else if (meta.version === PhotoFit.VERSION) {
      const state = req.state as ReturnType<typeof PhotoFit.buildState>;
      state.tiles.forEach((_, k) => (answers[PhotoFit.fitId(k)] = { noul: 0.9 }));
    } else if (meta.version === Pivot.VERSION) {
      const state = req.state as Pivot.PivotState;
      state.options.forEach((_, k) => {
        answers[Pivot.belongsId(k)] = { noul: options.belongs ?? 0.9 };
        answers[Pivot.differentId(k)] = { noul: 0.9 };
      });
      if (state.options.length > 1) answers.best = { choice: 'option_0', probabilities: Object.fromEntries(state.options.map((_, k) => [Pivot.optionId(k), k === 0 ? 0.7 : 0.3 / (state.options.length - 1)])) };
    } else {
      for (const id of Object.keys(req.questions)) answers[id] = { noul: id.startsWith('repeats_') ? 0.05 : 0.9 };
    }
    return { answers, usage, model: 'stub-jev' };
  };
}

async function design(log: string[], edit: (d: DraftSubmission) => void, jevOptions: { belongs?: number } = {}) {
  const parsed = briefSuperIntelligenceForce();
  const submission = sifDraft();
  edit(submission);
  const { http } = createFakeHttp({ ...SIF_WEB, stocksnapCount: { 'wall clock': 2 }, stockCount: Object.fromEntries(['zzzz qqqq', 'qqqq', 'xxxx wwww', 'wwww', 'yyyy vvvv', 'vvvv'].map((q) => [q, 0])) });
  const sharpHttp = (async (u: string | URL | Request) => {
    const url = String(u instanceof Request ? u.url : u);
    if (/upload\.wikimedia\.org|stock\.example|techcrunch\.com/.test(url)) {
      const sharp = (await import('sharp')).default;
      return new Response(new Uint8Array(await sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()));
    }
    return http(u as string);
  }) as typeof fetch;
  return photosForDraft(fillDraft(submission, parsed), parsed, [], { jev: pivotJev(log, jevOptions), http: sharpHttp, tagSheet, vision }, { storyDate: '2026-10-04' });
}

// Slide 2 asks for scenes the fake web has nothing for; its alternative is one it has (a wall clock).
const noSceneFound = (d: DraftSubmission) => {
  const s = d.slides[0]!;
  s.visual = v('thematic', 'zzzz qqqq');
  s.fallback_visual = v('setting', 'xxxx wwww');
  s.alt_visuals = [v('thematic', 'wall clock'), v('setting', 'yyyy vvvv')];
};

test('design: both requests find nothing → Jev picks the alt visual, it is searched and picked, and the trace says so', async (t) => {
  t.after(() => setTuning({}, true));
  setTuning({}, true);
  const log: string[] = [];
  const out = await design(log, noSceneFound);
  const slide2 = out.slides[0]!;
  assert.ok(slide2.photo, `slide 2 got a photo: ${slide2.steps.join(' / ')}`);
  assert.equal(slide2.request.query, 'wall clock');
  assert.ok(log.includes(Pivot.VERSION));
  assert.ok(slide2.steps.some((s) => /pivot check photo-pivot@1: .*thematic: wall clock belongs 0\.90/.test(s)));
  assert.ok(slide2.steps.some((s) => /pivot → thematic: "wall clock"/.test(s)));
  assert.ok(slide2.steps.some((s) => /^picked /.test(s)));
  // The photo bank also gets what the pivot's checks saw: the winner, offered on slide 2 under the alt request.
  const picked = out.vetted.find((x) => x.slide === 2 && x.outcome === 'picked');
  assert.ok(picked, 'the pivot winner is offered to the bank');
  assert.equal(picked.request.query, 'wall clock');
  assert.equal(picked.candidate.url, slide2.photo!.url);
  assert.equal(picked.vision?.pass, true, 'its close-up verdict travels with it');
  assert.ok(out.vetted.some((x) => x.slide === 2 && x.request.query === 'wall clock' && x.outcome === 'rejected'), 'a pivot candidate that failed the close-up is offered as rejected');
});

test('design: pivot off, or Jev says the options do not belong, or the slide already has a photo → the old path (icon scene, no photo, no pivot call)', async (t) => {
  t.after(() => setTuning({}, true));
  setTuning({ pivot: false, iconScenes: false }, true);
  let log: string[] = [];
  const off = await design(log, noSceneFound);
  assert.equal(off.slides[0]!.photo, null);
  assert.ok(!log.includes(Pivot.VERSION));

  setTuning({ pivot: true, iconScenes: false }, true);
  log = [];
  const rejected = await design(log, noSceneFound, { belongs: 0.1 });
  assert.equal(rejected.slides[0]!.photo, null);
  assert.ok(log.includes(Pivot.VERSION));
  assert.ok(rejected.slides[0]!.steps.some((s) => /→ none worth searching/.test(s)));

  log = [];
  await design(log, () => {});
  assert.ok(!log.includes(Pivot.VERSION), 'slides that found a photo never ask');
});
