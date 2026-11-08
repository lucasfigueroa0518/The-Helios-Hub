import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { JSDOM } from 'jsdom';
import sharp from 'sharp';

import * as nk from '../explainers/reel-ai-drama/kit/components/index.js';
import { lineSpans } from '../explainers/reel-ai-drama/kit/pace.mjs';
import { frameLines, isDateLabel, labelKind, writeProjectFiles } from '../explainers/reel-ai-drama/kit/project-files.mjs';
import { cutoutSwaps, makeCutouts, thingName, useCutouts, wantsCutout, wishCutoutRequests } from '@/lib/reel-ai-drama/harvest/cutouts';
import type { CutPerson } from '@/lib/reel-ai-drama/harvest/types';
import { wishWants } from '@/lib/reel-ai-drama/harvest/wishes';
import type { Asset, DirectorPlan, ShotWish, VisualsInventory } from '@/lib/reel-ai-drama/types';

// Iteration 7, owner 2 (MD-127 cut-out wishes and real-cutout scenes; MD-130 date labels). Offline: no
// model, no search, no rembg (a stand-in cuts), no browser (jsdom).

const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({
  id, kind: 'object', file: `media/${id}.jpg`, url: `https://example.com/${id}.jpg`, source_page: `https://example.com/page-${id}`, credit: `Photo ${id}, CC BY 2.0`, license: 'CC BY 2.0',
  shows: `A wooden dinner table with white plates (${id}).`, people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown', width: 1200, height: 800,
  phash: null, character_image: false, made: false, upscaled: false, flags: [], ...extra,
});
const inv = (assets: Asset[]): VisualsInventory => ({ assets, usable_count: assets.length, counts: {}, kill: null, usd: 0 });
const wish = (w: Partial<ShotWish> & { cut_out?: boolean }): ShotWish => ({ id: 'W1', person: null, want: 'x', frame_ns: [1], fallback: 'V1', ...w }) as ShotWish;
const frame = (n: number, treatment: string, asset_ids: string[], extra: Record<string, unknown> = {}) =>
  ({ n, name: `f${n}`, line_ids: [`L${n}`], treatment, asset_ids, purpose: 'p', motion: `push on ${asset_ids[0] ?? ''}`, marks: '', sound: '', music: 'hold', on_screen: null, ...extra }) as unknown as DirectorPlan['frames'][number];

async function jpeg(file: string, w = 400, h = 300) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: w, height: h, channels: 3, background: '#8a6f5a' } }).jpeg().toFile(file);
}
/** A stand-in for rembg: a transparent PNG of the picture, with the coverage it is told to report. */
const fakeCut = (coverage = 0.45): CutPerson => async (src, out) => {
  const info = await sharp(src).ensureAlpha().png().toFile(out);
  return { ok: true, width: info.width, height: info.height, coverage };
};

// ── 1. Wishes for objects and places, cut out (MD-127) ────────────────────────

test('wish wants: a cut-out wish for a thing searches real photos of that kind of thing, not people or shot words', () => {
  const table = wishWants(wish({ id: 'W4', want: 'A real wooden dinner table set with white plates, seen from above', cut_out: true }));
  assert.equal(table[0]!.kind, 'object');
  assert.deepEqual(table[0]!.people, []);
  assert.deepEqual(table.map((w) => w.sources[0]), ['serper', 'commons', 'serper']);
  assert.equal(table[0]!.terms, 'wooden dinner table');
  assert.equal(table[1]!.terms, 'wooden table', 'Commons ANDs every word: two words, the head noun kept');
  assert.ok(table.every((w) => !/\b(real|seen|above|photo)\b/.test(w.terms)));

  // No name, no year: a kind of thing even without cut_out (no event-date filter on it).
  assert.equal(wishWants(wish({ want: 'A brass desk lamp with a green shade' }))[0]!.kind, 'object');
  // Names or a year keep the event search; a place stays a place; a person stays a person.
  assert.equal(wishWants(wish({ want: 'The OpenAI launch party in 2015' }))[0]!.kind, 'event_photo');
  assert.equal(wishWants(wish({ want: 'The Rosewood hotel exterior at night', cut_out: true }))[0]!.kind, 'place_photo');
  const person = wishWants(wish({ person: 'Ada Lane', want: 'Ada Lane seated at a dinner, 2015', cut_out: true }));
  assert.equal(person[0]!.kind, 'person_photo');
  assert.deepEqual(person[0]!.people, ['Ada Lane']);
  assert.equal(wantsCutout(wish({ cut_out: true })), true);
  assert.equal(wantsCutout(wish({})), false, 'absent cut_out: no cutout (owner 1 adds the field)');
});

test('wishCutoutRequests: a cut_out wish asks for a cutout of what it names, in every frame that uses its photo', () => {
  const plan: DirectorPlan = {
    frames: [frame(1, 'tableau', ['V9', 'V3']), frame(2, 'collage', ['V9']), frame(3, 'photo', ['V2']), frame(4, 'page', ['V10'])],
    lines_back: [],
  };
  const inventory = inv([
    asset('V2', { kind: 'place_photo' }),
    asset('V3', { kind: 'person_photo', people: ['Ada Lane'], character_image: true, flags: ['cutout'] }),
    asset('V9', { flags: ['wish:W1'] }),
    asset('V10', { kind: 'web_page', flags: ['wish:W3'] }),
    asset('V11', { kind: 'place_photo', flags: ['wish:W4'] }),
  ]);
  const found = [
    { wish: wish({ id: 'W1', want: 'A real wooden dinner table, seen from above', frame_ns: [1, 2], cut_out: true }), asset_id: 'V9' },
    { wish: wish({ id: 'W3', want: 'The blog post page', frame_ns: [4], cut_out: true }), asset_id: 'V10' },
    { wish: wish({ id: 'W4', want: 'The office lobby', frame_ns: [3] }), asset_id: 'V11' },
  ];
  const requests = wishCutoutRequests(plan, found, inventory);
  assert.deepEqual(requests, [
    { name: 'A real wooden dinner table', source_id: 'V9', anchor: false, frames: [1, 2], person: false, shows: 'A real wooden dinner table, seen from above', wish: 'W1' },
  ], 'a page is never cut out; a place wish without cut_out keeps its photo');
  assert.equal(thingName('Plates (white china) on a table'), 'Plates');
});

test('makeCutouts: a thing becomes an object cutout in the inventory (shows, credit, source, no people); swaps its frames', async () => {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-i7-cut-'));
  await jpeg(path.join(jobDir, 'media', 'V9.jpg'));
  const inventory = inv([asset('V9', { file: 'media/V9.jpg', flags: ['wish:W1', 'identity:verified'] })]);
  let faced = 0;
  const req = { name: 'A real wooden dinner table', source_id: 'V9', anchor: true, frames: [1, 2], person: false, shows: 'A real wooden dinner table, seen from above.', wish: 'W1' };
  const out = await makeCutouts({ cutout: fakeCut(), detectFaces: async (files) => { faced++; return new Map(files.map((f) => [f, []])); } }, { inventory, requests: [req], jobDir, jobId: null });
  assert.deepEqual(out.problems, []);
  const cut = out.assets[0]!;
  assert.equal(cut.id, 'V10');
  assert.equal(cut.kind, 'object');
  assert.equal(cut.file, 'media/V10.png');
  assert.equal((await sharp(path.join(jobDir, cut.file)).metadata()).hasAlpha, true, 'a transparent PNG');
  assert.deepEqual(cut.people, []);
  assert.equal(cut.character_image, false, 'a thing is never anyone\'s character image');
  assert.equal(cut.anchor_for, null);
  assert.equal(cut.face, null);
  assert.equal(faced, 0, 'no face detection for a thing');
  assert.equal(cut.upscaled, false);
  assert.equal(cut.credit, 'Photo V9, CC BY 2.0');
  assert.equal(cut.source_page, 'https://example.com/page-V9');
  assert.match(cut.shows, /^A real-photo cutout of A real wooden dinner table, seen from above: cut out of V9/);
  for (const f of ['cutout', 'cutout_made', 'cutout_thing', 'cutout_of:V9', 'cutout_wish', 'cutout_wish:W1', 'wish:W1']) assert.ok(cut.flags.includes(f), f);
  assert.ok(!cut.flags.includes('identity:verified'), 'a person identity never rides on a thing');

  const plan: DirectorPlan = { frames: [frame(1, 'tableau', ['V9']), frame(2, 'collage', ['V9']), frame(3, 'photo', ['V2'])], lines_back: [] };
  const next = useCutouts(plan, cutoutSwaps([req], out.assets));
  assert.deepEqual(next.frames.map((f) => f.asset_ids), [['V10'], ['V10'], ['V2']]);
  assert.equal(next.frames[0]!.motion, 'push on V10');
});

test('makeCutouts fails open: a failed or empty cut leaves the found photo in its frames', async () => {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-i7-fail-'));
  await jpeg(path.join(jobDir, 'media', 'V9.jpg'));
  const inventory = inv([asset('V9', { file: 'media/V9.jpg' })]);
  const req = { name: 'A brass lamp', source_id: 'V9', anchor: false, frames: [1], person: false, shows: 'A brass lamp', wish: 'W2' };
  const plan: DirectorPlan = { frames: [frame(1, 'tableau', ['V9'])], lines_back: [] };

  const failed = await makeCutouts({ cutout: async () => ({ ok: false, error: 'rembg failed: boom' }) }, { inventory, requests: [req], jobDir, jobId: null });
  assert.equal(failed.assets.length, 0);
  assert.match(failed.problems[0]!, /A brass lamp: the cutout of V9 failed \(rembg failed: boom\)/);
  assert.deepEqual(useCutouts(plan, cutoutSwaps([req], failed.assets)).frames[0]!.asset_ids, ['V9']);

  const whole = await makeCutouts({ cutout: fakeCut(0.99) }, { inventory, requests: [req], jobDir, jobId: null });
  assert.equal(whole.assets.length, 0);
  assert.match(whole.problems[0]!, /kept 99% of the picture \(no background was found\), so V9 stays a photo/);

  const none = await makeCutouts({ cutout: null }, { inventory, requests: [req], jobDir, jobId: null });
  assert.match(none.problems[0]!, /no background remover/);
  assert.ok(!fs.readdirSync(path.join(jobDir, 'media')).some((f) => f.startsWith('tmp-cutout')));
});

// ── 2. Date labels (MD-130) ─────────────────────────────────────────────────

test('lines.json and ctx.timing.lines carry label_kind; a dropped label has none (MD-126 kept)', () => {
  const lines = new Map<string, Record<string, unknown>>([
    ['L1', { id: 'L1', text: 'It was the winter he bet the company.', on_screen: 'December 2015', on_screen_kind: 'date' }],
    ['L2', { id: 'L2', text: 'Five people at one table.', on_screen: 'Menlo Park', on_screen_kind: null }],
    ['L3', { id: 'L3', text: 'Then the money came.', on_screen: 'March 2016' }],
    ['L4', { id: 'L4', text: 'And it was gone.', on_screen: 'June 2017', on_screen_kind: 'date' }],
  ]);
  const out = frameLines({ treatment: 'photo', line_ids: ['L1', 'L2', 'L3', 'L4'], drop_labels: ['L4'] }, lines);
  assert.deepEqual(out.map((l: { label: string | null; label_kind: string | null }) => [l.label, l.label_kind]), [
    ['December 2015', 'date'],
    ['Menlo Park', null],
    ['March 2016', 'date'], // written before the writer marked dates: a label that is only a date counts
    [null, null],
  ]);
  assert.equal(labelKind({ on_screen_kind: null }, '2015'), null, 'the writer said it is not a date');
  assert.ok(isDateLabel('Dec. 11, 2015') && isDateLabel('late 2015') && !isDateLabel('OpenAI, 2015'));

  const words = Array.from({ length: 6 }, (_, i) => ({ text: `w${i}`, start: i, end: i + 0.5 }));
  assert.deepEqual(lineSpans([{ id: 'L1', words: 3, label: 'December 2015', label_kind: 'date' }, { id: 'L2', words: 3, label: null, label_kind: 'date' }], words), [
    { id: 'L1', start: 0, end: 2.5, label: 'December 2015', label_kind: 'date' },
    { id: 'L2', start: 3, end: 5.5, label: null, label_kind: null },
  ]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-i7-lines-'));
  const draft = { rungs: [{ id: 'R1', purpose: 'p', lines: [...lines.values()] }], close_question: 'Would you have taken it?' };
  const plan = { frames: [frame(1, 'photo', [], { line_ids: ['L1', 'L2'] }), frame(2, 'photo', [], { line_ids: ['L3', 'L4'], drop_labels: ['L4'] })], lines_back: [] };
  writeProjectFiles(dir, { draft, plan, inventory: inv([]) });
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'assets', 'lines.json'), 'utf8'));
  assert.deepEqual(file['01-f1'].map((l: { label_kind: string | null }) => l.label_kind), ['date', null]);
  assert.deepEqual(file['02-f2'].map((l: { label: string | null; label_kind: string | null }) => [l.label, l.label_kind]), [['March 2016', 'date'], [null, null]]);
});

function dom() {
  const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="w"></div></body></html>');
  nk.installKit(window.document, { fonts: 'assets/fonts/' });
  return window.document as unknown as Document;
}

test('a date label is set more prominently than other labels: Pragmatica Extended under an orange rule', () => {
  const doc = dom();
  const date = nk.label(doc, { text: 'December 11, 2015', kind: 'date', at: 0.2 });
  const plain = nk.label(doc, { text: 'Menlo Park', at: 0.2 });
  assert.equal(date.el.getAttribute('data-label-kind'), 'date');
  assert.ok(date.el.classList.contains('rd-date'));
  assert.ok(date.el.querySelector('.rd-date-bar'), 'the orange rule');
  const big = date.el.querySelector('.rd-date-t') as HTMLElement;
  assert.equal(big.textContent, 'December 11, 2015');
  assert.ok(Number.parseInt(big.style.fontSize, 10) >= 44);
  assert.equal(plain.el.getAttribute('data-label-kind'), 'label');
  assert.ok(plain.el.querySelector('.rd-tag-t') && !plain.el.querySelector('.rd-date-t'));
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  assert.match(css, /\.rd-date-t\{font:700 60px[^}]*'Pragmatica Extended'/);
  assert.match(css, /\.rd-date-bar\{[^}]*var\(--rd-orange\)/);
  assert.match(css, /\.rd-tag-t\{font:500 36px[^}]*Roboto/);
  assert.ok(nk.dateSize('December 11, 2015') === 60 && nk.dateSize('September 11–12, 2015') < 60 && nk.dateSize('x'.repeat(80)) === 44, 'smaller only when long');
  // Same keep-outs as any label: wiped in with its plate, hidden before `at`, and placed by keepClear.
  date.render(0);
  assert.equal(date.el.style.visibility, 'hidden');
  date.render(1);
  assert.equal(date.el.style.visibility, '');
  assert.equal(date.el.getAttribute('data-plate'), 'dark');
  // From a timing line: its words, kind and start.
  const fromLine = nk.lineLabel(doc, { id: 'L1', start: 1.4, end: 3, label: '2015', label_kind: 'date' });
  assert.equal(fromLine?.el.getAttribute('data-label-kind'), 'date');
  fromLine!.render(1.3);
  assert.equal(fromLine!.el.style.visibility, 'hidden', 'lands as its line starts');
  assert.equal(nk.lineLabel(doc, { id: 'L2', start: 0, end: 1, label: null, label_kind: null }), null);
});

// ── 3. Real-cutout scenes (MD-127) ───────────────────────────────────────────

const CUT = (id: string, extra: Record<string, unknown> = {}) => ({ id, file: `assets/media/${id}.png`, width: 800, height: 600, people: [], made: false, flags: ['cutout', 'cutout_thing'], ...extra });

test('tableau: real cutouts of things (props) and people on a real place photo or a plain ground, paper-edged, deterministic', () => {
  const doc = dom();
  const host = doc.getElementById('w')!;
  const person = CUT('V3', { people: ['Ada Lane'], character_image: true, width: 600, height: 1200, face: { x: 0.35, y: 0.1, w: 0.3, h: 0.15 } });
  const tb = nk.tableau(doc, {
    setting: { id: 'V2', file: 'assets/media/V2.jpg', width: 2000, height: 1334, made: false },
    seats: [{ id: 'a', x: 360, y: 1250, h: 640 }, { id: 'b', x: 720, y: 1250, h: 620 }],
    cast: [{ media: person, seat: 'a' }],
    props: [{ media: CUT('V10'), x: 540, y: 1420, w: 900 }, { media: CUT('V12', { width: 300, height: 700 }), x: 860, y: 700, h: 380, front: false, shadow: false, at: 1 }],
    duration: 6,
  });
  host.append(tb.el);
  assert.equal(tb.edge, 'paper');
  assert.equal(tb.props.length, 2);
  const [table, lamp] = tb.props.map((p: { el: HTMLElement }) => p.el);
  assert.equal(table.getAttribute('data-cut'), 'paper');
  assert.match(table.style.filter, /drop-shadow\(0 0 1px #F4EFE4\)/, 'a visible cut edge');
  assert.equal(tb.figures[0].el.getAttribute('data-cut'), 'paper');
  const order = [...tb.cam.children];
  const at = (el: HTMLElement) => order.indexOf(el.parentElement as Element);
  const fig = order.indexOf(tb.figures[0].box);
  assert.ok(at(lamp) < fig && fig < at(table), 'a back prop sits behind the cast, a front prop (the table) in front');
  tb.render(0);
  assert.equal(lamp.parentElement!.style.visibility, 'hidden', 'slapped on at its `at`, hidden before');
  const snap = (t: number) => { tb.render(t); return host.innerHTML; };
  for (const t of [0, 1.2, 3]) { const a = snap(t); snap(6); snap(0.1); assert.equal(snap(t), a, `render(${t}) is pure`); }

  // No setting: a plain ground, never an empty picture.
  const bare = nk.tableau(doc, { cast: [{ media: person }], props: [{ media: CUT('V10'), x: 540, y: 1400, w: 700 }], duration: 6 });
  assert.ok(!bare.el.querySelector('img.rd-cover'), 'no empty setting picture');
  assert.ok(bare.el.querySelector('[data-set][data-bleed]'), 'a plain ground');
  // A seeded (drawn) setting keeps the drawn look: no paper edge.
  assert.equal(nk.tableau(doc, { setting: 'dinner-table', cast: [], duration: 6 }).edge, 'none');
});

test('collage: a real cutout casts its shadow from its outline with a paper edge, is never torn, and its dots stay inside it', () => {
  const doc = dom();
  const c = nk.collage(doc, {
    ground: 'charcoal',
    style: 'torn-halftone',
    layers: [
      { media: CUT('V10'), x: 80, y: 900, w: 900 },
      { media: CUT('V3', { people: ['Ada Lane'], character_image: true, regions: { faces: [{ x: 0.3, y: 0.1, w: 0.3, h: 0.2 }] } }), x: 300, y: 620, w: 480, halftone: true },
      { media: { id: 'V2', file: 'assets/media/V2.jpg', width: 1200, height: 800, made: false, flags: [] }, x: 100, y: 1200, w: 500, torn: true },
    ],
    duration: 6,
  });
  const [table, person, photo] = c.items.map((i: { el: HTMLElement }) => i.el);
  assert.equal(table.getAttribute('data-cut'), 'paper');
  assert.match(table.style.filter, /#F4EFE4/);
  assert.equal(table.style.boxShadow, '', 'no rectangular shadow round a cutout');
  assert.equal(person.style.clipPath, '', 'a cutout is never torn');
  const dots = [...person.querySelectorAll('div')].find((d) => /radial-gradient/.test(d.getAttribute('style') ?? '')) as HTMLElement & { style: { maskImage?: string } };
  assert.ok(dots, 'halftone dots on the cutout');
  assert.equal(dots.style.maskImage, 'url("assets/media/V3.png")', 'masked to the cutout\'s outline');
  assert.notEqual(photo.style.clipPath, '', 'a whole photo can still be torn');
  assert.notEqual(photo.style.boxShadow, '', 'a photo casts a paper shadow');
});

test('cutout_lift: a thing (no face, nobody) is centred on the subject line', () => {
  const doc = dom();
  const lamp = CUT('V12', { width: 400, height: 800 });
  const r = nk.cutoutLift(doc, { cutout: lamp.file, media: lamp, backdrop: 'b.jpg', duration: 6 });
  const fig = r.figure as HTMLElement;
  assert.equal(fig.style.height, '900px');
  const bottom = Number.parseFloat(fig.style.bottom);
  assert.equal(1920 - bottom - 900 / 2, nk.SUBJECT.cy, 'its middle on the subject line');
});
