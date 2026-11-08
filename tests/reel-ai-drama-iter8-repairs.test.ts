// @ts-nocheck: the kit is plain browser JS; these tests drive it through jsdom.
// Iteration 8, repairs after the first live run (MD-145–148). Offline: no model, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { keepClear, labelBlock, OVERLAY } from '../explainers/reel-ai-drama/kit/components/anchor.js';
import * as nk from '../explainers/reel-ai-drama/kit/components/index.js';
import { RECUT_CLOSE_UP, sameImageRecut, tourCamera, tourLabelSpot, tourPose, tourTimes } from '../explainers/reel-ai-drama/kit/components/moves.js';
import { crossesHead, EXPRESSIONS, headOf } from '../explainers/reel-ai-drama/kit/settings/index.js';
import { softReveal } from '../explainers/reel-ai-drama/kit/treatment-geometry.js';
import { sourceProblems } from '../explainers/reel-ai-drama/kit/try.mjs';
import { validateCues, VOICE_STOP } from '@/lib/reel-ai-drama/render/sound-design';
import { creditRepeats, validateDraft } from '@/lib/reel-ai-drama/writing/validate';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';

const DIR = path.join(process.cwd(), 'explainers', 'reel-ai-drama');
const read = (...p: string[]) => fs.readFileSync(path.join(DIR, ...p), 'utf8');

function dom() {
  const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="w"></div></body></html>');
  nk.installKit(window.document, { fonts: 'assets/fonts/' });
  return window.document;
}

/** Layout for jsdom: a box from an element's inline left, top, width and height, inside its positioned parents. */
function layout(doc: Document, sizes: Map<Element, { w: number; h: number }>) {
  const proto = doc.defaultView.HTMLElement.prototype;
  const size = (el) => sizes.get(el) ?? { w: parseFloat(el.style.width) || 1080, h: parseFloat(el.style.height) || 1920 };
  proto.getBoundingClientRect = function () {
    const { w, h } = size(this);
    const left = parseFloat(this.style.left) || 0, top = parseFloat(this.style.top) || 0;
    return { left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top };
  };
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get() { return size(this).h; } });
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get() { return size(this).w; } });
}

// ── Reusing an image (MD-146) ─────────────────────────────────────────────

const WIDE = { id: 'W', file: 'assets/media/W.jpg', width: 2400, height: 1600, regions: { faces: [{ x: 0.2, y: 0.3, w: 0.1, h: 0.15, name: 'Ada Founder' }, { x: 0.8, y: 0.3, w: 0.1, h: 0.15, name: 'Ben Rival' }] } };

test('tourTimes: each move runs into its words, and a label shows only between arriving and leaving', () => {
  const t = tourTimes([0, 3, 6], 9);
  assert.equal(t[0].from, 0);
  assert.ok(t[1].from < 3 && t[1].to > 3, 'the camera arrives as the words start');
  assert.deepEqual(t[0].show, [0, t[1].from]);
  assert.deepEqual(t[1].show, [t[1].to, t[2].from]);
  assert.deepEqual(t[2].show, [t[2].to, 9]);
});

test('tourPose: one continuous camera, always covering the frame', () => {
  const fit = { w: 2880, h: 1920 };
  const stops = [{ at: 0, point: [400, 800], zoom: 1 }, { at: 2, point: [2600, 700], zoom: 1.6 }, { at: 4.2, point: [1500, 1800], zoom: 2.2 }];
  const lengths = stops.map((s, i) => (i ? Math.hypot(s.point[0] - stops[i - 1].point[0], s.point[1] - stops[i - 1].point[1]) * s.zoom : 0));
  const times = tourTimes(stops.map((s) => s.at), 6, lengths);
  assert.ok(times[1].to - times[1].from > tourTimes([0, 2], 6)[1].to - tourTimes([0, 2], 6)[1].from, 'a longer way across takes longer');
  let last = null;
  for (let f = 0; f <= 180; f++) {
    const t = f / 30;
    const c = tourPose(stops, times, t, fit, 6);
    assert.ok(c.tx <= 0 && c.tx >= 1080 - fit.w * c.s - 0.01, `x covers at ${t}`);
    assert.ok(c.ty <= 0 && c.ty >= 1920 - fit.h * c.s - 0.01, `y covers at ${t}`);
    if (last) {
      assert.ok(Math.abs(c.tx - last.tx) < 300 && Math.abs(c.ty - last.ty) < 300 && Math.abs(c.s - last.s) < 0.1, `no jump at ${t}`);
    }
    last = c;
  }
  const held = tourPose(stops, times, 3.5, fit, 6);
  assert.ok(Math.abs(held.s / 1.6 - 1) < 0.03, 'holding on its stop');
  const frozen = tourPose([stops[0]], tourTimes([0], 6), 0, fit, 6);
  assert.notEqual(frozen.s, tourPose([stops[0]], tourTimes([0], 6), 6, fit, 6).s, 'a held stop still drifts');
  assert.ok(tourCamera([0, 0], 1, fit).tx === 0, 'never past the picture\'s edge');
});

test('tourLabelSpot: under what it names, above with no room, always inside the overlay zone', () => {
  const size = { w: 400, h: 65 };
  const inside = (p) => p.x >= OVERLAY.x0 && p.x + size.w <= OVERLAY.x1 && p.y >= OVERLAY.y0 && p.y + size.h <= OVERLAY.y1;
  assert.equal(tourLabelSpot({ x: 400, y: 800, w: 200, h: 200 }, size).y, 1018);
  assert.equal(tourLabelSpot({ x: 400, y: 1400, w: 200, h: 200 }, size).y, 1400 - 18 - 65);
  for (const box of [{ x: -300, y: -200, w: 50, h: 50 }, { x: 2000, y: 3000, w: 50, h: 50 }, { x: 900, y: 590, w: 300, h: 1400 }]) assert.ok(inside(tourLabelSpot(box, size)), JSON.stringify(box));
});

test('nk.tour: one picture, names only during their stop, pure, and a stop on a face the picture lacks is reported', () => {
  const doc = dom();
  const m = nk.tour(doc, { media: WIDE, duration: 8, credit: 'A credit', stops: [{ at: 0, zoom: 1, focus: [0.5, 0.5] }, { at: 2, face: 'Ada Founder', label: 'Ada Founder' }, { at: 5, face: 'Ben Rival', label: 'Ben Rival' }, { at: 6, face: 'Nobody Here', label: 'Nobody' }] });
  doc.getElementById('w').append(m.el);
  assert.equal(m.el.querySelectorAll('img').length, 1, 'one image, not one per beat');
  assert.equal(m.stops.length, 3);
  assert.match(doc.__markSkips.join(), /no measured face for "Nobody Here"/);
  const names = [...m.el.querySelectorAll('[data-tour-label]')];
  const visible = (t) => { m.render(t); return names.filter((n) => n.style.visibility !== 'hidden').map((n) => n.textContent); };
  assert.deepEqual(visible(1), []);
  assert.deepEqual(visible(3.5), ['Ada Founder']);
  assert.deepEqual(visible(6.5), ['Ben Rival']);
  const a = (m.render(3.5), nk.canonicalDom(doc.getElementById('w')));
  m.render(8); m.render(0.05);
  m.render(3.5);
  assert.equal(nk.canonicalDom(doc.getElementById('w')), a);
  assert.equal(nk.tour(doc, { media: { id: 'X' }, stops: [{ at: 0 }] }).events.length, 0, 'an unmeasured picture is skipped');
  assert.match(doc.__markSkips.join(), /a tour was skipped/);
});

test('same_image_recut: the same picture at about the same size is found; a true close-up or a new picture is not', () => {
  const was = [{ src: 'a.jpg', width: 1000 }];
  assert.equal(sameImageRecut(was, [{ src: 'a.jpg', width: 1140 }]), true);
  assert.equal(sameImageRecut(was, [{ src: 'a.jpg', width: 1000 * RECUT_CLOSE_UP }]), false);
  assert.equal(sameImageRecut(was, [{ src: 'b.jpg', width: 1000 }]), false);
  assert.equal(sameImageRecut(was, [{ src: 'a.jpg', width: 1000 }, { src: 'b.jpg', width: 800 }]), false, 'a new picture over the old one is a new beat');
  assert.equal(sameImageRecut(was, []), false);
});

test('nk.cuts reports the re-entry to the screen check, in the finding the fix step knows', () => {
  const doc = dom();
  layout(doc, new Map());
  const shot = (at, src, scale) => {
    const el = doc.createElement('div');
    const img = doc.createElement('img');
    img.setAttribute('src', src);
    img.style.width = `${1000 * scale}px`;
    el.append(img);
    return { at, el, render() {} };
  };
  const again = nk.cuts(doc, [shot(0, 'a.jpg', 1), shot(2, 'a.jpg', 1.1), shot(4, 'a.jpg', 2), shot(6, 'b.jpg', 1)]);
  assert.deepEqual(again.el.__recuts(), ['shot 2 at 2.00s']);
  const screen = fs.readFileSync(path.join(DIR, 'kit', 'screen.mjs'), 'utf8');
  assert.match(screen, /\[same_image_recut\] \$\{f\.id\}/);
});

test('nk.cuts: a photo shot lands on its own time, in the form the kit guide gives', () => {
  const doc = dom();
  const photo = () => nk.photo(doc, { media: { id: 'P', file: 'p.jpg', width: 1080, height: 1920 }, duration: 4 });
  const c = nk.cuts(doc, [{ at: 0, ...photo() }, { at: 2.5, ...photo() }, { at: 5.25, ...photo() }]);
  assert.deepEqual(c.starts, [0, 2.5, 5.25], 'the live reel\'s cuts fell a second apart because the photo\'s result overwrote `at`');
});

test('the kit guide documents the tour and how long a name lasts; the rule has one owner', () => {
  const frame = read('kit', 'FRAME.md');
  assert.match(frame, /`nk\.tour\(doc, \{ media, stops, duration, credit, grade \}\)`/);
  assert.match(frame, /A name lasts only while that person is the subject, not the whole frame/);
  assert.match(read('prompts', 'frame-worker.md'), /a stop of `nk\.tour`/);
  assert.match(read('craft', 'director-craft.md'), /One picture, one beat/);
  const director = read('prompts', 'director.md');
  assert.doesNotMatch(director, /re-entered|1\.6x/, 'the director prompt points at the craft\'s rule, it does not restate it');
  assert.match(director, /your craft's HARD CONSTRAINT 4/);
  assert.doesNotMatch(director, /one picture never sits under/, 'the old line contradicted working one picture');
});

// ── Finding pictures (MD-147, MD-145) ─────────────────────────────────────

test('the director wishes for what the words name, by class and without a quota; the moves stay optional', () => {
  const d = read('prompts', 'director.md');
  assert.match(d, /every place, object or atmosphere the narration names and no inventory asset shows is\s+wished for/);
  assert.match(d, /within HARD 11/);
  assert.doesNotMatch(d, /at least \d+ wish|wishes? per reel/i);
  assert.doesNotMatch(d, /(must|always) use (a |the )?(kit )?move/i);
});

// ── Silence (MD-148) ──────────────────────────────────────────────────────

const VOICED = () => ({
  clock: [0, 10, 20, 30].map((start, i) => ({ number: i + 1, id: `f${i + 1}`, name: `F${i + 1}`, start, duration: 10, fields: {}, words: Array.from({ length: 16 }, (_, k) => ({ text: `w${k}`, start: k * 0.6, end: k * 0.6 + 0.5 })) })),
  total: 40,
  closeStart: 35,
  hookFrame: 1,
  peakFrames: [],
  landingFrames: [],
});
const LIB = { stingers: { riser: [{ id: 'r1', land: 4 }] }, ambience: [] } as never;
const OPEN = { action: 'start', frame: 1, word: null, offset: 0, why: 'open' };
const at = (frame, offset, extra) => ({ frame, word: null, offset, why: 'it lands', ...extra });
const actions = (r) => r.cues.music.map((m) => m.action);

test('validateCues: a long stop under the voice with no build is repaired: the music keeps playing, and it is reported', () => {
  const r = validateCues({ music: [OPEN, { action: 'swell', ...at(3, 2) }, { action: 'cut', ...at(3, 3.1) }, { action: 'resume', ...at(3, 4.8) }] }, VOICED(), LIB);
  assert.deepEqual(actions(r), ['start', 'swell'], 'its swell peaked too early to be heard as a build');
  assert.ok(r.problems.some((p) => /music cut at 23\.1s: 1\.7s without music under the voice and no build peaking on it; the music keeps playing/.test(p)), r.problems.join('; '));
});

test('validateCues: a brief dip needs no build', () => {
  const r = validateCues({ music: [OPEN, { action: 'drop', ...at(2, 1) }, { action: 'resume', ...at(2, 1 + VOICE_STOP.free - 0.1) }] }, VOICED(), LIB);
  assert.deepEqual(actions(r), ['start', 'drop', 'resume']);
});

test('validateCues: a swell or a riser peaking on the stop, with room for its full rise, keeps it', () => {
  const swell = validateCues({ music: [OPEN, { action: 'cut', ...at(2, 2) }, { action: 'swell', ...at(2, 2) }, { action: 'resume', ...at(2, 3.5) }] }, VOICED(), LIB);
  assert.deepEqual(actions(swell), ['start', 'swell', 'cut', 'resume'], 'on the same instant the swell comes first');
  const riser = validateCues({ music: [OPEN, { action: 'drop', ...at(2, 2) }, { action: 'resume', ...at(2, 3.5) }], stingers: [{ kind: 'riser', ...at(2, 2), dur: 2, id: 'r1' }] }, VOICED(), LIB);
  assert.deepEqual(actions(riser), ['start', 'drop', 'resume']);
  assert.equal(riser.cues.stingers.filter((s) => s.kind === 'riser').length, 1, 'a riser may build to a stop');
});

test('validateCues: no room for the build means no stop', () => {
  // The music only came back 1s before this swell's peak, so its 3s rise is not heard.
  const r = validateCues({ music: [OPEN, { action: 'drop', ...at(2, 0) }, { action: 'resume', ...at(2, 0.4) }, { action: 'swell', ...at(2, 1.4) }, { action: 'cut', ...at(2, 1.4) }, { action: 'resume', ...at(2, 3) }] }, VOICED(), LIB);
  assert.ok(!actions(r).includes('cut'), actions(r).join());
  const early = validateCues({ music: [OPEN, { action: 'swell', ...at(1, 2) }, { action: 'cut', ...at(1, 2) }, { action: 'resume', ...at(1, 4) }] }, VOICED(), LIB);
  assert.ok(!actions(early).includes('cut'), 'a swell 2s into the reel has no 3s to rise in');
  const shortRiser = validateCues({ music: [OPEN, { action: 'drop', ...at(2, 2) }, { action: 'resume', ...at(2, 3.5) }], stingers: [{ kind: 'riser', ...at(2, 2), dur: 1, id: 'r1' }] }, VOICED(), LIB);
  assert.ok(!actions(shortRiser).includes('drop'));
});

test('validateCues: a built stop still stays short', () => {
  const r = validateCues({ music: [OPEN, { action: 'swell', ...at(2, 4) }, { action: 'cut', ...at(2, 4) }, { action: 'resume', ...at(3, 2) }] }, VOICED(), LIB);
  const back = r.cues.music.find((m) => m.action === 'resume');
  assert.equal(back.t, 14 + VOICE_STOP.held);
  const none = validateCues({ music: [OPEN, { action: 'swell', ...at(2, 4) }, { action: 'cut', ...at(2, 4) }] }, VOICED(), LIB);
  assert.equal(none.cues.music.find((m) => m.action === 'resume').t, 14 + VOICE_STOP.held, 'it comes back even when none was asked for');
});

test('validateCues: a stop in a gap in the voice is not this rule\'s', () => {
  const reel = VOICED();
  reel.clock[1].words = [];
  const r = validateCues({ music: [OPEN, { action: 'drop', ...at(2, 2) }, { action: 'resume', ...at(2, 5) }] }, reel, LIB);
  assert.deepEqual(actions(r), ['start', 'drop', 'resume']);
});

test('validateCues: a resume cannot change style', () => {
  const r = validateCues({ music: [OPEN, { action: 'drop', ...at(2, 1) }, { action: 'resume', ...at(2, 1.2), style: 'dread' }] }, VOICED(), LIB);
  assert.equal(r.cues.music.find((m) => m.action === 'resume').style, null);
  assert.ok(r.problems.some((p) => /a resume brings the same music back/.test(p)));
});

test('the sound designer is asked for a build, and no longer to stop dead on a reveal', () => {
  const s = read('prompts', 'sound-designer.md');
  assert.doesNotMatch(s, /cut the music dead|near-silence|biggest\s+reveal/);
  assert.match(s, /a real build that peaks on it \(HARD 10\)/);
  assert.match(s, /`resume` brings the same\s+section back/);
  assert.match(s, /7–10 are repaired and reported/);
  assert.match(s, /where music starts, changes, resumes\s+or stops/);
});

// ── Labels as one block ───────────────────────────────────────────────────

test('labelBlock: stacked in the order they land; one that lands after another left takes its place', () => {
  const b = labelBlock([{ w: 300, h: 60, at: 1 }, { w: 500, h: 100, at: 0 }, { w: 200, h: 40, at: 2 }], 10);
  assert.deepEqual(b.tops, [110, 0, 180]);
  assert.deepEqual([b.w, b.h], [500, 220]);
  const taken = labelBlock([{ w: 300, h: 60, at: 0, until: 2 }, { w: 300, h: 60, at: 3 }], 10);
  assert.deepEqual(taken.tops, [0, 0]);
  assert.equal(taken.h, 60);
});

test('keepClear: a frame\'s labels, across its treatments, align as one block clear of the face', () => {
  const doc = dom();
  const host = doc.getElementById('w');
  const sizes = new Map();
  host.innerHTML = '';
  const shot = doc.createElement('div');
  shot.className = 'rd';
  const face = doc.createElement('div');
  face.setAttribute('data-keepout', 'face');
  Object.assign(face.style, { left: '300px', top: '700px', width: '480px', height: '480px' });
  shot.append(face);
  host.append(shot);
  const label = (parent, w, h, x, y, at) => {
    const el = doc.createElement('div');
    Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
    sizes.set(el, { w, h });
    parent.append(el);
    return { el, clear: keepClear(el, { at }) };
  };
  layout(doc, sizes);
  const parts = [label(host, 520, 65, 96, 1180, 0), label(host, 470, 117, 96, 1180, 0.1), label(shot, 440, 138, 350, 1200, 0.5)];
  for (const p of parts) assert.equal(p.clear.place(), true);
  const boxes = parts.map((p) => p.el.getBoundingClientRect());
  assert.equal(new Set(boxes.map((b) => b.left)).size, 1, 'one left edge');
  assert.ok(boxes[0].bottom <= boxes[1].top && boxes[1].bottom <= boxes[2].top, 'stacked in the order they land, none over another');
  assert.ok(boxes[0].top >= 700 + 480 + 480 * 0.12 - 96, `clear of the face where the zone allows: ${boxes[0].top}`);
  assert.ok(boxes[2].bottom <= OVERLAY.y1);
});

test('cutoutLift: at rest it keeps its centring, so labels measure its face where it is', () => {
  const doc = dom();
  const shot = nk.cutoutLift(doc, { cutout: 'c.png', media: { id: 'C', file: 'c.png', width: 100, height: 100, face: { x: 0.3, y: 0.2, w: 0.4, h: 0.4 } }, duration: 4 });
  const rest = JSON.parse(shot.picture.frame.getAttribute('data-rest'));
  assert.match(rest.transform, /translate\(-50%/);
});

// ── Expression marks ──────────────────────────────────────────────────────

/** The points a path passes through or bends toward, absolute or relative. */
function pathPoints(d) {
  const out = [];
  let x = 0, y = 0;
  for (const [, cmd, body] of d.matchAll(/([MLCQAHqZ])([^MLCQAHqZ]*)/g)) {
    const n = [...body.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    if (cmd === 'H') { x = n[0]; out.push([x, y]); } else if (cmd === 'A') { x = n[5]; y = n[6]; out.push([x, y]); } else if (cmd === 'q') {
      out.push([x + n[0], y + n[1]]); x += n[2]; y += n[3]; out.push([x, y]);
    } else if (cmd !== 'Z') {
      for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
      if (n.length >= 2) { x = n[n.length - 2]; y = n[n.length - 1]; }
    }
  }
  return out;
}

// Measured on the live reel: a face box runs brow to chin, the forehead and hair above it.
const REAL_FACES = [{ x: 392, y: 780, w: 296, h: 297 }, { x: 340, y: 712, w: 465, h: 464 }, { x: 480, y: 900, w: 120, h: 150 }];

test('expression marks: on real face boxes no kind crosses the head, on either side', () => {
  for (const f of REAL_FACES) {
    const head = headOf(f);
    assert.ok(head.y < f.y - f.h * 0.5, 'the head rises well above the box');
    for (const [kind, fn] of Object.entries(EXPRESSIONS)) {
      for (const side of [1, -1]) {
        const points = fn(f, side).flatMap((p) => pathPoints(p.d));
        assert.ok(points.length > 0, kind);
        // The tail of a thought starts at the head's edge; every other point is clear by the full ellipse.
        assert.equal(crossesHead(points, head), false, `${kind} side ${side} on ${JSON.stringify(f)}`);
      }
    }
  }
});

test('crossesHead: strokes on a forehead are found', () => {
  const f = REAL_FACES[0];
  assert.equal(crossesHead([[f.x + f.w / 2, f.y - 40]], headOf(f)), true, 'the old worry mark sat here');
  assert.equal(crossesHead([[f.x + f.w * 1.3, f.y - 40]], headOf(f)), false);
});

// ── The drawing's edge ────────────────────────────────────────────────────

test('nk.drawn reveals with a soft edge; a moving clip written by hand fails the check', () => {
  assert.equal(softReveal(1), 'none');
  assert.match(softReveal(0.5, 'right'), /^linear-gradient\(to right,#000 [\d.]+%,transparent [\d.]+%\)$/);
  assert.match(softReveal(0.5), /to bottom/);
  assert.match(softReveal(0), /#000 -12\.00%,transparent 0\.00%/, 'nothing shows at the start');
  const doc = dom();
  const d = nk.drawn(doc, { media: { id: 'M', file: 'm.png', width: 100, height: 100 }, at: [1, 2], dir: 'right' });
  doc.getElementById('w').append(d.el);
  d.render(1.5);
  assert.equal(d.el.style.clipPath, '');
  assert.match(d.el.style.getPropertyValue('mask-image'), /linear-gradient/);
  const src = 'export default { treatment: "whiteboard", build() {}, render(t) { x.style.clipPath = `inset(0 ${100 - t}% 0 0)`; } };';
  assert.ok(sourceProblems(src).some((p) => /wipes by hand/.test(p)));
  assert.deepEqual(sourceProblems('export default { treatment: "photo", build() { x.style.clipPath = `inset(0 10% 0 0)`; }, render() {} };'), [], 'a fixed crop is not a wipe');
});

// ── render(t) determinism ─────────────────────────────────────────────────

test('canonicalDom: the order inline styles were written in is no difference; a real change is', () => {
  const doc = dom();
  const host = doc.getElementById('w');
  const el = doc.createElement('div');
  host.append(el);
  el.setAttribute('style', 'visibility: hidden; clip-path: inset(0px);');
  const a = nk.canonicalDom(host);
  const raw = host.innerHTML;
  el.setAttribute('style', 'clip-path: inset(0px); visibility: hidden;');
  assert.notEqual(host.innerHTML, raw, 'the plain markup differs, which is what fired on the live reel');
  assert.equal(nk.canonicalDom(host), a, 'cleared and set again, a property moves to the end of the attribute');
  el.style.visibility = 'visible';
  assert.notEqual(nk.canonicalDom(host), a);
  const empty = doc.createElement('div');
  host.append(empty);
  const before = nk.canonicalDom(host);
  empty.style.left = '1px';
  empty.style.left = '';
  assert.equal(nk.canonicalDom(host), before, 'an emptied style attribute is no attribute');
});

test('a label wiping in, drawn in any order, is one state: the check that fired on it is order-blind', () => {
  const doc = dom();
  const host = doc.getElementById('w');
  const l = nk.lineLabel(doc, { label: 'A date', label_kind: 'date', start: 2 });
  host.append(l.el);
  l.render(0);
  const first = nk.canonicalDom(host);
  l.render(6);
  l.render(0.05);
  l.render(0);
  assert.equal(nk.canonicalDom(host), first);
  assert.match(fs.readFileSync(path.join(DIR, 'kit', 'try.mjs'), 'utf8'), /return window\.__canon\(host\)/);
  assert.match(fs.readFileSync(path.join(DIR, 'kit', 'browser.mjs'), 'utf8'), /window\.__canon = nk\.canonicalDom/);
});

test('the check still catches a render that depends on what was drawn before', () => {
  const doc = dom();
  const host = doc.getElementById('w');
  let drawn = 0;
  const el = doc.createElement('div');
  host.append(el);
  const render = () => { drawn += 1; el.textContent = String(drawn); };
  render();
  const a = nk.canonicalDom(host);
  render();
  assert.notEqual(nk.canonicalDom(host), a);
});

// ── Narration credits ─────────────────────────────────────────────────────

const SOURCES = { facts: [{ id: 'F1', confidence: 'single_source' }, { id: 'F9', confidence: 'disputed' }], sources: [{ id: 'S1', publisher: 'TIME' }, { id: 'S2', publisher: 'The Daily Wire (dailywire.example)' }] };
const said = (id, text, fact_ids = ['F1']) => ({ id, text, fact_ids });

test('creditRepeats: a source credited on more than one line is found, however it is phrased', () => {
  const lines = [said('L1', 'According to TIME, she crossed on foot.'), said('L2', 'She kept going.'), said('L3', 'TIME says he saw a chance.'), said('L4', 'The minister later told TIME it was desperate.'), said('L5', 'TIME later reported the deal was free.')];
  const out = creditRepeats(lines, SOURCES);
  assert.equal(out.length, 1);
  assert.match(out[0], /TIME is credited 4 times \(L1, L3, L4, L5\)/);
  assert.deepEqual(creditRepeats([said('L1', 'According to the Daily Wire, it failed.'), said('L2', 'The Daily Wire reported a loss.')], SOURCES).length, 1, 'the name as credited, with or without its article');
});

test('creditRepeats: once is fine; so are the common word, a story about the outlet, and a dispute\'s two sides', () => {
  assert.deepEqual(creditRepeats([said('L1', 'According to TIME, it failed.'), said('L2', 'It failed again.')], SOURCES), []);
  assert.deepEqual(creditRepeats([said('L1', 'He told time was short.'), said('L2', 'According to TIME, it failed.'), said('L3', 'This time said nothing.')], SOURCES), []);
  assert.deepEqual(creditRepeats([said('L1', 'TIME sued the lab.'), said('L2', 'TIME won the case.')], SOURCES), []);
  assert.deepEqual(creditRepeats([said('L1', 'According to TIME, it failed.'), said('L2', 'TIME says it did not.', ['F9'])], SOURCES), []);
});

test('validateDraft turns a repeated credit into a problem for the writer, and must 4 says once in the reel', () => {
  const line = (id, text) => ({ id, text, on_screen: null, on_screen_kind: null, fact_ids: ['F1'], must_show: null, pause_after: null });
  const draft = { title: 'x', hook: { on_screen: 'x', line_id: 'L1' }, rungs: [{ id: 'R1', purpose: 'x', lines: [line('L1', 'According to TIME, it failed.'), line('L2', 'TIME says it failed again.')] }], peak_rung_id: 'R1', landing_rung_id: 'R1', close_question: 'Why?', central: [], pronounce: [] };
  const v = validateDraft(draft, { facts: { ...SOURCES, quotes: [], artifacts: [] }, inventory: null, limits: DEFAULT_SETTINGS });
  assert.ok(v.problems.some((p) => /TIME is credited 2 times/.test(p)), v.problems.join('; '));
  const must = read('craft', 'principles.md');
  assert.match(must, /names that source once in the\s+whole reel/);
  assert.match(must, /named again only where a dispute needs both sides/);
  assert.doesNotMatch(read('craft', 'director-craft.md'), /source label/, 'a source is never on screen');
});

// ── Prompt standard ───────────────────────────────────────────────────────

test('no prompt carries an example from the reel these repairs came from', () => {
  const files = [['prompts', 'director.md'], ['prompts', 'sound-designer.md'], ['prompts', 'fix.md'], ['prompts', 'frame-worker.md'], ['craft', 'director-craft.md'], ['craft', 'principles.md'], ['kit', 'FRAME.md']];
  for (const f of files) {
    assert.doesNotMatch(read(...f), /\bTIME\b/, f.join('/'));
    assert.doesNotMatch(read(...f), /magazine|president|Palantir|Ukrain|Kyiv|Zelensk|Fedorov|\bKarp\b|espresso|bunker/i, f.join('/'));
  }
});
