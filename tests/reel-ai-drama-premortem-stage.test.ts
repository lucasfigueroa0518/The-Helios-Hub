// The pre-mortem's property tests: blueprints nothing in the two replays looked like, driven through the real compiled frame and
// stage under JSDOM. Offline. Whatever a plan says, a frame builds, stays finite, renders as a pure function of t, and comes out
// the same every build.
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { compiledFrame } from '../explainers/reel-ai-drama/kit/components/compiled.js';
import * as nk from '../explainers/reel-ai-drama/kit/components/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const dom = () => { const win = new JSDOM('<!doctype html><html><body><div id="w" data-opening-not></div></body></html>').window as Any; (nk as Any).installKit(win.document, { fonts: 'f/', textures: 't/' }); return win.document; };
const WORDS = 'the board met in secret and voted to remove its chief executive after weeks of quiet argument between the founders and nobody told the staff until morning came'.split(' ').map((text, i) => ({ text, start: 0.35 * i, end: 0.35 * i + 0.3 }));
const rec = (id: string, o: Any = {}) => ({ id, kind: 'person_photo', file: `assets/media/${id}.jpg`, src: `assets/media/${id}.jpg`, width: 1000, height: 1400, people: [], flags: [], ...o });
const person = (id: string, name: string, o: Any = {}) => rec(id, { people: [name], flags: ['cutout', 'transparent'], regions: { faces: [{ x: 0.35, y: 0.12, w: 0.3, h: 0.22, trusted: true, score: 0.95, name }], visible: { x: 0.1, y: 0.05, w: 0.8, h: 0.95 }, cut: { grade: 'clean' }, open_edges: { left: false, right: false, top: false, bottom: true }, sharp_width_px: 1200, brightness: 0.4 }, ...o });
const logo = (id: string, w = 800, h = 300) => rec(id, { kind: 'logo', width: w, height: h, flags: ['logo'], regions: { visible: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, faces: [] } });
const doc_ = (id: string, w = 1080, h = 1800) => rec(id, { kind: 'document', width: w, height: h, regions: { words: [{ text: 'quiet', box: { x: 0.1, y: 0.2, w: 0.2, h: 0.02 } }, { text: 'argument', box: { x: 0.32, y: 0.2, w: 0.2, h: 0.02 } }], faces: [], visible: { x: 0, y: 0, w: 1, h: 1 } } });
const photo = (id: string, w: number, h: number, o: Any = {}) => rec(id, { kind: 'event_photo', width: w, height: h, ...o });
const LONG = 'Alexandria Ocasio-Cortez-Featherstonehaugh de la Vega Montgomery III';
const QUOTE = 'We never agreed to any of this and if you think for one second that the board would let you walk out of here with the whole company and every single one of its researchers then you have not been paying attention to anything that anyone has been saying for the last three years';
const T = (o: Any) => ({ ground: 'charcoal', style: 'cutouts', arrangement: 'solo', labels: [], speech: [], marks: [], arrows: [], camera: { move: 'hold', stops: [{ on: '', aim: 'whole' }] }, sounds: [], ...o });
const media: Record<string, Any> = {};
for (const r of [
  ...[1,2,3,4,5,6].map((i) => person(`P${i}`, `Person ${i}`)),
  logo('L1'), logo('L2', 200, 200), logo('L3', 2000, 100), logo('L4', 100, 2000),
  doc_('D1'), doc_('D2', 3000, 500), doc_('D3', 500, 5000),
  photo('W', 6000, 600), photo('TT', 400, 6000), photo('TINY', 40, 30), photo('NOREG', 1200, 800),
  photo('EMPTYREG', 1200, 800, { regions: {} }),
  photo('NOFACE', 1200, 800, { regions: { faces: [], visible: { x: 0, y: 0, w: 1, h: 1 } } }),
  photo('UNTRUST', 1200, 800, { people: ['X Y'], regions: { faces: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, trusted: false, score: 0.4 }] } }),
  photo('BW', 1200, 800, { regions: { tone: { w: 1, h: 1, cells: [8] }, chroma: 0, brightness: 0.5, mono: true } }),
  photo('DARK', 1200, 800, { regions: { tone: { w: 1, h: 1, cells: [0] }, brightness: 0.01 } }),
  photo('BRIGHT', 1200, 800, { regions: { tone: { w: 1, h: 1, cells: [15] }, brightness: 0.99 } }),
  photo('ZERO', 0, 0),
  rec('REJ', { people: ['R J'], flags: ['cutout', 'cutout_of:NOREG'], regions: { cut: { grade: 'rejected' } } }),
  rec('MADE', { kind: 'person_photo', made: true, made_kind: 'drawing', width: 1024, height: 1024, people: ['D R'], flags: ['transparent'] }),
  rec('SET', { kind: 'place_photo', made: true, made_kind: 'setting', width: 1024, height: 1536 }),
  rec('MAP', { kind: 'map', width: 1000, height: 800, map: { pins: [] } }),
]) media[r.id] = r;
const cases: Record<string, Any> = {
  no_people: T({ pieces: [{ id: 'a', asset: 'NOFACE', on: '' }, { id: 'b', asset: 'D1', treatment: 'document', on: 'secret' }] }),
  one: T({ pieces: [{ id: 'a', asset: 'P1', label: 'Person 1', on: '' }] }),
  six: T({ arrangement: 'row', pieces: [1,2,3,4,5,6].map((i) => ({ id: `p${i}`, asset: `P${i}`, label: `Person ${i}`, on: i === 1 ? '' : 'secret' })) }),
  six_sequential: T({ arrangement: 'pile', pieces: [1,2,3,4,5,6].map((i, k) => ({ id: `p${i}`, asset: `P${i}`, on: WORDS[k*3].text, until: WORDS[k*3+2].text })) }),
  only_logos: T({ pieces: ['L1','L2','L3','L4'].map((a, i) => ({ id: a, asset: a, on: i ? 'secret' : '' })) }),
  only_docs: T({ pieces: [{ id: 'a', asset: 'D1', treatment: 'page', on: '' }, { id: 'b', asset: 'D2', treatment: 'document', on: 'voted' }, { id: 'c', asset: 'D3', treatment: 'post', on: 'remove' }] }),
  wide_fill: T({ pieces: [{ id: 'a', asset: 'W', fill: true, on: '' }] }),
  tall_fill: T({ pieces: [{ id: 'a', asset: 'TT', fill: true, on: '' }] }),
  wide_plain: T({ pieces: [{ id: 'a', asset: 'W', on: '' }] }),
  tall_plain: T({ pieces: [{ id: 'a', asset: 'TT', on: '' }] }),
  tiny: T({ pieces: [{ id: 'a', asset: 'TINY', on: '' }] }),
  tiny_fill: T({ pieces: [{ id: 'a', asset: 'TINY', fill: true, on: '' }] }),
  zero_size: T({ pieces: [{ id: 'a', asset: 'ZERO', on: '' }] }),
  noreg: T({ pieces: [{ id: 'a', asset: 'NOREG', on: '' }, { id: 'b', asset: 'EMPTYREG', on: 'met' }] }),
  untrusted: T({ pieces: [{ id: 'a', asset: 'UNTRUST', on: '' }], marks: [{ kind: 'worry', on_piece: 'a', on: 'met' }, { kind: 'circle', on_piece: 'a', target: 'face:X Y', on: 'voted' }], camera: { move: 'tour', stops: [{ on: '', aim: 'whole' }, { on: 'voted', aim: 'face:X Y' }] } }),
  mono_dark_bright: T({ pieces: [{ id: 'a', asset: 'BW', on: '' }, { id: 'b', asset: 'DARK', on: 'met' }, { id: 'c', asset: 'BRIGHT', on: 'voted' }] }),
  dark_ground: T({ ground: 'DARK', pieces: [{ id: 'a', asset: 'P1', on: '' }] }),
  bright_ground: T({ ground: 'BRIGHT', pieces: [{ id: 'a', asset: 'P1', on: '' }] }),
  long_names: T({ pieces: [{ id: 'a', asset: 'P1', label: LONG, on: '' }, { id: 'b', asset: 'P2', label: LONG + ' Junior', on: 'met' }], labels: [{ text: LONG, sub: QUOTE, on: 'voted' }] }),
  long_quote: T({ arrangement: 'face_off', pieces: [{ id: 'a', asset: 'P1', on: '' }, { id: 'b', asset: 'P2', on: '' }], speech: [{ on_piece: 'a', text: QUOTE, on: 'met' }, { on_piece: 'b', text: QUOTE, on: 'voted', until: 'chief' }] }),
  hook_long: T({ hook: { text: QUOTE, on: '' }, pieces: [{ id: 'a', asset: 'P1', on: '' }] }),
  empty_pieces: T({ pieces: [] }),
  missing_all: { pieces: [{ id: 'a', asset: 'P1', on: '' }] },
  no_camera: { ground: 'kraft', style: 'paper', pieces: [{ id: 'a', asset: 'P1' }] },
  unknown_refs: T({ pieces: [{ id: 'a', asset: 'P1', on: '', belongs: 'zz', onto: { piece: 'qq', box: 'nope' } }], labels: [{ text: 'x', for: 'zz', on: '' }], marks: [{ kind: 'circle', on_piece: 'zz', on: '' }, { kind: 'nonsense', on_piece: 'a', on: '' }, { kind: 'arrow', on_piece: 'a', on: '' }], arrows: [{ from: 'a', to: 'a', on: '' }, { from: 'zz', to: 'a', on: '' }], speech: [{ on_piece: 'zz', text: 'hi', on: '' }], camera: { move: 'tour', stops: [{ on: '', aim: 'zz' }, { on: 'voted', aim: 'text:nope' }, { on: 'chief', aim: 'face:Nobody' }] } }),
  unknown_asset: T({ pieces: [{ id: 'a', asset: 'NOPE', on: '' }] }),
  dup_ids: T({ pieces: [{ id: 'a', asset: 'P1', on: '' }, { id: 'a', asset: 'P2', on: 'met' }] }),
  same_asset_twice: T({ pieces: [{ id: 'a', asset: 'P1', on: '' }, { id: 'b', asset: 'P1', on: 'met' }] }),
  until_before_on: T({ pieces: [{ id: 'a', asset: 'P1', on: 'voted', until: 'board' }] }),
  undefined_words: T({ pieces: [{ id: 'a', asset: 'P1' }], labels: [{ text: 'lbl' }], marks: [{ kind: 'circle', on_piece: 'a' }], arrows: [], speech: [{ on_piece: 'a', text: 'hi' }] }),
  null_fields: T({ pieces: [{ id: 'a', asset: 'P1', on: null, until: null, side: null, role: null, belongs: null, onto: null, crop: null, label: null, note: null, treatment: null, opts: null, fill: null, note_role: null }], labels: null, marks: null, speech: null, arrows: null, sounds: null, hook: null, ground_tone: null, peak: null, camera: null }),
  bad_crop: T({ pieces: [{ id: 'a', asset: 'NOREG', crop: { x: 0.9, y: 0.9, w: 0.9, h: 0.9 }, on: '' }, { id: 'b', asset: 'BW', crop: { x: 0, y: 0, w: 0, h: 0 }, on: 'met' }] }),
  note_on_charcoal: T({ pieces: [{ id: 'a', note: QUOTE, note_role: 'body', on: '' }, { id: 'b', note: '$5', note_role: 'figure', on: 'met' }] }),
  whiteboard: T({ ground: 'whiteboard', arrangement: 'leads_to', pieces: [{ id: 'a', asset: 'MADE', on: '' }, { id: 'b', note: LONG, note_role: 'place', on: 'met' }, { id: 'c', asset: 'L1', on: 'voted' }, { id: 'd', note: 'x', note_role: 'date', on: 'chief' }], arrows: [{ from: 'a', to: 'b', on: 'voted' }, { from: 'b', to: 'c', on: 'chief' }] }),
  whiteboard_real_photo: T({ ground: 'whiteboard', pieces: [{ id: 'a', asset: 'P1', on: '' }, { id: 'b', asset: 'NOREG', on: 'met' }] }),
  whiteboard_empty_board_note_only: T({ ground: 'whiteboard', pieces: [{ id: 'a', note: 'x', on: '' }] }),
  map_no_opts: T({ pieces: [{ id: 'a', treatment: 'map', on: '' }] }),
  map_asset: T({ pieces: [{ id: 'a', asset: 'MAP', treatment: 'map', on: '' }] }),
  stat_no_opts: T({ pieces: [{ id: 'a', treatment: 'stat', on: '' }] }),
  stat_counter: T({ pieces: [{ id: 'a', treatment: 'stat', opts: { kind: 'counter', value: '$44 billion' }, on: '' }] }),
  stat_bars: T({ pieces: [{ id: 'a', treatment: 'stat', opts: { kind: 'bars', bars: [] }, on: '' }] }),
  stat_bad_kind: T({ pieces: [{ id: 'a', treatment: 'stat', opts: { kind: 'nonsense' }, on: '' }] }),
  number_no_opts: T({ pieces: [{ id: 'a', treatment: 'number', on: '' }] }),
  board_no_opts: T({ pieces: [{ id: 'a', treatment: 'board', on: '' }] }),
  newspaper_no_opts: T({ pieces: [{ id: 'a', treatment: 'newspaper', on: '' }] }),
  headline_no_asset: T({ pieces: [{ id: 'a', treatment: 'headline', on: '' }] }),
  page_no_asset: T({ pieces: [{ id: 'a', treatment: 'page', on: '' }] }),
  post_no_asset: T({ pieces: [{ id: 'a', treatment: 'post', on: '' }] }),
  document_no_asset: T({ pieces: [{ id: 'a', treatment: 'document', on: '' }] }),
  lift_no_opts: T({ pieces: [{ id: 'a', asset: 'NOREG', treatment: 'lift', on: '' }] }),
  lift_no_asset: T({ pieces: [{ id: 'a', treatment: 'lift', on: '' }] }),
  lower_third_no_opts: T({ pieces: [{ id: 'a', treatment: 'lower_third', on: '' }] }),
  lower_third_asset: T({ pieces: [{ id: 'a', asset: 'P1', treatment: 'lower_third', opts: { name: LONG, role: QUOTE }, on: '' }] }),
  photo_treat: T({ pieces: [{ id: 'a', asset: 'NOREG', treatment: 'photo', on: '' }] }),
  photo_no_asset: T({ pieces: [{ id: 'a', treatment: 'photo', on: '' }] }),
  rejected: T({ pieces: [{ id: 'a', asset: 'REJ', on: '' }] }),
  ground_tone: T({ ground_tone: [{ on: 'voted', to: 0.1 }, { on: 'chief', to: 1.5 }, { on: 'nope', to: -3 }], pieces: [{ id: 'a', asset: 'P1', on: '' }] }),
  peak_slide: T({ peak: true, camera: { move: 'slide', stops: [{ on: '', aim: 'whole' }] }, pieces: [{ id: 'a', asset: 'P1', on: '' }, { id: 'b', asset: 'P2', on: 'met' }] }),
  zoom_extreme: T({ camera: { move: 'push', stops: [{ on: '', aim: 'a', zoom: 50 }, { on: 'voted', aim: 'a', zoom: 0 }, { on: 'chief', aim: 'a', zoom: -3 }] }, pieces: [{ id: 'a', asset: 'P1', on: '' }] }),
};
const MOVES = ['hold', 'push', 'drift', 'slide', 'tour'];
const ARRANGEMENTS = ['face_off', 'lead_inset', 'row', 'pile', 'facing', 'turned_away', 'leads_to', 'solo'];
const TREATMENTS = ['page', 'post', 'document', 'headline', 'newspaper', 'map', 'photo', 'number', 'stat', 'board', 'lift', 'lower_third'];
const DURATIONS = [0.4, 1.1, 6, 28];

/** Everything that can go wrong with one blueprint at one length. */
function brokenBy(tag: string, bp: Any, dur: number): string[] {
  const bad: string[] = [];
  const words = WORDS.filter((w) => w.start < dur);
  const opened: Any[] = [];
  const build = () => {
    const doc = dom();
    opened.push(doc.defaultView);
    const root = doc.createElement('div');
    doc.body.append(root);
    const fr = compiledFrame({ treatment: 'collision', blueprint: bp, known_names: [] });
    fr.build(root, { id: 'x', duration: dur, media, timing: { words, lines: [{ id: 'L1', start: 0, end: dur, label: null }] }, nk });
    return { doc, root, fr };
  };
  try {
    const a = build();
    const rec = (a.doc as Any).__compiled.x;
    const fatal = (rec.reports as string[]).filter((r) => /stage_failed|plain_failed/.test(r));
    if (fatal.length) bad.push(`${tag}: ${fatal.join('; ').slice(0, 200)}`);
    const fails = (((a.doc as Any).__stageNotes ?? []) as string[]).filter((n) => /treatment_failed|custom_failed/.test(n));
    if (fails.length) bad.push(`${tag}: ${fails.join('; ').slice(0, 200)}`);
    for (const p of rec.manifest.pieces) {
      for (const k of ['x', 'y', 'w', 'h']) if (!Number.isFinite(p.box_at_rest?.[k])) bad.push(`${tag}: piece ${p.id} has ${k} ${p.box_at_rest?.[k]}`);
      if (p.box_at_rest && (p.box_at_rest.w <= 0 || p.box_at_rest.h <= 0)) bad.push(`${tag}: piece ${p.id} has no size`);
    }
    // The same check the kit's browser pass makes: what a moment draws never depends on what was drawn before.
    for (const t of [0, dur * 0.5, Math.max(0, dur - 0.2)]) {
      a.fr.render(t);
      const first = (nk as Any).canonicalDom(a.root);
      if (/NaN|Infinity/.test(first)) bad.push(`${tag}: NaN in the DOM at ${t}`);
      a.fr.render(dur);
      a.fr.render(0.05);
      a.fr.render(t);
      if ((nk as Any).canonicalDom(a.root) !== first) bad.push(`${tag}: render(${t}) depends on what was drawn before`);
    }
    const b = build();
    if (JSON.stringify((b.doc as Any).__compiled.x.manifest) !== JSON.stringify(rec.manifest)) bad.push(`${tag}: the manifest differs across builds`);
  } catch (e) {
    bad.push(`${tag}: threw ${String((e as Any)?.stack ?? e).split('\n').slice(0, 3).join(' | ').slice(0, 280)}`);
  }
  for (const win of opened) win.close();
  return bad;
}

for (const dur of DURATIONS) {
  test(`every named extreme builds, stays finite and renders purely at ${dur}s`, () => {
    const bad: string[] = [];
    for (const [name, bp] of Object.entries(cases)) bad.push(...brokenBy(name, bp, dur));
    assert.deepEqual(bad, []);
  });
}

test('six people: every arrangement under every camera move', () => {
  const bad: string[] = [];
  for (const arrangement of ARRANGEMENTS) for (const move of MOVES) {
    bad.push(...brokenBy(`six/${arrangement}/${move}`, { ...cases.six, arrangement, camera: { ...cases.six.camera, move } }, 6));
  }
  assert.deepEqual(bad, []);
});

test('heads stay in the frame and apart, for one to six people, in every arrangement', () => {
  const bad: string[] = [];
  for (let count = 1; count <= 6; count++) for (const arrangement of ARRANGEMENTS) {
    const doc = dom();
    const root = doc.createElement('div');
    doc.body.append(root);
    const pieces = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, asset: `P${i + 1}`, on: '' }));
    compiledFrame({ treatment: 'collision', blueprint: T({ arrangement, pieces }), known_names: [] }).build(root, { id: 'x', duration: 6, media, timing: { words: WORDS, lines: [{ id: 'L1', start: 0, end: 6, label: null }] }, nk });
    const heads = (doc as Any).__compiled.x.manifest.pieces.map((p: Any) => {
      const f = media[p.asset].regions.faces[0];
      const b = p.box_at_rest;
      return { id: p.id, x: b.x + f.x * b.w, y: b.y + f.y * b.h, w: f.w * b.w, h: f.h * b.h };
    });
    for (const h of heads) if (h.x < -1 || h.y < -1 || h.x + h.w > 1081 || h.y + h.h > 1921) bad.push(`${count}/${arrangement}: head of ${h.id} leaves the frame: ${JSON.stringify(h)}`);
    if (arrangement !== 'pile') for (const a of heads) for (const b of heads) {
      // A face box runs wider than a face: a touch of box isn't a covered face.
      const overW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), overH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (a.id < b.id && overW > 0.1 * Math.min(a.w, b.w) && overH > 0.1 * Math.min(a.h, b.h)) bad.push(`${count}/${arrangement}: heads ${a.id} and ${b.id} overlap by ${Math.round(overW)}px`);
    }
    doc.defaultView!.close();
  }
  assert.deepEqual(bad, []);
});

test('every treatment, with and without its picture and options, on both grounds', () => {
  const bad: string[] = [];
  for (const treatment of TREATMENTS) for (const asset of [undefined, 'NOREG', 'P1', 'D1', 'L1', 'NOPE']) for (const opts of [undefined, { kind: 'nonsense', value: null }]) for (const ground of ['charcoal', 'whiteboard']) {
    bad.push(...brokenBy(`${treatment}/${asset}/${JSON.stringify(opts)}/${ground}`, T({ ground, pieces: [{ id: 'a', treatment, ...(asset ? { asset } : {}), ...(opts ? { opts } : {}), on: '' }] }), 6));
  }
  assert.deepEqual(bad, []);
});

// Seeded casts drawn across the pictures above, including leavers whose word comes before their entrance.
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
function randomBlueprint(seed: number): Any {
  const r = rng(seed);
  const pick = <V>(list: readonly V[]): V => list[Math.floor(r() * list.length)];
  const ids = Object.keys(media);
  const word = () => (r() < 0.3 ? '' : r() < 0.1 ? 'never said aloud' : pick(WORDS).text);
  const pieces = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, i) => ({
    id: `p${i}`,
    ...(r() < 0.9 ? { asset: pick(ids) } : { note: pick(['$5', LONG, QUOTE]), note_role: pick(['figure', 'place', 'date', 'body']) }),
    on: word(),
    ...(r() < 0.2 ? { until: word() || 'board' } : {}),
    ...(r() < 0.25 ? { treatment: pick(TREATMENTS) } : {}),
    ...(r() < 0.15 ? { fill: true } : {}),
    ...(r() < 0.2 ? { label: pick(['Name', LONG]) } : {}),
    ...(r() < 0.1 ? { role: 'lead' } : {}),
    ...(r() < 0.1 ? { side: pick(['left', 'right']) } : {}),
    ...(r() < 0.1 ? { crop: { x: r(), y: r(), w: r(), h: r() } } : {}),
  }));
  const anyPiece = () => pick(pieces).id;
  return {
    ground: pick(['charcoal', 'kraft', 'whiteboard', 'DARK', 'BRIGHT', 'NOREG']),
    style: pick(['cutouts', 'paper']),
    arrangement: pick(ARRANGEMENTS),
    pieces,
    labels: r() < 0.4 ? [{ text: pick(['Short', LONG, QUOTE]), on: word(), ...(r() < 0.5 ? { for: anyPiece() } : {}) }] : [],
    speech: r() < 0.3 ? [{ on_piece: anyPiece(), text: pick(['Yes.', QUOTE]), on: word(), ...(r() < 0.5 ? { until: word() } : {}) }] : [],
    marks: r() < 0.4 ? [{ kind: pick(['circle', 'underline', 'highlight', 'box', 'cross', 'arrow', 'worry']), on_piece: anyPiece(), on: word(), ...(r() < 0.5 ? { target: pick(['text:quiet argument', 'face:Person 1', 'text:not on the page']) } : {}) }] : [],
    arrows: r() < 0.25 ? [{ from: anyPiece(), to: anyPiece(), on: word() }] : [],
    camera: { move: pick(MOVES), stops: r() < 0.5 ? [] : [{ on: word(), aim: pick([anyPiece(), 'whole', 'nope']), ...(r() < 0.3 ? { zoom: pick([0, 0.5, 2, 50, -3]) } : {}) }] },
    sounds: [],
    ...(r() < 0.15 ? { hook: { text: pick(['HOOK', QUOTE]), on: '' } } : {}),
    ...(r() < 0.15 ? { peak: true } : {}),
    ...(r() < 0.15 ? { ground_tone: [{ on: word(), to: pick([0.1, 1.5, -3]) }] } : {}),
  };
}

test('seeded random casts of extreme pictures: no crash, no broken frame, no dependence on what was drawn before', () => {
  const bad: string[] = [];
  for (let seed = 1; seed <= 400; seed++) bad.push(...brokenBy(`seed ${seed}`, randomBlueprint(seed), DURATIONS[seed % DURATIONS.length]));
  assert.deepEqual(bad.slice(0, 12), []);
});

test('a treatment with nothing to draw never leaves an empty space: it shows its picture or goes, reported', () => {
  const run = (piece: Any) => {
    const doc = dom();
    const root = doc.createElement('div');
    doc.body.append(root);
    compiledFrame({ treatment: 'collision', blueprint: T({ pieces: [piece] }), known_names: [] }).build(root, { id: 'x', duration: 6, media, timing: { words: WORDS, lines: [{ id: 'L1', start: 0, end: 6, label: null }] }, nk });
    return (doc as Any).__compiled.x;
  };
  const bare = run({ id: 'a', treatment: 'stat', on: '' });
  assert.deepEqual(bare.manifest.pieces, []);
  assert.ok(bare.reports.some((r: string) => /^treatment_empty: piece a's stat/.test(r)));
  const pictured = run({ id: 'a', asset: 'NOREG', treatment: 'number', opts: {}, on: '' });
  assert.equal(pictured.manifest.pieces[0].asset, 'NOREG');
  assert.ok(pictured.manifest.pieces[0].box_at_rest.w > 0);
  assert.ok(pictured.reports.some((r: string) => /shows its picture/.test(r)));
  const full = run({ id: 'a', treatment: 'stat', opts: { value: '$5' }, on: '' });
  assert.ok(full.manifest.pieces[0].box_at_rest.w > 0, 'a stat that has its number is untouched');
  assert.ok(!full.reports.some((r: string) => /treatment_empty/.test(r)));
});

test('a piece leaving at or before its arrival stays on, reported, instead of breaking the frame', () => {
  const doc = dom();
  const root = doc.createElement('div');
  doc.body.append(root);
  const fr = compiledFrame({ treatment: 'collision', blueprint: T({ pieces: [{ id: 'a', asset: 'P1', on: 'voted', until: 'board' }] }), known_names: [] });
  fr.build(root, { id: 'x', duration: 6, media, timing: { words: WORDS, lines: [{ id: 'L1', start: 0, end: 6, label: null }] }, nk });
  const rec = (doc as Any).__compiled.x;
  assert.equal(rec.plain, false);
  assert.ok(rec.reports.some((r: string) => /^until_before_on: piece a/.test(r)), rec.reports.join());
  assert.equal(rec.manifest.pieces[0].until, 6, 'it stays to the end of the frame');
  // The kit itself holds the same line for a caller that isn't compiled.
  const made = (nk as Any).stage(doc, { duration: 0.4, pieces: [{ id: 'a', media: media.P1, at: 0.35, until: 0 }] });
  assert.ok(made.manifest().pieces.length === 1);
});
