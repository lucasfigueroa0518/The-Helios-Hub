/**
 * Real or AI? engine rules, offline (CONTRACT.md §3 validator limits, §5 A):
 * the validator, the proof line, the spec balance, the import manifest, and the
 * prompts' registration and shared wording.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { STORIES_PROMPTS } from '@/lib/stories/prompts';
import { STORIES_QUESTION_SETS } from '@/lib/stories/questions';
import { parseImportManifest } from '@/lib/stories/roa/intake';
import { ROA_REVEAL, ROA_WRITE } from '@/lib/stories/roa/prompts';
import { ROA_SCREEN, TELL_CATEGORIES } from '@/lib/stories/roa/questions';
import { toTellBox } from '@/lib/stories/roa/screen';
import type { RoaCandidate } from '@/lib/stories/roa/types';
import { candidateProblems, lineProblems, proofOf, validateSpecs } from '@/lib/stories/roa/validate';

const real = (over: Partial<RoaCandidate> = {}): RoaCandidate => ({
  imageKey: '0123456789abcdef', truth: 'real', subject: 'nature_weather', trap: 'too_perfect', storagePath: 'roa/candidates/0123456789abcdef.jpg',
  provenance: { kind: 'commons', url: 'https://commons.wikimedia.org/wiki/File:X.jpg', licence: 'CC BY-SA 4.0', credit: 'Jane Doe / Wikimedia Commons', year: '2019' },
  ...over,
});

test('validator: the reveal line limits', () => {
  assert.deepEqual(lineProblems('Salt flats mirror the sky after rain'), []);
  assert.match(lineProblems('one two three four five six seven eight nine ten eleven').join(), /11 words/);
  assert.match(lineProblems('Look at the shadow!').join(), /exclamation/);
  assert.match(lineProblems('Look at the shadow 👀').join(), /emoji/);
  assert.match(lineProblems('x'.repeat(71)).join(), /71 chars/);
  assert.match(lineProblems('  ').join(), /empty/);
});

test('validator: provenance, truth and the used-key rule', () => {
  assert.deepEqual(candidateProblems(real(), { used: new Set() }), []);
  const noCredit = real({ provenance: { kind: 'commons', url: 'https://commons.wikimedia.org/wiki/File:X.jpg', licence: 'CC BY-SA 4.0', credit: '' } });
  assert.match(candidateProblems(noCredit, { used: new Set() }).join(), /no credit/);
  const noLicence = real({ provenance: { kind: 'nasa', url: 'https://images.nasa.gov/details/x', licence: '', credit: 'NASA' } });
  assert.match(candidateProblems(noLicence, { used: new Set() }).join(), /no licence/);
  assert.match(candidateProblems(real(), { used: new Set(['0123456789abcdef']) }).join(), /already in a published set/);
  // A dataset image cannot be real; a real trap cannot be AI.
  assert.match(candidateProblems(real({ provenance: { kind: 'dataset', dataset: 'D', id: '1' } }), { used: new Set() }).join(), /cannot be real/);
  assert.match(candidateProblems(real({ truth: 'ai', provenance: { kind: 'generated', model: 'gpt-image-2', prompt: 'p', createdAt: 'now' } }), { used: new Set() }).join(), /makes a real round/);
});

test('proof: real "place, year · credit" within 60 chars; AI names the model or source', () => {
  assert.equal(proofOf({ kind: 'commons', url: 'u', licence: 'l', credit: 'Jane Doe / Wikimedia Commons', place: 'Bolivia', year: '2019' }), 'Bolivia, 2019 · Jane Doe / Wikimedia Commons');
  const long = proofOf({ kind: 'commons', url: 'u', licence: 'l', credit: 'A Very Long Photographer Name Indeed / Wikimedia Commons', place: 'Salar de Uyuni, Potosí Department, Bolivia', year: '2019' });
  assert.ok(long.length <= 60, long);
  assert.ok(long.startsWith('2019 · '), long);
  assert.equal(proofOf({ kind: 'generated', model: 'gpt-image-2', prompt: 'p', createdAt: 'now' }), 'Made with gpt-image-2');
  assert.ok(proofOf({ kind: 'dataset', dataset: 'Some Dataset', id: '1' }).includes('Some Dataset'));
});

test('specs: balance 2 real + 2 AI (a twin is one of each), one subject per spec, prompt ≤ 25 words', () => {
  const ok = validateSpecs([
    { subject: 'space', trap: 'twin', search_words: 'aurora over lake', ai_prompt: 'Phone photo of an aurora over a lake' },
    { subject: 'travel_spots', trap: 'amateur', search_words: '', ai_prompt: 'Hobbyist photo of a harbour town' },
    { subject: 'animals', trap: 'impossible', search_words: 'pink lake birds', ai_prompt: '' },
    { subject: 'vehicles', trap: 'amateur', search_words: '', ai_prompt: 'Snapshot of a bus' },
  ], 2);
  assert.deepEqual(ok.specs.map((s) => s.trap), ['twin', 'amateur', 'impossible']);
  assert.match(ok.rejected[0]!.problems.join(), /over the balance/);
  const bad = validateSpecs([
    { subject: 'food', trap: 'amateur', search_words: '', ai_prompt: Array.from({ length: 26 }, () => 'word').join(' ') },
    { subject: 'food', trap: 'too_perfect', search_words: 'cake', ai_prompt: '' },
    { subject: 'food', trap: 'impossible', search_words: 'cake', ai_prompt: '' },
    { subject: 'nowhere', trap: 'amateur', search_words: '', ai_prompt: 'x' },
  ], 2);
  assert.deepEqual(bad.specs.map((s) => `${s.subject}.${s.trap}`), ['food.too_perfect']);
  assert.match(bad.rejected.map((r) => r.problems.join()).join('|'), /26 words[\s\S]*already used[\s\S]*subject: nowhere/);
});

test('import manifest: no provenance, no kind, a real-side kind, or marked real is refused', () => {
  const { entries, refused } = parseImportManifest([
    { file: 'ok.png', subject: 'animals', provenance: { kind: 'dataset', dataset: 'D', id: '7' } },
    { file: 'none.png', subject: 'animals' },
    { file: 'nokind.png', subject: 'animals', provenance: { dataset: 'D', id: '8' } },
    { file: 'real.png', subject: 'animals', truth: 'real', provenance: { kind: 'dataset', dataset: 'D', id: '9' } },
    { file: 'commons.png', subject: 'animals', provenance: { kind: 'commons', url: 'https://x.test', licence: 'CC0', credit: 'X' } },
    { file: 'trap.png', subject: 'animals', trap: 'too_perfect', provenance: { kind: 'viral', url: 'https://x.test/p' } },
  ]);
  assert.deepEqual(entries.map((e) => e.file), ['ok.png']);
  assert.equal(entries[0]!.trap, 'mundane');
  const why = Object.fromEntries(refused.map((r) => [r.file, r.problems.join('; ')]));
  assert.match(why['none.png']!, /provenance: missing/);
  assert.match(why['nokind.png']!, /no kind/);
  assert.match(why['real.png']!, /AI images only/);
  assert.match(why['commons.png']!, /cannot be imported/);
  assert.match(why['trap.png']!, /not an AI trap/);
  assert.equal(parseImportManifest({}).refused.length, 1);
});

test('screen: Jev box edges become a TellBox; degenerate boxes are none', () => {
  assert.deepEqual(toTellBox({ top: 0.25, bottom: 0.5, left: 0.5, right: 0.75 }), { x: 0.5, y: 0.25, w: 0.25, h: 0.25 });
  assert.equal(toTellBox({ top: 0.5, bottom: 0.505, left: 0.1, right: 0.9 }), null);
  assert.equal(toTellBox(null), null);
});

test('prompts: registered, DRAFT, cached-stable, one wording for the tell categories, no fixed copy; the reveal never names a tell (RA-26)', () => {
  assert.ok(STORIES_PROMPTS.map((p) => p.id).includes('roa-write@3'));
  assert.ok(STORIES_PROMPTS.map((p) => p.id).includes('roa-reveal@2'));
  assert.ok(STORIES_QUESTION_SETS.map((s) => s.version).includes('roa-screen@4'));
  // The five tell categories: worded once, rendered by the screen. The reveal judges the effort gap only (RA-26).
  assert.ok(String(ROA_SCREEN.questions.glance_tell.instructions).includes(TELL_CATEGORIES));
  assert.ok(String(ROA_SCREEN.questions.subtle_tell.instructions).includes(TELL_CATEGORIES));
  assert.ok(!ROA_REVEAL.system.includes(TELL_CATEGORIES));
  assert.doesNotMatch(ROA_REVEAL.system.split('<humanizer>')[0]!, /\btells?\b/i);
  assert.match(ROA_REVEAL.system, /Never infer it from how the photo looks/);
  assert.equal(ROA_SCREEN.questions.tell_box.type, 'box');
  // Stable system text: no dates or per-day values.
  for (const p of [ROA_WRITE, ROA_REVEAL]) assert.doesNotMatch(p.system.split('<humanizer>')[0]!, /\b20\d\d-\d\d-\d\d\b/);
  // RA-6 lives in the writer; the 3-second screen (R4) is Jev's alone.
  assert.match(ROA_WRITE.system, /no real brand, logo or trademark/);
  assert.doesNotMatch(ROA_WRITE.system, /three-second|3-second/);
  assert.match(ROA_REVEAL.system, /at most 10 words and 70 characters/);
});

test('specs: the retired trap and AI food or interiors are refused; real food stays (RA-23)', () => {
  const out = validateSpecs([
    { subject: 'vehicles', trap: 'mundane', search_words: '', ai_prompt: 'Phone photo of a bus' },
    { subject: 'everyday_interiors', trap: 'amateur', search_words: '', ai_prompt: 'Hobbyist photo of a sunny living room' },
    { subject: 'food', trap: 'twin', search_words: 'market fruit stall', ai_prompt: 'Photo of a fruit stall' },
    { subject: 'food', trap: 'too_perfect', search_words: 'layered cake slice', ai_prompt: '' },
  ], 2);
  assert.deepEqual(out.specs.map((s) => `${s.subject}.${s.trap}`), ['food.too_perfect']);
  const why = out.rejected.map((r) => r.problems.join()).join('|');
  assert.match(why, /mundane is retired/);
  assert.match(why, /everyday_interiors is never made as an AI image/);
  assert.match(why, /food is never made as an AI image/);
  assert.ok(!JSON.stringify(ROA_WRITE.tool.input_schema).includes('"mundane"'));
});

test('real photos are cut to the 9:16 frame, never enlarged; wider than 16:9 is skipped (RA-23)', async () => {
  const { default: sharp } = await import('sharp');
  const { toStoryFrame } = await import('@/lib/stories/roa/generate');
  const make = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#88aacc' } }).jpeg().toBuffer();
  const wide = await toStoryFrame(await make(1500, 1000));
  const m = await sharp(wide!).metadata();
  assert.equal(m.height, 1000);
  assert.equal(m.width, Math.round((1000 * 9) / 16));
  const tall = await sharp((await toStoryFrame(await make(400, 1200)))!).metadata();
  assert.equal(tall.width, 400);
  assert.ok(Math.abs(tall.height! - Math.round((400 * 16) / 9)) <= 1);
  assert.equal(await toStoryFrame(await make(2000, 1000)), null);
});
