import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cueAt } from '../explainers/reel-ai-drama/kit/components/moves.js';
import * as hookPlan from '../explainers/reel-ai-drama/kit/hooks/plan.js';
import { eventProblems, eventsToCues, mixArgs, resolveCues, yieldToDesign } from '../explainers/reel-ai-drama/kit/sound.mjs';
import { sourceProblems } from '../explainers/reel-ai-drama/kit/try.mjs';
import { CHARGED_BY_WORD, chargedStart, chargedWords, codeHook, faceTooClose, frontPageBackup, headlineIsVerbatim, headlineOf, hookOptions, identityUnconfirmed, realHeadlines, resolveHook, usableImage, type HookOption } from '../lib/reel-ai-drama/hooks/eligibility';
import { onsetSeconds, peakDb, PEAK_DB } from '../lib/reel-ai-drama/hooks/normalize-sound.mjs';
import { acceptTouches, compileReel, hookModule, readTouches, withOnScreen } from '../lib/reel-ai-drama/render/compile';
import { checkPlanCarried } from '../lib/reel-ai-drama/render/plan-carried';
import type { Asset, DirectorPlan, HookChoice, HookId, SourceRef, VisualsInventory } from '../lib/reel-ai-drama/types';

// The kit is plain JavaScript, and its inferred types are narrower than what it takes.
const { SCREENS, SFX_NAMES, SFX_SECONDS, beatTimes, coverCrop, fullFrameLook, planHook, screenTreatments, wallCells } = hookPlan as any;
const hookScore = hookPlan.hookScore as unknown as (plan: unknown) => { t: number; src: string; level_db: number; dur?: number }[];

const KIT_HOOKS = path.join(process.cwd(), 'explainers', 'reel-ai-drama', 'kit', 'hooks');
const LINE = 'The founders turned him down flat, and weeks later the company owned the whole thing for $34.5 billion in cash.';
const WORDS = LINE.split(' ').map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35 }));

let serial = 0;
function asset(over: Partial<Asset> = {}): Asset {
  serial += 1;
  return {
    id: `V${serial}`, kind: 'person_photo', file: `assets/media/V${serial}.jpg`, url: null, source_page: null, credit: '', license: null,
    shows: 'A person speaking on a stage.', people: ['Ana Ruiz'], qids: [], place: null, date_taken: null, date_confidence: 'unknown',
    width: 2000, height: 1500, phash: `p${serial}`, character_image: false, made: false, upscaled: false, flags: ['identity:verified'],
    face: { x: 0.45, y: 0.25, w: 0.12, h: 0.2 }, made_kind: null, regions: { sharp_width_px: 2400, phash: `p${serial}` } as never, ...over,
  } as Asset;
}
const inventory = (assets: Asset[]): VisualsInventory => ({ assets, usable_count: assets.length, counts: {}, kill: null, usd: 0 });
const place = (over: Partial<Asset> = {}) => asset({ kind: 'place_photo', people: [], face: null, flags: [], shows: 'A building by a river.', ...over });
const SOURCE: SourceRef = { url: 'https://news.example.com/a', title: 'A startup offers to buy the whole company | Example News', publisher: 'Example News', date: null };
const rich = () => inventory([
  asset(), asset(), asset(), asset(),
  place({ date_taken: '2011', date_confidence: 'exact' }), place({ date_taken: '2015', date_confidence: 'approximate' }), place({ date_taken: '2019', date_confidence: 'exact' }),
  asset({ kind: 'logo', people: [], face: null, flags: ['logo'], shows: 'A logo.', width: 960, height: 960 }),
]);
const ids = (o: HookOption[]) => o.map((x) => x.id).sort();

test('a usable image is large enough, not unconfirmed, and its face is not too close', () => {
  assert.equal(usableImage(asset()), true);
  assert.equal(usableImage(asset({ width: 500, height: 400 })), false);
  assert.equal(identityUnconfirmed({ shows: 'A man on stage; captioned as a founder, not confirmed.' }), true);
  assert.equal(usableImage(asset({ shows: 'A man on stage; captioned as a founder, not confirmed.' })), false);
  assert.equal(faceTooClose({ face: { x: 0.1, y: 0.1, w: 0.5, h: 0.62 } }), true);
  assert.equal(usableImage(asset({ face: { x: 0.1, y: 0.1, w: 0.5, h: 0.62 } })), false);
  assert.equal(usableImage(asset({ character_image: true })), false);
  assert.equal(usableImage(asset({ made: true })), false);
});

test('every primary hook is offered when its gate passes; Front Page only as a backup', () => {
  assert.deepEqual(ids(hookOptions(rich(), [SOURCE])), ['burn', 'darkroom', 'flashbulb', 'lock_on', 'rewind', 'slide_carousel', 'wall_of_screens']);
  assert.equal(frontPageBackup(rich(), [SOURCE])?.id, 'front_page');
  assert.equal(frontPageBackup(rich(), []), null, 'no source, no front page');
});

test('the fallback chain: three-image wall, then Front Page, then Darkroom', () => {
  // Two usable images, one source: no primary hook but Darkroom qualifies, and Front Page comes before it.
  const two = inventory([asset(), place()]);
  const opts = hookOptions(two, [SOURCE]);
  const pick = resolveHook(null, opts.filter((o) => o.id === 'darkroom'), { inventory: two, sources: [SOURCE], words: LINE }) as HookChoice;
  assert.equal(pick.id, 'front_page');
  assert.equal(pick.fallback, 'front_page');
  assert.deepEqual(resolveHook(pick, opts, { inventory: two, sources: [SOURCE], words: LINE })?.id, 'front_page', 'a resolved backup stays');
  assert.equal((resolveHook(null, opts.filter((o) => o.id === 'darkroom'), { inventory: two, sources: [], words: LINE }) as HookChoice).id, 'darkroom');
  const picked = resolveHook({ ...pick, fallback: undefined }, opts, { inventory: two, sources: [SOURCE], words: LINE }) as HookChoice;
  assert.ok(picked.flags?.some((f) => f.includes("doesn't have the assets")), 'the director cannot pick it');
});

test('each gate removes its hook when its assets are missing', () => {
  const none = hookOptions(inventory([asset(), asset(), place()]), []);
  assert.deepEqual(ids(none), ['burn', 'darkroom', 'lock_on'], 'three images: no wall, carousel, flashbulb (two of one person), rewind or front page');
  assert.ok(!ids(hookOptions(rich(), [])).includes('front_page'), 'no source, no front page');
  assert.ok(!ids(hookOptions(inventory([asset({ flags: [] })]), [])).includes('darkroom'), 'no confirmed photo, no darkroom');
  const closeUps = inventory([1, 2, 3].map(() => asset({ face: { x: 0.3, y: 0.2, w: 0.4, h: 0.45 } })));
  assert.ok(!ids(hookOptions(closeUps, [])).includes('lock_on'), 'no photo wide enough to zoom into');
  const texty = inventory([asset({ flags: ['text_heavy', 'identity:verified'] }), asset({ flags: ['text_heavy', 'identity:verified'] })]);
  assert.ok(!ids(hookOptions(texty, [])).includes('burn'), 'baked-in text');
  const sameYear = inventory([place({ date_taken: '2015', date_confidence: 'exact' }), place({ date_taken: '2015', date_confidence: 'exact' }), place({ date_taken: '2016', date_confidence: 'exact' })]);
  assert.ok(!ids(hookOptions(sameYear, [])).includes('rewind'), 'needs three different dates');
});

test('headlines are real and verbatim, never invented', () => {
  assert.equal(headlineOf(SOURCE), 'A startup offers to buy the whole company');
  assert.equal(headlineOf({ title: 'Google Chrome - Wikipedia', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/x' }), null);
  assert.equal(realHeadlines([SOURCE, SOURCE]).length, 1, 'no repeats');
  assert.equal(headlineIsVerbatim({ text: 'A startup offers to buy the whole company' }, [SOURCE]), true);
  assert.equal(headlineIsVerbatim({ text: 'A startup buys the whole company' }, [SOURCE]), false);
  const inv = rich();
  const options = hookOptions(inv, [SOURCE]);
  const fp = frontPageBackup(inv, [SOURCE]) as HookOption;
  const made = resolveHook({ id: 'front_page', fallback: 'front_page', beats: fp.assets.slice(0, 2).map((asset) => ({ asset, on: '' })), charged: 'weeks later', headlines: [{ text: 'An invented scandal engulfs everyone', publisher: 'x', url: 'x' }] }, options, { inventory: inv, sources: [SOURCE], words: LINE }) as HookChoice;
  assert.equal(made.headlines?.[0].text, 'A startup offers to buy the whole company');
  assert.ok(made.flags?.some((f) => f.includes("isn't in any source")));
});

test('resolveHook keeps a valid choice as it is', () => {
  const inv = rich();
  const options = hookOptions(inv, [SOURCE]);
  const burn = options.find((o) => o.id === 'burn') as HookOption;
  const choice: HookChoice = { id: 'burn', beats: burn.assets.slice(0, 2).map((asset, i) => ({ asset, on: ['founders', 'weeks'][i] })), charged: 'weeks later' };
  assert.deepEqual(resolveHook(choice, options, { inventory: inv, sources: [SOURCE], words: LINE }), choice);
});

test('resolveHook drops assets outside the option and tops up from it', () => {
  const inv = rich();
  const options = hookOptions(inv, [SOURCE]);
  const lock = options.find((o) => o.id === 'flashbulb') as HookOption;
  const got = resolveHook({ id: 'flashbulb', beats: [{ asset: 'NOPE', on: 'founders' }, { asset: lock.assets[0], on: 'weeks' }], charged: 'weeks later' }, options, { inventory: inv, sources: [], words: LINE }) as HookChoice;
  assert.equal(got.id, 'flashbulb');
  assert.ok(got.beats.length >= 3 && got.beats.every((b) => b.asset !== 'NOPE'));
  assert.ok(got.flags?.some((f) => f.includes('NOPE')));
  const over = resolveHook({ id: 'burn', beats: (options.find((o) => o.id === 'burn') as HookOption).assets.map((asset) => ({ asset, on: '' })), charged: 'x y' }, options, { inventory: inv, sources: [], words: LINE }) as HookChoice;
  assert.ok(over.beats.length <= 4);
  assert.notEqual(over.charged, 'x y', 'charged words must be spoken');
});

test('an ineligible or missing choice becomes the code\'s, with a flag', () => {
  const inv = inventory([asset(), place(), place(), place(), place(), place()]);
  const options = hookOptions(inv, []);
  assert.ok(!options.some((o) => o.id === 'flashbulb'));
  const swapped = resolveHook({ id: 'flashbulb', beats: [], charged: 'weeks' }, options, { inventory: inv, sources: [], words: LINE }) as HookChoice;
  assert.ok(options.some((o) => o.id === swapped.id));
  assert.ok(swapped.flags?.length);
  const missing = resolveHook(null, options, { inventory: inv, sources: [], words: LINE }) as HookChoice;
  assert.ok(missing && missing.flags?.length);
});

test('the fallback chain: three images on the wall, then a darkroom print, then the blueprint', () => {
  const three = inventory([asset({ flags: [], face: { x: 0.3, y: 0.2, w: 0.4, h: 0.45 } }), place({ flags: ['text_heavy'] }), place({ flags: ['text_heavy'] })]);
  const a = resolveHook(null, hookOptions(three, []), { inventory: three, sources: [], words: LINE }) as HookChoice;
  assert.equal(a.id, 'wall_of_screens');
  assert.equal(a.fallback, 'wall_of_screens_3');
  assert.equal(a.beats.length, 3);
  assert.ok(a.flags?.length);

  const one = inventory([asset({ face: { x: 0.3, y: 0.2, w: 0.4, h: 0.45 } })]);
  const b = resolveHook(null, hookOptions(one, []), { inventory: one, sources: [], words: LINE }) as HookChoice;
  assert.equal(b.id, 'darkroom');
  assert.equal(b.fallback, 'darkroom');

  const nothing = inventory([asset({ shows: 'Captioned as someone; not confirmed.' })]);
  assert.equal(resolveHook(null, hookOptions(nothing, []), { inventory: nothing, sources: [], words: LINE }), null);
});

test('Darkroom prints only confirmed people; a screen capture tagged as a photo is never one', () => {
  const screen = (over: Partial<Asset> = {}) => asset({ kind: 'event_photo', people: [], face: null, flags: ['text_heavy', 'faces:0'], shows: 'A search results page.', ...over });
  const shots = inventory([screen(), screen(), place()]);
  assert.equal(hookOptions(shots, []).some((o) => o.id === 'darkroom'), false, 'no confirmed person: no Darkroom');
  const withPerson = inventory([screen(), place(), asset()]);
  const dark = hookOptions(withPerson, []).find((o) => o.id === 'darkroom') as HookOption;
  assert.deepEqual(dark.assets, [withPerson.assets[2]!.id], 'the screenshot and the unnamed place photo are not prints');
});

test('the hit lands within 2.5 s: charged words start within the first seven spoken words', () => {
  assert.equal(CHARGED_BY_WORD, 7);
  assert.equal(chargedWords('Google paid $2.7 billion to rehire one man.'), '$2.7 billion');
  assert.equal(chargedStart(LINE, '$34.5 billion'), 16);
  assert.ok(chargedStart(LINE, chargedWords(LINE)) <= CHARGED_BY_WORD, 'a late figure is passed over for earlier words');
  const opts = hookOptions(rich(), [SOURCE]).filter((o) => o.id === 'burn');
  const late = resolveHook({ id: 'burn', beats: [], charged: '$34.5 billion' } as HookChoice, opts, { inventory: rich(), sources: [SOURCE], words: LINE }) as HookChoice;
  assert.notEqual(late.charged, '$34.5 billion');
  assert.ok(late.flags?.some((f) => f.includes('2.5 s')));
});

test('charged words are always spoken', () => {
  assert.ok(LINE.includes(chargedWords(LINE)));
  assert.ok('He left, and the room went quiet'.includes(chargedWords('He left, and the room went quiet')));
  assert.equal(chargedWords(''), '');
});

// ── Plans and scores ────────────────────────────────────────────────────────────────────────────

const mediaOf = (inv: VisualsInventory) => Object.fromEntries(inv.assets.map((a) => [a.id, a]));
const plan = (choice: HookChoice, inv: VisualsInventory, duration = 8, words = WORDS) => planHook(choice, { media: mediaOf(inv), words, duration, cueAt, years: Object.fromEntries(inv.assets.flatMap((a) => (a.date_taken ? [[a.id, Number(a.date_taken)]] : []))) });
const count = (cues: { src: string }[], name: string) => cues.filter((c: { src: string }) => c.src.endsWith(`/${name}.mp3`)).length;

test('a missing word spreads evenly instead of failing, and beats stay in order', () => {
  const beats = [{ asset: 'a', on: 'founders' }, { asset: 'b', on: 'nothing like this' }, { asset: 'c', on: 'weeks' }, { asset: 'd', on: '' }];
  const reports: string[] = [];
  const t = beatTimes(beats, { words: WORDS, duration: 8, cueAt, report: (r: string) => reports.push(r) });
  assert.ok(Math.abs(t[0] - (cueAt(WORDS, 'founders') as number)) < 0.002);
  assert.ok(Math.abs(t[2] - (cueAt(WORDS, 'weeks') as number)) < 0.002);
  assert.ok(t[1] > t[0] && t[1] < t[2]);
  assert.ok(t[3] > t[2]);
  assert.ok(reports.some((r) => r.includes('nothing like this')));
});

const every = (): [HookId, VisualsInventory, HookChoice][] => {
  const inv = rich();
  return hookOptions(inv, [SOURCE]).map((o) => [o.id, inv, codeHook(o, { inventory: inv, words: LINE })]);
};

for (const [label, duration, words] of [
  ['a short line', 2.4, WORDS.slice(0, 6)],
  ['a normal line', 8, WORDS],
  ['a long line', 14, LINE.concat(' ', LINE).split(' ').map((text, i) => ({ text, start: i * 0.33, end: i * 0.33 + 0.3 }))],
] as const) {
  test(`every hook plans and scores on ${label}, inside the frame`, () => {
    for (const [id, inv, choice] of every()) {
      const p = plan(choice, inv, duration, words as typeof WORDS);
      const score = hookScore(p);
      assert.ok(score.length > 0, `${id} has sound`);
      assert.deepEqual(eventProblems(score, duration), [], `${id}'s score is valid`);
      for (const c of score) assert.ok(c.t >= 0 && c.t < duration, `${id}: cue at ${c.t}`);
    }
  });
}

test('every visible move or step has a sound', () => {
  for (const [id, inv, choice] of every()) {
    const p = plan(choice, inv) as never as Record<string, never[]> & { id: string };
    const s = hookScore(p);
    if (id === 'flashbulb') assert.equal(count(s, 'shutter'), (p.shots as never[]).length + (p.later as never[]).length, 'a shutter on every picture and every later flash');
    if (id === 'wall_of_screens') {
      assert.equal(count(s, 'crtoff'), SCREENS.length - 1, 'one clunk per TV');
      assert.ok(count(s, 'staticburst') >= 1);
    }
    if (id === 'lock_on') {
      const steps = (p.targets as { steps: unknown[] }[]).reduce((n, x) => n + x.steps.length, 0);
      assert.equal(count(s, 'servo') - (p.pulses as never[]).length, steps, 'one servo per zoom step');
      assert.equal(count(s, 'locktone'), (p.targets as never[]).length, 'one lock per target');
    }
    if (id === 'slide_carousel') assert.equal(count(s, 'kachunk'), (p.slides as never[]).length, 'one ka-chunk per slide');
    if (id === 'front_page') {
      const crinkles = s.filter((e: { src?: string }) => /crinkle\d/.test(String(e.src ?? ''))).map((e: { src?: string }) => e.src);
      assert.equal(crinkles.length, (p.pages as never[]).length, 'one crinkle per page');
      assert.equal(new Set(crinkles).size, crinkles.length, 'each crinkle different');
    }
    if (id === 'burn') assert.equal(count(s, 'fire'), (p.burns as never[]).length, 'fire on every burn');
    if (id === 'darkroom') assert.ok(count(s, 'timer') === 1 && count(s, 'hit') >= 1 && count(s, 'slip') >= 1, 'more than water and one hit');
    if (id === 'rewind') assert.ok(count(s, 'rewind') >= 1 && count(s, 'hit') >= 1);
  }
});

test('Lucas\'s level verdicts hold: fire loud with no low hit, press well under the voice, slide changes clearly audible', () => {
  for (const [id, inv, choice] of every()) {
    const s = hookScore(plan(choice, inv));
    if (id === 'burn') {
      assert.equal(count(s, 'hit'), 0, 'no low hit on Burn');
      assert.ok(s.every((c) => c.level_db >= -2), 'fire audible');
    }
    if (id === 'front_page') assert.ok(s.filter((c) => c.src.endsWith('/press.mp3')).every((c) => c.level_db <= -18), 'press bed well under the voice');
    if (id === 'slide_carousel') assert.ok(s.filter((c) => c.src.endsWith('/kachunk.mp3')).every((c) => c.level_db >= -4), 'slide changes clearly audible');
  }
});

test('a press bed stops when the first page lands and no bed outlives the frame', () => {
  for (const [id, inv, choice] of every()) {
    const p = plan(choice, inv) as never as { pages: { land: number }[]; duration: number };
    for (const c of hookScore(p as never)) if (c.dur != null) assert.ok(c.t + c.dur <= p.duration + 0.06, `${id}: ${c.src} at ${c.t} for ${c.dur}`);
    if (id === 'front_page') {
      const press = hookScore(p as never).find((c) => c.src.endsWith('/press.mp3')) as { dur: number };
      assert.ok(Math.abs(press.dur - p.pages[0].land) < 0.01);
    }
  }
});

test('Wall of Screens: different images on the TVs, each treated about five ways', () => {
  const five = wallCells(SCREENS, ['a', 'b', 'c', 'd', 'e']);
  const seen = new Set(five.cells.filter((c: any) => !c.big).map((c: any) => `${c.asset}:${c.way}`));
  assert.ok(seen.size >= 25, `${seen.size} distinct screens`);
  assert.equal(new Set(five.cells.map((c: any) => c.asset)).size, 5);
  const three = wallCells(SCREENS, ['a', 'b', 'c']);
  assert.ok(new Set(three.cells.filter((c: any) => !c.big).map((c: any) => `${c.asset}:${c.way}`)).size >= 15);
  for (const m of [asset(), place(), asset({ kind: 'logo', face: null })]) {
    const ways = screenTreatments(m);
    assert.equal(ways.length, 5);
    assert.ok(new Set(ways.map((w: any) => JSON.stringify(w))).size === 5);
  }
});

test('the CRT holds to the end: the entered world runs until the frame ends and what shows inside can be read', () => {
  const inv = rich();
  const o = hookOptions(inv, []).find((x) => x.id === 'wall_of_screens') as HookOption;
  for (const charged of ['The founders', 'weeks later', 'cash.']) {
    const p = plan({ ...codeHook(o, { inventory: inv, words: LINE }), charged }, inv) as never as { tIn: number; inside: { t: number }[]; duration: number };
    assert.ok(p.tIn > 0.5, 'the wall gets seen');
    for (let i = 0; i < p.inside.length; i++) {
      const until = p.inside[i + 1]?.t ?? p.duration;
      assert.ok(until - p.inside[i].t >= 1.15, `inside ${i} holds ${until - p.inside[i].t}s`);
    }
  }
});

test('crops come from the face: it lands under the captions, inside the frame', () => {
  const m = asset({ width: 2000, height: 1500, face: { x: 0.7, y: 0.2, w: 0.1, h: 0.16 } });
  const c = coverCrop(m, 1080, 1920);
  const cy = (0.2 + 0.08 - c.y) / c.h;
  const cx = (0.75 - c.x) / c.w;
  assert.ok(cx > 0.2 && cx < 0.8, `face x in frame ${cx}`);
  assert.ok(cy * 1920 > 480, `face below the captions: ${cy * 1920}`);
  assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001);
  assert.equal(fullFrameLook(asset({ kind: 'logo' })), 'logo');
  assert.equal(fullFrameLook(asset({ width: 2000, height: 1500, face: { x: 0.1, y: 0.1, w: 0.5, h: 0.45 } })), 'print', 'a wide face doesn\'t fit a tall crop');
});

// ── Sound bank ──────────────────────────────────────────────────────────────────────────────────

test('every shipped sound is peak-normalized and trimmed to its onset', () => {
  const dir = path.join(KIT_HOOKS, 'sfx');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort(), SFX_NAMES.map((n: string) => `${n}.mp3`).sort(), 'the bank holds exactly what scores use');
  for (const name of SFX_NAMES as string[]) {
    const file = path.join(dir, `${name}.mp3`);
    const peak = peakDb(file);
    assert.ok(Math.abs(peak - PEAK_DB) <= 1, `${name} peaks at ${peak} dB`);
    assert.ok(onsetSeconds(file) <= 0.03, `${name} starts ${onsetSeconds(file)}s late`);
  }
});

test('every score uses a sound in the bank, and bed lengths match the files', () => {
  for (const [, inv, choice] of every()) for (const c of hookScore(plan(choice, inv))) assert.ok(fs.existsSync(path.join(process.cwd(), 'explainers', 'reel-ai-drama', 'kit', 'hooks', 'sfx', path.basename(c.src))), c.src);
  for (const [name, seconds] of Object.entries(SFX_SECONDS)) {
    const size = fs.statSync(path.join(KIT_HOOKS, 'sfx', `${name}.mp3`)).size;
    assert.ok(Math.abs(size / 16000 - (seconds as number)) < 1.2, `${name}: ${size} bytes at 128k vs ${seconds}s`);
  }
});

test('the kit stays small: copying it per job stays cheap, and no rejected plates shipped', () => {
  let total = 0;
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name)); else total += fs.statSync(path.join(d, e.name)).size; } };
  walk(KIT_HOOKS);
  assert.ok(total < 6 * 1024 * 1024, `kit/hooks is ${(total / 1048576).toFixed(1)} MB`);
  const plates = fs.readdirSync(path.join(KIT_HOOKS, 'plates'));
  for (const bad of ['contact', 'crop', 'no1', 'no2', 'no3']) assert.ok(!plates.some((f) => f.startsWith(bad)), bad);
});

// ── The file event ──────────────────────────────────────────────────────────────────────────────

test('a file event is valid, reaches the mix at its level and survives a designed silence', () => {
  const e = { t: 1, kind: 'file', src: 'assets/kit/hooks/sfx/hit.mp3', level_db: -6 };
  assert.deepEqual(eventProblems([e], 5), []);
  assert.ok(eventProblems([{ ...e, src: '../../etc/passwd' }], 5).length);
  assert.ok(eventProblems([{ ...e, level_db: 'loud' }], 5).length);
  const { cues, dropped } = eventsToCues([{ id: 'f', start: 2 }], { f: [e, { ...e, t: 1.1, dur: 0.5 }] }, []);
  assert.equal(dropped.length, 0);
  assert.equal(cues[0].t, 3);
  assert.equal(yieldToDesign(cues, { stingers: [{ kind: 'silence', t: 2.5, dur: 2 }], ambience: [] }).cues.length, 2, 'the designer adds, never removes');
  const { resolved, missing } = resolveCues([], cues, { speech: [{ start: 0, end: 10 }] });
  assert.equal(missing.length, 0);
  assert.ok(Math.abs(resolved[0].volume - 0.501) < 0.01, 'level as stated, not ducked under speech');
  const args = mixArgs(resolved, 10, '/tmp/out.wav', path.join('/p', 'assets/sfx-library'));
  assert.ok(args.includes(path.join('/p', 'assets/kit/hooks/sfx/hit.mp3')));
});

// ── Compile ─────────────────────────────────────────────────────────────────────────────────────

function project(hook: HookChoice | null | undefined, inv: VisualsInventory) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-compile-'));
  fs.mkdirSync(path.join(dir, 'assets', 'timing'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'inventory.json'), JSON.stringify(inv));
  fs.writeFileSync(path.join(dir, 'assets', 'timing', '01-open.json'), JSON.stringify({ duration: 8, words: WORDS, lines: [] }));
  fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), '# Storyboard\n\n## Frame 1 Open\n- src: compositions/frames/01-open.html\n- duration: 8\n- treatment: photo\n');
  const blueprint = { pieces: [{ id: 'p1', asset: inv.assets[0].id, on: '', label: 'Ana Ruiz' }] };
  const plan = { hook, frames: [{ n: 1, name: 'Open', id: '01-open', treatment: 'photo', asset_ids: [inv.assets[0].id], line_ids: ['L1'], on_screen: 'A title', blueprint }, { n: 2, name: 'Next', id: '02-next', treatment: 'photo', asset_ids: [inv.assets[1].id], line_ids: ['L2'], blueprint: { pieces: [{ id: 'p1', asset: inv.assets[1].id, on: '' }] } }] } as unknown as DirectorPlan;
  return { dir, plan };
}

test('compile honours plan.hook: frame 1 is a hook module with its score; its blueprint stands behind it; its names are not introduced', async () => {
  const inv = rich();
  const o = hookOptions(inv, [SOURCE]).find((x) => x.id === 'slide_carousel') as HookOption;
  const hook = codeHook(o, { inventory: inv, words: LINE });
  const { dir, plan: p } = project(hook, inv);
  const { problems } = await compileReel({ plan: p, inventory: inv, projectDir: dir, readWords: null });
  const files = fs.readdirSync(path.join(dir, 'assets', 'frames'));
  const opening = files.find((f) => f.endsWith('.js') && f.includes('open')) as string;
  const src = fs.readFileSync(path.join(dir, 'assets', 'frames', opening), 'utf8');
  assert.match(src, /compiledHook\(/);
  assert.match(src, /"blueprint"/);
  assert.deepEqual(sourceProblems(src), [], 'passes try.mjs');
  const events = JSON.parse(fs.readFileSync(path.join(dir, 'assets', 'frames', opening.replace('.js', '.events.json')), 'utf8'));
  assert.ok(events.every((e: { kind: string }) => e.kind === 'file'));
  assert.equal(events.filter((e: { src: string }) => e.src.endsWith('kachunk.mp3')).length, hook.beats.length);
  assert.ok(!problems.some((x) => x.includes('frame 1')), problems.join(';'));
  const next = fs.readFileSync(path.join(dir, 'assets', 'frames', files.find((f) => f.endsWith('.js') && f.includes('next')) as string), 'utf8');
  assert.match(next, /compiledFrame\(/);
  assert.doesNotMatch(next, /Ana Ruiz/, 'the hook shows no label, so the name is still new at frame 2');
});

test('no hook: frame 1 renders from its blueprint, with no title added', async () => {
  const inv = rich();
  const { dir, plan: p } = project(null, inv);
  await compileReel({ plan: p, inventory: inv, projectDir: dir, readWords: null });
  const opening = fs.readdirSync(path.join(dir, 'assets', 'frames')).find((f) => f.endsWith('.js') && f.includes('open')) as string;
  const src = fs.readFileSync(path.join(dir, 'assets', 'frames', opening), 'utf8');
  assert.match(src, /compiledFrame\(/);
  assert.doesNotMatch(src, /"hook"/);
  assert.doesNotMatch(src, /A title/);
  const bp = { ground: 'charcoal', style: 'cutouts', arrangement: 'solo', pieces: [], labels: [], speech: [], marks: [], arrows: [], camera: { move: 'hold', stops: [] }, sounds: [] } as never;
  assert.equal(withOnScreen(bp, { n: 1, on_screen: 'A title' } as never), bp);
  assert.deepEqual((withOnScreen(bp, { n: 2, on_screen: 'A label' } as never) as { labels: unknown[] }).labels, [{ text: 'A label', on: '' }]);
});

test('a hook swap passes through the gates: a valid one replaces the plan\'s, an ineligible one leaves it standing', async () => {
  const inv = rich();
  const options = hookOptions(inv, [SOURCE]);
  const burn = options.find((o) => o.id === 'burn') as HookOption;
  const carousel = codeHook(options.find((o) => o.id === 'slide_carousel') as HookOption, { inventory: inv, words: LINE });
  const swap: HookChoice = { id: 'burn', beats: burn.assets.slice(0, 2).map((asset) => ({ asset, on: '' })), charged: 'weeks later' };
  const { dir, plan: p } = project(carousel, inv);
  const accepted = acceptTouches({ touches: [], custom: [], hook_swap: swap }, p).touches;
  assert.deepEqual(accepted.hook_swap, swap, 'the touches carry it');
  fs.writeFileSync(path.join(dir, 'assets', 'touches.json'), JSON.stringify(accepted));
  assert.deepEqual(readTouches(dir).hook_swap, swap);
  await compileReel({ plan: p, inventory: inv, projectDir: dir, touches: accepted, sources: [SOURCE], readWords: null });
  const read = () => fs.readFileSync(path.join(dir, 'assets', 'frames', fs.readdirSync(path.join(dir, 'assets', 'frames')).find((f) => f.endsWith('.js') && f.includes('open')) as string), 'utf8');
  assert.match(read(), /"id": "burn"/);
  const bad = { ...swap, id: 'front_page' as const };
  const { problems } = await compileReel({ plan: p, inventory: inv, projectDir: dir, touches: { ...accepted, hook_swap: bad }, sources: [], readWords: null });
  assert.match(read(), /"id": "slide_carousel"/);
  assert.ok(problems.some((x) => x.includes('hook swap')));
});

test('the plan check treats a hook frame as carried, and a hook that fell back as a miss', () => {
  const blueprint = { pieces: [{ id: 'p1', asset: 'V1', on: 'x' }], labels: [], speech: [], marks: [], arrows: [], sounds: [], camera: { move: 'hold', stops: [] } };
  const plan1 = { frames: [{ n: 1, treatment: 'photo', blueprint }] } as unknown as DirectorPlan;
  assert.deepEqual(checkPlanCarried(plan1, { 1: { hook_frame: 'burn', manifest: {} } }), []);
  assert.equal(checkPlanCarried(plan1, { 1: { hook_frame: 'burn', plain: true } }).length, 1);
});

test('a hook module holds data and one call; web addresses in it don\'t read as network calls', () => {
  const src = hookModule({ treatment: 'photo', hook: { id: 'front_page', beats: [], charged: '', headlines: [{ text: 'x', publisher: 'p', url: 'https://example.com/a' }] }, years: {}, frame: {} });
  assert.deepEqual(sourceProblems(src), []);
  assert.match(src, /from '\.\.\/kit\/hooks\/index\.js'/);
});
