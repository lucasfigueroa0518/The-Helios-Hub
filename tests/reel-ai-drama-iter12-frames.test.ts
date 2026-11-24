import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import * as compiled from '../explainers/reel-ai-drama/kit/components/compiled.js';
import { logoGround } from '../explainers/reel-ai-drama/kit/components/stage.js';
import { projectMedia } from '../explainers/reel-ai-drama/kit/frames.mjs';
import * as layout from '../explainers/reel-ai-drama/kit/stage-layout.js';
import { placeOf, parseLooks, SUBMIT_LOOKS_TOOL } from '../lib/reel-ai-drama/harvest/look';
import { placeNamed } from '../lib/reel-ai-drama/harvest/places';

// The kit is plain JS, its option shapes inferred from defaults: the tests hand it real data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { compiledOptions, frameLabels, labelParts, nameSaidAt, OLD_PHOTO_YEARS, photoDate, photoLabel, wordsAt } = compiled as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { numberLines, showsOnlyLogo, solveTimeline } = layout as any;

const said = (text: string, t0 = 0) => text.split(' ').map((w, i) => ({ text: w, start: t0 + i * 0.4, end: t0 + i * 0.4 + 0.35 }));
const person = (name: string, extra = {}) => ({ id: name, kind: 'person_photo', width: 1000, height: 1400, people: [name], shows: `${name} at a desk.`, flags: ['cutout'], ...extra });
const cueAt = (words: { text: string; start: number }[], phrase: string) => {
  const at = words.findIndex((w) => w.text.toLowerCase() === phrase.split(' ')[0].toLowerCase());
  return at < 0 ? null : words[at].start;
};
const labelsOf = frameLabels;

test('the audited name label lands when the voice says the name, not when its line starts', () => {
  const words = said('and then the chief executive Ada Lovelace stood up');
  const [l] = labelsOf({ lines: [{ label: 'Ada Lovelace, Example CEO', start: 0 }], pieces: [{ id: 'a', media: person('Ada Lovelace'), at: 0 }], words });
  assert.equal(l.text, 'Ada Lovelace');
  assert.equal(l.sub, 'Example CEO');
  assert.equal(l.for, 'a');
  assert.equal(l.at, words[5].start);
});

test('a surname said later still counts, possessive too; a name never said gets no label', () => {
  assert.equal(nameSaidAt(said("then Lovelace's plan"), 'Ada Lovelace'), 0.4);
  const reports: string[] = [];
  const out = labelsOf({ lines: [{ label: 'Ada Lovelace, CEO', start: 0 }], pieces: [{ id: 'a', media: person('Ada Lovelace'), at: 0 }], words: said('nobody says it'), report: (r: string) => reports.push(r) });
  assert.deepEqual(out, []);
  assert.match(reports[0], /label_cut.*does not say/);
});

test('a name only shows while the person is on screen', () => {
  const words = said('one two three four five six seven eight Ada Lovelace');
  const out = labelsOf({ lines: [{ label: 'Ada Lovelace, CEO' }], pieces: [{ id: 'a', media: person('Ada Lovelace'), at: 0, until: 1 }], words });
  assert.deepEqual(out, []);
});

test('every date and every fact label the audit cut is gone', () => {
  const words = said('in February 2010 the deadline was August 15 and in April he spoke');
  const reports: string[] = [];
  const out = labelsOf({
    lines: [{ label: 'February 2010', label_kind: 'date' }, { label: 'Deadline: Aug 15, 6 p.m. Pacific' }, { label: 'April 2025', label_kind: 'date' }],
    pieces: [{ id: 'a', media: person('Ada Lovelace'), at: 0 }],
    words,
    report: (r: string) => reports.push(r),
  });
  assert.deepEqual(out, []);
  assert.equal(reports.length, 3);
});

test('a small word on a piece goes by the same rule; a logo never takes one; a number stays', () => {
  const out = labelsOf({
    blueprint: { labels: [{ text: 'A surprise', for: 'a', on: '' }, { text: '$3 billion', kind: 'number', on: '' }] },
    pieces: [{ id: 'a', media: person('Ada Lovelace'), at: 0, label: 'Old system' }, { id: 'l', media: { id: 'l', kind: 'logo', shows: 'The Example Firm logo', width: 10, height: 10 }, at: 0, label: 'Example Firm' }],
    words: said('nothing here'),
  });
  assert.deepEqual(out.map((l: { text: string }) => l.text), ['$3 billion']);
});

test('a person is named once: an earlier frame owns the name', () => {
  const media = person('Ada Lovelace', { named_in: { 'Ada Lovelace': 3 } });
  const words = said('Ada Lovelace again');
  assert.equal(labelsOf({ lines: [{ label: 'Ada Lovelace, CEO' }], pieces: [{ id: 'a', media, at: 0 }], words, frame: 5 }).length, 0);
  assert.equal(labelsOf({ lines: [{ label: 'Ada Lovelace, CEO' }], pieces: [{ id: 'a', media, at: 0 }], words, frame: 3 }).length, 1);
  assert.equal(labelsOf({ blueprint: { labels: [] }, lines: [], pieces: [{ id: 'a', media, at: 0 }], words, frame: 3 })[0].text, 'Ada Lovelace', 'the first naming needs no one to ask');
  assert.equal(labelsOf({ lines: [{ label: 'Ada Lovelace' }], pieces: [{ id: 'a', media: person('Ada Lovelace'), at: 0 }], words, known: ['Ada Lovelace'] }).length, 0);
});

const photo = (extra = {}) => ({ id: 'P', kind: 'event_photo', width: 2000, height: 1400, people: [], shows: 'A crowd in a hall.', flags: ['date_basis:exif'], date_taken: '2013-05-25', date_confidence: 'exact', age_years: 13, ...extra });

test('a photo\'s date: its year when exact or approximate, nothing without a basis', () => {
  assert.equal(photoDate(photo()), '2013');
  assert.equal(photoDate(photo({ date_confidence: 'approximate', date_taken: '2011', flags: ['date_basis:commons'] })), '2011');
  assert.equal(photoDate(photo({ date_confidence: 'unknown', date_taken: null })), null);
  assert.equal(photoDate(photo({ flags: ['date_basis:article'] })), null, 'the date an article ran is not the date of the photo');
  assert.equal(photoDate(photo({ kind: 'screenshot', flags: ['date_basis:capture'] })), null, 'a screenshot carries its capture date');
});

test('dating needs a full-screen photo, old enough, at its first showing', () => {
  assert.deepEqual(photoLabel(photo(), { fullScreen: true }), { text: 'File photo · 2013' });
  assert.equal(photoLabel(photo(), { fullScreen: false }), null);
  assert.equal(photoLabel(photo({ age_years: OLD_PHOTO_YEARS - 0.5 }), { fullScreen: true }), null);
  assert.equal(photoLabel(photo({ first_frame: 2 }), { fullScreen: true, frame: 6 }), null);
  assert.deepEqual(photoLabel(photo({ first_frame: 6 }), { fullScreen: true, frame: 6 }), { text: 'File photo · 2013' });
});

test('a place photo says its place; who shows only confirmed and not otherwise clear', () => {
  assert.deepEqual(photoLabel(photo({ kind: 'place_photo', place: 'Example Campus', age_years: 1 }), { fullScreen: true }), { text: 'Example Campus' });
  assert.deepEqual(photoLabel(photo({ kind: 'place_photo', place: 'Example Campus' }), { fullScreen: true }), { text: 'Example Campus', sub: 'File photo · 2013' });
  assert.equal(photoLabel(photo({ kind: 'place_photo', place: null, date_taken: null, date_confidence: 'unknown' }), { fullScreen: true }), null, 'never guessed');
  const who = photo({ people: ['Ada Lovelace'], kind: 'person_photo' });
  assert.deepEqual(photoLabel(who, { fullScreen: true }), { text: 'Ada Lovelace', sub: 'File photo · 2013' });
  assert.deepEqual(photoLabel(who, { fullScreen: true, clearWho: true }), { text: 'File photo · 2013' });
  assert.deepEqual(photoLabel({ ...who, shows: 'A man; captioned as Ada Lovelace, not confirmed.' }, { fullScreen: true }), { text: 'File photo · 2013' });
});

test('a photo label is owned by the photo, so it arrives and leaves with it', () => {
  const words = said('a quiet hall full of people');
  const { options } = compiledOptions({ treatment: 'photo', blueprint: { pieces: [{ id: 'p', asset: 'P', on: 'hall', until: 'people' }, { id: 'q', asset: 'Q', on: 'people' }], labels: [] } }, { media: { P: photo(), Q: photo({ id: 'Q', date_taken: null, date_confidence: 'unknown' }) }, words, duration: 6, cueAt });
  const label = options.labels.find((l: { text: string }) => l.text === 'File photo · 2013');
  assert.equal(label.kind, 'photo');
  assert.equal(label.for, 'p');
  const t = solveTimeline({ pieces: [{ id: 'p', aspect: 1.4, at: 1, until: 4 }], labels: [{ id: 'x', text: 'File photo · 2013', kind: 'photo', owner: 'p', at: 1 }], duration: 6 });
  assert.equal(t.labelTimes.x.until, 4, 'it leaves with the photo, not after a beat');
});

test('labelParts splits a name from its role and leaves a bare name alone', () => {
  assert.deepEqual(labelParts('Ada Lovelace, Example CEO'), { head: 'Ada Lovelace', role: 'Example CEO' });
  assert.deepEqual(labelParts('Ada Lovelace'), { head: 'Ada Lovelace', role: null });
});

test('anything shown gets a minimum hold; a leaving word too soon waits', () => {
  const words = said('one two three four five');
  const { options, reports } = compiledOptions({ treatment: 'x', blueprint: { pieces: [{ id: 'a', treatment: 'number', opts: { value: '9' }, on: 'one', until: 'two' }], labels: [] } }, { words, duration: 6, cueAt });
  assert.ok(options.pieces[0].until - options.pieces[0].at >= 1.2);
  assert.ok(reports.some((r: string) => r.startsWith('piece_held')));
});

test('a long number breaks where its lines come out even; a short one stays on one line', () => {
  assert.deepEqual(numberLines('three billion'), ['three', 'billion']);
  assert.deepEqual(numberLines('$3 billion'), ['$3', 'billion']);
  assert.deepEqual(numberLines('$34B'), ['$34B']);
  assert.deepEqual(numberLines('1234567890123'), ['1234567890123']);
});

test('a thin label cannot slip between a number\'s sampled points', () => {
  const t = solveTimeline({ pieces: [{ id: 'n', kind: 'words', aspect: 3.4, at: 0, treatment: 'number', opts: { value: '$3B' } }], labels: [{ id: 'x', text: 'A frame word of some length', at: 0 }], duration: 6 });
  const final = t.moments[0];
  const n = final.pieces.find((p: { id: string }) => p.id === 'n');
  const l = final.labels[0];
  if (l) assert.ok(l.y + l.h <= n.y || l.y >= n.y + n.h || l.x + l.w <= n.x || l.x >= n.x + n.w, JSON.stringify({ l, n }));
});

test('a picture filed as a photo that only shows a mark is a logo; a building with a sign isn\'t', () => {
  assert.equal(showsOnlyLogo({ shows: 'The Example wordmark with its icon on a dark background; no person shown.', people: ['Ada Lovelace'], kind: 'event_photo' }), true);
  assert.equal(showsOnlyLogo({ shows: 'Building 9 with an Example logo sign at the entrance.', people: [], kind: 'place_photo' }), false);
  assert.equal(showsOnlyLogo({ shows: 'Ada Lovelace beside the Example logo.', people: ['Ada Lovelace'], kind: 'event_photo' }), false);
});

test('a lone flat picture moves in steps; a picture sharing the frame keeps its own camera', () => {
  const regions = { faces: [{ x: 0.4, y: 0.2, w: 0.2, h: 0.2, trusted: true }], sharp_width_px: 4000 };
  const print = { id: 'p', media: { id: 'p', kind: 'event_photo', width: 2000, height: 1400, people: [], regions, flags: [] }, at: 0 };
  const lone = solveTimeline({ pieces: [print], camera: { move: 'push', stops: [{ at: 0, aim: 'whole' }] }, duration: 7 });
  const scales = lone.camera.poses.map((p: { s: number }) => p.s);
  assert.ok(lone.camera.poses.length >= 2, 'in steps');
  assert.ok(Math.max(...scales) >= Math.min(...scales) * 1.1, `a real move: ${scales}`);
  const shared = solveTimeline({ pieces: [print, { id: 'c', kind: 'note', note: 'hello there', at: 0 }], camera: { move: 'push', stops: [{ at: 0, aim: 'whole' }] }, duration: 7 });
  assert.equal(shared.camera.poses.length, 1);
});

const toneLogo = (cells: string, w = 4) => ({ regions: { tone: { w, h: cells.length / w, cells } } });

test('a logo\'s ground comes from its own brightness, and it is never a card', () => {
  const dark = toneLogo('.22..22..22..22.');
  assert.deepEqual(logoGround(dark, 0.9), { plate: false, ink: null, pool: null }, 'dark on light reads as it is');
  assert.equal(logoGround(dark, 0.1).pool?.tone, 0.92, 'dark on dark takes a pool of light');
  const light = toneLogo('.ee..ee..ee..ee.');
  assert.equal(logoGround(light, 0.92).pool?.tone, 0.12, 'light on light takes a pool of dark');
  assert.match(logoGround(dark, 0.1, true).ink ?? '', /invert/, 'one colour takes the ink that reads');
  const mixed = toneLogo('.ff..ff..11..11.');
  assert.equal(logoGround(mixed, 0.2).pool?.tone, 0.5, 'light and dark parts both read on a middle tone');
});

test('a logo that kept its plate fades into the ground, lifted when the plate is dark on dark', () => {
  assert.equal(logoGround({ regions: { chip: true } }, 0.1).plate, true);
  const dim = logoGround(toneLogo('1111222211112222'), 0.1);
  assert.equal(dim.plate, true);
  assert.match(dim.ink ?? '', /brightness/);
  assert.equal(logoGround(toneLogo('ffffffffffffffff'), 0.1).ink, null);
});

test('harvest: the look states a place only when shows names one', () => {
  assert.ok((SUBMIT_LOOKS_TOOL.input_schema.required as readonly string[]).includes('tiles'));
  const looks = parseLooks({ tiles: [{ tile: 1, shows: 'A campus in Redmond.', place: 'Redmond campus. ' }, { tile: 2, shows: 'A desk.', place: '' }, { tile: 3, shows: 'A hall.', place: 'unknown' }] }, 3);
  assert.equal(placeOf(looks.get(0)), 'Redmond campus');
  assert.equal(placeOf(looks.get(1)), null);
  assert.equal(placeOf(looks.get(2)), null);
  assert.equal(placeNamed('x'.repeat(61)), null);
});

test('wordsAt still reports a word the voice does not say', () => {
  const reports: string[] = [];
  const at = wordsAt({ words: said('one two'), lines: [{ start: 0.5 }], cueAt, report: (r: string) => reports.push(r) });
  assert.equal(at('nine', 'x'), 0.5);
  assert.equal(reports.length, 1);
});

// ── Replay: the three stored reels (local only; skipped where they aren't on disk) ─────────────────────
const JOBS = '.explainers-local/reel-ai-drama/jobs';
const REELS = ['34d7446b-c3ae-46e1-94e1-a272e4f08bc9', '5ebc20ef-8a44-47c3-91e9-9bd0fd246be6', '2a98cfa0-0569-4244-bb51-61d86157b78f'];
const AUDIT_KEPT = ['Dag Kittlaus', 'Adam Cheyer', 'Amit Mehta', 'Aravind Srinivas', 'Sundar Pichai', 'Geoffrey Hinton', 'Li Deng', 'Navdeep Jaitly', 'Vincent Vanhoucke'];
const AUDIT_CUT = ['February 2010', 'April 2010', 'October 2011', 'August 12, 2025', 'September 2, 2025', 'April 2025', '2010–2011', 'November 2012', 'Deadline: Aug 15, 6 p.m. Pacific'];

test('replay: the 18 audited labels behave as ALIGN §5 says, each name landing on its spoken word', { skip: !REELS.every((j) => existsSync(join(JOBS, j))) }, async () => {
  const kept: string[] = [];
  const cut: string[] = [];
  for (const job of REELS) {
    const root = join(JOBS, job, 'render', 'project');
    const media = projectMedia(root);
    for (const file of readdirSync(join(root, 'assets', 'frames')).filter((f) => f.endsWith('.js')).sort()) {
      const code = readFileSync(join(root, 'assets', 'frames', file), 'utf8');
      const start = code.indexOf('compiledFrame({');
      if (start < 0) continue;
      const open = start + 'compiledFrame('.length;
      const close = code.indexOf('\n}', open) + 2;
      const spec = JSON.parse(code.slice(open, close));
      const id = file.slice(0, -3);
      const timing = JSON.parse(readFileSync(join(root, 'assets', 'timing', `${id}.json`), 'utf8'));
      const { options, reports } = compiledOptions(spec, { media, words: timing.words, lines: timing.lines, duration: timing.duration ?? 6, cueAt, ctx: { id } });
      for (const line of timing.lines ?? []) {
        if (!line.label) continue;
        const { head } = labelParts(line.label);
        const shown = options.labels.find((l: { text: string }) => l.text === head);
        if (!shown) { cut.push(line.label); continue; }
        kept.push(head);
        assert.equal(shown.at, nameSaidAt(timing.words, head), `${head} lands on the word`);
      }
      for (const l of options.labels) assert.ok(l.kind !== 'date', `${l.text} is no date label`);
      assert.ok(reports.every((r: string) => !r.startsWith('stage_failed')));
    }
  }
  assert.deepEqual([...kept].sort(), [...AUDIT_KEPT].sort());
  assert.deepEqual([...cut].sort(), [...AUDIT_CUT].sort());
});
