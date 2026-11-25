// @ts-nocheck: the kit is plain browser JS; these tests drive it through jsdom.
// Iteration 8, the kit's moves and the white close (MD-136, MD-138, MD-143). Offline: no model, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import * as nk from '../explainers/reel-ai-drama/kit/components/index.js';
import { burstFlips, cutIndex, cueAt, logoMask, logoOutlines, speechSpot, unquoted } from '../explainers/reel-ai-drama/kit/components/moves.js';
import { playersLayout, frontHeadlineSize } from '../explainers/reel-ai-drama/kit/components/scenes.js';
import { WORLD_BLEED } from '../explainers/reel-ai-drama/kit/components/stat.js';
import closeModule, { GROUND, LOGO, WORDMARK, WORD_BASELINE } from '../explainers/reel-ai-drama/kit/close.js';
import { CLOSE, CLOSE_EVENTS, CLOSE_FADE } from '../explainers/reel-ai-drama/kit/close-timing.js';
import { LIGHT_TREATMENTS, withCloseFade, writeClose, writeCloseFade } from '../explainers/reel-ai-drama/kit/frames.mjs';

const KIT = path.join(process.cwd(), 'explainers', 'reel-ai-drama', 'kit');
const PROMPTS = path.join(process.cwd(), 'explainers', 'reel-ai-drama', 'prompts');

function dom() {
  const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="w" class="rd nk"></div></body></html>');
  nk.installKit(window.document, { fonts: 'assets/fonts/' });
  return window.document;
}

const media = (id: string, extra = {}) => ({ id, file: `assets/media/${id}.png`, width: 1200, height: 1800, ...extra });
const PERSON = media('P1', { face: { x: 0.35, y: 0.1, w: 0.3, h: 0.25 }, character_image: true, flags: ['cutout'] });

const MOVES: Record<string, (doc: Document) => { el: HTMLElement; render: (t: number) => void; events: any[] }> = {
  flashReveal: (doc) => nk.flashReveal(doc, { media: media('A1'), at: 1, duration: 4, credit: 'Source' }),
  phoneShot: (doc) => nk.phoneShot(doc, { media: media('A1'), at: 1, duration: 4, credit: 'Source' }),
  clickReveal: (doc) => nk.clickReveal(doc, { media: media('A1'), headline: 'A headline', source: 'A paper', at: 1, clickAt: 1.6, duration: 4 }),
  burst: (doc) => nk.burst(doc, { media: [media('A1'), media('A2'), media('A3')], at: 1, duration: 2, opacity: 0.2 }),
};

function validEvents(events: any[]) {
  assert.ok(Array.isArray(events) && events.length, 'carries its own sound');
  for (const e of events) {
    assert.ok(Number.isFinite(e.t) && e.t >= 0, `time: ${JSON.stringify(e)}`);
    assert.equal(typeof e.kind, 'string');
  }
}

/** The element as markup, its style declarations sorted: a property's order changes nothing on screen. */
const picture = (el: HTMLElement) => el.outerHTML.replace(/style="([^"]*)"/g, (_, css) => `style="${css.split(';').map((d: string) => d.trim()).filter(Boolean).sort().join(';')}"`);

function deterministic(move: { el: HTMLElement; render: (t: number) => void }, times: number[]) {
  move.render(times[0]);
  const first = picture(move.el);
  for (const t of times.slice(1)) move.render(t);
  move.render(times[0]);
  assert.equal(picture(move.el), first, 'the same picture at the same t, whatever came before');
}

for (const [name, make] of Object.entries(MOVES)) {
  test(`${name}: deterministic, with sound events, invisible before its time`, () => {
    const doc = dom();
    const move = make(doc);
    doc.getElementById('w')!.appendChild(move.el);
    deterministic(move, [2, 0.2, 3.9, 1.1]);
    validEvents(move.events);
    assert.ok(move.events.every((e) => e.t >= 1), 'no sound before the move starts');
    move.render(0.5);
    assert.ok(move.el.style.visibility === 'hidden' || move.el.style.opacity === '0', 'nothing before `at`');
  });
}

test('flashReveal: the shutter lands on `at`; named for the asset it shows', () => {
  const m = nk.flashReveal(dom(), { media: media('A1'), at: 2, duration: 3 });
  const shutter = m.events.find((e) => /shutter/.test(e.what ?? ''));
  assert.equal(shutter.t, 2);
  assert.equal(shutter.shown, 'A1');
  assert.ok(m.page, 'marks can land on the page');
});

test('clickReveal: the click and the notification sound on the click', () => {
  const m = MOVES.clickReveal(dom());
  assert.ok(m.events.some((e) => e.kind === 'click' && e.t === 1.6));
  assert.ok(m.events.length >= 2);
});

test('burst: flips are seeded, fast, and the seed changes the order', () => {
  const a = burstFlips({ count: 5, at: 1, duration: 1.2 });
  assert.deepEqual(a, burstFlips({ count: 5, at: 1, duration: 1.2 }));
  assert.notDeepEqual(a, burstFlips({ count: 5, at: 1, duration: 1.2, seed: 99 }));
  assert.ok(a.length > 5, 'each picture comes back more than once');
});

test('speech: paraphrase with no quote marks, beside the face, clear of other faces', () => {
  assert.equal(unquoted('"We never said it"'), 'We never said it');
  assert.equal(unquoted('“We never said it”'), 'We never said it');
  const face = { x: 100, y: 800, w: 240, h: 300 };
  const spot = speechSpot({ face, size: { w: 400, h: 120 }, side: 'auto' });
  const overlaps = (a: any, b: any) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  assert.ok(!overlaps(spot, face));
  const other = { x: spot.x, y: spot.y, w: spot.w, h: spot.h };
  assert.ok(!overlaps(speechSpot({ face, size: { w: 400, h: 120 }, side: 'auto', others: [other] }), other));
});

test('speech: on a picture without that face it is skipped and reported, never floating or thrown', () => {
  const doc = dom();
  const host = doc.getElementById('w')!;
  const pic = nk.photo(doc, { media: media('A1') });
  host.appendChild(pic.el);
  const s = nk.speech(doc, { on: pic, target: 'face:nobody', text: 'a few words', at: 1, duration: 2 });
  pic.render(2);
  s.render(2);
  assert.equal(s.events.length, 0);
  assert.match(String((doc as unknown as { __markSkips: string[] }).__markSkips), /speech was skipped/);
});

test('cuts: each shot shows from its own time, with local time, and its sound moves with it', () => {
  const doc = dom();
  const seen: Array<[string, number]> = [];
  const shot = (name: string, at: number) => {
    const el = doc.createElement('div');
    el.setAttribute('data-cues', JSON.stringify([{ t: 0.5, kind: 'click' }]));
    return { at, el, render: (t: number) => seen.push([name, t]), events: [{ t: 0.5, kind: 'click' }] };
  };
  const c = nk.cuts(doc, [shot('a', 0), shot('b', 2), shot('c', 4)]);
  doc.getElementById('w')!.appendChild(c.el);
  assert.deepEqual(c.events.map((e) => e.t), [0.5, 2.5, 4.5]);
  assert.deepEqual(cutIndex([0, 2, 4], 1.9), 0);
  assert.deepEqual(cutIndex([0, 2, 4], 2), 1);
  seen.length = 0;
  c.render(3);
  assert.ok(seen.some(([n, t]) => n === 'b' && t === 1), 'the shot on screen gets seconds since it cut in');
  deterministic(c, [3, 0.1, 5]);
});

test('cuts: a shot whose words were not found still lands in order', () => {
  const doc = dom();
  const shot = (at: any) => ({ at, el: doc.createElement('div'), render: () => {} });
  const c = nk.cuts(doc, [shot(0), shot(3), shot(null), shot(1)]);
  assert.deepEqual([...c.starts], [0, 3, 4, 4]);
});

test('cueAt: finds the words, ignoring case and punctuation, in order; null when unspoken', () => {
  const words = 'It was, in fact, the first time. The first one.'.split(' ').map((text, i) => ({ text, start: i, end: i + 0.5 }));
  assert.equal(cueAt(words, 'in fact'), 2);
  assert.equal(cueAt(words, 'the first', 5), 7);
  assert.equal(cueAt(words, 'the first thing ever'), 4, 'the longest opening the voice says');
  assert.equal(cueAt(words, 'nothing here'), null);
});

test('drawnLogo: the whiteboard only; outlines come from the file', () => {
  const doc = dom();
  const off = nk.drawnLogo(doc, { media: media('L1'), at: 1, duration: 2 });
  doc.getElementById('w')!.appendChild(off.el);
  off.render(2);
  assert.equal((off.el as HTMLElement).style.display, 'none');
  assert.match(String((doc as unknown as { __markSkips: string[] }).__markSkips), /whiteboard only/);
  const board = doc.createElement('div');
  board.setAttribute('data-ground', 'whiteboard');
  doc.body.appendChild(board);
  const on = nk.drawnLogo(doc, { media: media('L1'), at: 1, duration: 2 });
  board.appendChild(on.el);
  on.render(2);
  validEvents(on.events);
  assert.ok(on.events.some((e) => /marker/.test(e.what ?? '')));
  deterministic(on, [2, 0, 1.5]);
  const w = 20, h = 20;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) { const i = (y * w + x) * 4; rgba[i + 3] = 255; }
  const mask = logoMask(rgba, w, h);
  const outlines = logoOutlines(mask, w, h);
  assert.ok(outlines.length >= 1);
  const xs = outlines.flat().map((p: number[]) => p[0]);
  assert.ok(Math.min(...xs) >= 3 && Math.max(...xs) <= 16, 'the outline follows the shape');
});

test('stat: the ground reaches past the frame, so no camera move shows an edge', () => {
  const doc = dom();
  const s = nk.stat(doc, { kind: 'counter', value: 42, unit: 'things', at: 0.5, duration: 4 });
  assert.ok(WORLD_BLEED >= 1080);
  assert.equal(s.el.style.overflow, 'visible');
  assert.ok(s.el.querySelectorAll('[data-bleed]').length >= 2);
  deterministic(s, [2, 0, 3.5]);
});

test('stat: a burst composes behind the number; a camera carries its own sound', () => {
  const doc = dom();
  const plain = nk.stat(doc, { kind: 'counter', value: 42, at: 0.5, duration: 4 });
  const s = nk.stat(doc, { kind: 'counter', value: 42, at: 0.5, duration: 4, burst: [media('A1'), media('A2')], camera: { on: 0, scale: 2, at: [1, 2] } });
  assert.ok(s.events.length > plain.events.length);
  assert.ok(s.events.some((e) => e.kind === 'whoosh' && e.t > 1 && e.t < 2), 'the move is heard while it moves');
  deterministic(s, [1.5, 0, 3]);
});

test('playersBoard: 2 to 5 cards, none overlap, none under the captions, cords never cross a third card', () => {
  for (let n = 2; n <= 5; n++) {
    const links = [];
    for (let i = 0; i + 1 < n; i++) links.push({ from: i, to: i + 1 });
    const { cards, cords } = playersLayout(n, links);
    assert.equal(cards.length, n);
    for (const c of cards) {
      assert.ok(c.y >= 600, `below the caption band: ${n}`);
      assert.ok(c.x >= 0 && c.x + c.w <= 1080, `inside the frame: ${n}`);
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = cards[i], b = cards[j];
        assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `cards ${i},${j} of ${n}`);
      }
    }
    for (const cord of cords) {
      cards.forEach((c, k) => {
        if (k === cord.from || k === cord.to) return;
        for (let s = 0; s <= 40; s++) {
          const x = cord.a[0] + (cord.b[0] - cord.a[0]) * (s / 40);
          const y = cord.a[1] + (cord.b[1] - cord.a[1]) * (s / 40);
          assert.ok(!(x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h), `cord ${cord.from}-${cord.to} over card ${k} of ${n}`);
        }
      });
    }
  }
});

test('playersBoard: deterministic, a card and a cord per cue, with sounds', () => {
  const doc = dom();
  const b = nk.playersBoard(doc, { players: [{ media: PERSON, name: 'One', at: 0 }, { media: media('L1'), name: 'Two', logo: true, at: 1 }, { media: PERSON, name: 'Three', at: 2 }], links: [{ from: 0, to: 1, at: 1.5 }, { from: 1, to: 2, at: 2.5 }], duration: 5 });
  doc.getElementById('w')!.appendChild(b.el);
  deterministic(b, [3, 0, 4.5, 1.2]);
  assert.equal(b.cards.length, 3);
  assert.equal(b.cords.length, 2);
  validEvents(b.events);
  assert.ok(JSON.parse(b.el.getAttribute('data-cues')!).length === b.events.length, 'the kit hands its cues to the frame');
});

test('frontPage: a page that arrives, a headline that lands, each with a sound', () => {
  const doc = dom();
  const f = nk.frontPage(doc, { masthead: 'THE PAPER', date: 'A date', photo: media('A1'), headline: 'Words that land', deck: 'A deck', at: 0.2, landAt: 0.9, duration: 5 });
  doc.getElementById('w')!.appendChild(f.el);
  deterministic(f, [2, 0.3, 4, 1]);
  validEvents(f.events);
  assert.ok(f.events.some((e) => e.t === 0.2 && /newspaper/.test(e.what ?? '')));
  assert.ok(f.events.some((e) => e.kind === 'impact'));
  assert.ok(f.el.querySelector('[data-name="headline"]'));
  assert.ok(frontHeadlineSize('Short') > frontHeadlineSize('A much longer headline that takes up the entire front page of the paper'));
});

test('the close: white, logo at the centre, the wordmark writes itself, deterministic', () => {
  const doc = dom();
  const host = doc.getElementById('w')!;
  closeModule.build(host, { nk, assets: 'assets/' });
  closeModule.render(1.2);
  const a = host.innerHTML;
  closeModule.render(2.4);
  closeModule.render(0);
  closeModule.render(1.2);
  assert.equal(host.innerHTML, a);
  assert.equal(GROUND, '#FFFFFF');
  assert.equal(WORDMARK, 'Reel AI Drama');
  assert.equal(LOGO.cx, 540);
  assert.ok(WORD_BASELINE > LOGO.cy, 'the wordmark sits beneath the logo');
  assert.match(host.innerHTML, /kit\/Helios-logo\.png/);
});

test('close timing: the fade, then the logo, then the wordmark, all inside the close; every sound inside it', () => {
  assert.equal(CLOSE.duration, 2.5);
  assert.ok(CLOSE.fade[1] > CLOSE.logoIn[0] - 0.2, 'the logo arrives as the white settles');
  assert.ok(CLOSE.logoIn[1] <= CLOSE.write[0] + 0.05);
  assert.ok(CLOSE.write[1] < CLOSE.duration);
  assert.ok(CLOSE.maxQuestion < CLOSE.duration);
  assert.ok(CLOSE_EVENTS.length >= 3 && CLOSE_EVENTS.every((e) => e.t >= 0 && e.t + (e.dur ?? 0) <= CLOSE.duration));
  assert.ok(CLOSE_EVENTS.some((e) => e.t < CLOSE.fade[1]), 'the transition itself has a sound');
  assert.ok(CLOSE_EVENTS.some((e) => /pencil|pen/.test(e.what ?? '')), 'the writing is heard');
});

test('the close is light: captions set in ink', () => {
  assert.ok(LIGHT_TREATMENTS.has('close'));
});

const BOARD = ['# Storyboard', '', '## Frame 01 — a', '- treatment: photo', '- transition_in: cut', '', '## Frame 02 — b', '- treatment: photo', '- transition_in: cut', '', '## Frame 03 — close', '- treatment: close', '- transition_in: cut', ''].join('\n');

test('withCloseFade: only the close changes; idempotent', () => {
  const after = withCloseFade(BOARD);
  assert.equal(after.split(`- transition_in: ${CLOSE_FADE}`).length, 2);
  assert.equal(after.split('- transition_in: cut').length, 3);
  assert.ok(after.indexOf(CLOSE_FADE) > after.indexOf('Frame 03'));
  assert.equal(withCloseFade(after), after);
  const noClose = BOARD.replace('- treatment: close', '- treatment: photo');
  assert.equal(withCloseFade(noClose), noClose);
});

test('frames.mjs writes the close: its module, its sounds, its fade', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iter8-close-'));
  try {
    writeClose(root, { id: '03-close' });
    assert.match(fs.readFileSync(path.join(root, 'assets', 'frames', '03-close.js'), 'utf8'), /close/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'assets', 'frames', '03-close.events.json'), 'utf8')), CLOSE_EVENTS);
    fs.writeFileSync(path.join(root, 'STORYBOARD.md'), BOARD);
    writeCloseFade(root);
    assert.match(fs.readFileSync(path.join(root, 'STORYBOARD.md'), 'utf8'), /crossfade/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the guides: every move documented; shots built with cuts; nothing from the notes as an example', () => {
  const guide = fs.readFileSync(path.join(KIT, 'FRAME.md'), 'utf8');
  for (const name of ['flashReveal', 'phoneShot', 'clickReveal', 'burst', 'speech', 'cuts', 'cueAt', 'drawnLogo', 'playersBoard', 'frontPage']) {
    assert.ok(guide.includes(`nk.${name}`), `FRAME.md documents nk.${name}`);
    assert.ok(typeof nk[name] === 'function', `nk.${name} exists`);
  }
  for (const banned of [/fireplace/i, /amazon/i, /\bsiri\b/i, /ballet/i, /\$\d/]) assert.doesNotMatch(guide, banned);
  assert.doesNotMatch(guide, /dark ground\.\s*The comment question/, 'the old close is gone');
});
