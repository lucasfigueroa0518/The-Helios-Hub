import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { lookItems } from '@/lib/reel-ai-drama/checks/integrity';
import { validatePitch } from '@/lib/reel-ai-drama/development/producer';
import { closeVoiceSeconds, cutLines } from '@/lib/reel-ai-drama/production/draft';
import { validateFactSheet } from '@/lib/reel-ai-drama/reporting/validate';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { Asset, DirectorPlan, FactSheet, Pitch, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { inventoryForDirecting } from '@/lib/reel-ai-drama/writing/director';
import { planWarnings, validateDraft, validatePlan } from '@/lib/reel-ai-drama/writing/validate';
import { planFrames, storyboardMarkdown, writeProjectFiles } from '../explainers/reel-ai-drama/kit/project-files.mjs';

/**
 * The prompt-and-craft review's fixes (planning/AI Mini Docs/notes/review.md): the close question's cap
 * (#2), line labels carried to the storyboard (#4), frame words limited to the script's (#5), one image
 * one job (#6), pauses (#9), the cell kept (#18), core facts and unverified quotes (#19, #20), the cut
 * hook (#22). Generic fixtures only.
 */

const FACTS: FactSheet = {
  summary: 'A founder bet the company on one product.',
  timeline: [],
  facts: [{ id: 'F1', text: 'The founder bet the company.', source_ids: ['S1'], key: true, confidence: 'confirmed' }],
  sources: [{ id: 'S1', url: 'https://example.com/a', title: 'A', publisher: 'Example', date: null, kind: 'report' }],
  quotes: [],
  artifacts: [],
  cast: [],
  places: [],
  verdict: { holds: true, reason: 'ok' },
};

function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id, kind: 'person_photo', file: `media/${id}.jpg`, url: `https://example.com/${id}.jpg`, source_page: null, credit: `Photo ${id}`,
    license: null, shows: `picture ${id}`, people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown',
    width: 1600, height: 1200, phash: null, character_image: false, made: false, upscaled: false, flags: [], ...over,
  };
}

const INVENTORY: VisualsInventory = {
  assets: [
    asset('V1'),
    asset('V2', { character_image: true, shows: 'the founder, cut out' }),
    asset('V3'),
    asset('V4', { kind: 'logo', character_image: true, flags: ['logo_bank'] }),
  ],
  usable_count: 4,
  counts: {},
  kill: null,
  usd: 0,
};

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

/** 7 rungs × 20 words; L2 and L3 carry labels; the turn at R6. */
function draft(over: { pauseOn?: string; pause?: number; question?: string } = {}): WriterDraft {
  let n = 0;
  const rungs = Array.from({ length: 7 }, (_, i) => ({
    id: `R${i + 1}`,
    purpose: `purpose ${i + 1}`,
    lines: [10, 10].map((count) => {
      const id = `L${++n}`;
      return {
        id,
        text: `${words(count)}.`,
        on_screen: id === 'L2' ? 'March 2020' : id === 'L3' ? '$4M' : null,
        fact_ids: ['F1'],
        must_show: null,
        pause_after: id === over.pauseOn ? over.pause ?? 0.5 : null,
      };
    }),
  }));
  return {
    title: 'T', engine: 'end first', hook: { on_screen: 'One bet', line_id: 'L1' }, rungs, turn_rung_id: 'R6', landing_rung_id: 'R7',
    close_question: over.question ?? 'Would you have shipped it?', word_count: 0,
  };
}

/** Frames of two lines each (frame 2 carries L3 and L4), then the close. */
function plan(d: WriterDraft = draft(), edit: (f: DirectorPlan['frames'][number]) => void = () => undefined): DirectorPlan {
  const ids = d.rungs.flatMap((r) => r.lines.map((l) => l.id));
  const frames = Array.from({ length: 7 }, (_, i) => ({
    n: i + 1, name: `f${i + 1}`, line_ids: ids.slice(i * 2, i * 2 + 2), treatment: 'photo', asset_ids: ['V1'], purpose: 'the founder', motion: 'push',
    marks: '', sound: 'room tone', music: (i === 0 ? 'start' : 'hold') as DirectorPlan['frames'][number]['music'], on_screen: i === 0 ? 'One bet' : null,
  }));
  frames.forEach(edit);
  frames.push({ n: 8, name: 'close', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'close', motion: '', marks: '', sound: '', music: 'end', on_screen: null });
  return { frames, lines_back: [] };
}

const check = (p: DirectorPlan, d: WriterDraft = draft()) => validatePlan(p, { draft: d, inventory: INVENTORY });

// #2 ─────────────────────────────────────────────────────────────────────────

test('#2 the close question is capped at about 6 words; its voiced length is read after the voice step', () => {
  const ctx = { facts: FACTS, inventory: INVENTORY, limits: DEFAULT_SETTINGS };
  assert.deepEqual(validateDraft(draft(), ctx).problems, []);
  const long = validateDraft(draft({ question: 'Would you have shipped it if the board said no?' }), ctx).problems;
  assert.ok(long.some((p) => /close question runs 10 words; keep it to about 6/.test(p)), long.join('\n'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-close-'));
  assert.equal(closeVoiceSeconds(dir), null, 'no voice record: nothing to judge');
  fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), '## Frame 1 — A\n\n- treatment: photo\n\n## Frame 2 — Close\n\n- treatment: close\n');
  fs.writeFileSync(path.join(dir, 'audio_meta.json'), JSON.stringify({ voices: [{ frame: 1, duration_s: 3 }, { frame: 2, duration_s: 2.74 }] }));
  assert.equal(closeVoiceSeconds(dir), 2.74);
});

// #4 ─────────────────────────────────────────────────────────────────────────

test('#4 every line label reaches the storyboard, timed to its line; a competing frame word is a warning', () => {
  const d = draft();
  const p = plan(d);
  const sb = storyboardMarkdown(d, planFrames(p, d));
  assert.match(sb, /## Frame 1 — f1[\s\S]*?- on_screen: One bet[\s\S]*?- labels: L2: March 2020\n/);
  assert.match(sb, /## Frame 2 — f2[\s\S]*?- labels: L3: \$4M\n/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-labels-'));
  writeProjectFiles(dir, { draft: d, plan: p, inventory: { ...INVENTORY, assets: [] } });
  const lines = JSON.parse(fs.readFileSync(path.join(dir, 'assets', 'lines.json'), 'utf8'));
  assert.deepEqual(lines['02-f2'], [
    { id: 'L3', words: 10, label: '$4M', pause_after: 0 },
    { id: 'L4', words: 10, label: null, pause_after: 0 },
  ]);

  assert.deepEqual(check(p, d).warnings, []);
  const competing = check(plan(d, (f) => (f.n === 2 ? (f.on_screen = 'March 2020') : undefined)), d);
  assert.deepEqual(competing.problems, []);
  assert.ok(competing.warnings.some((w) => /frame 2 shows "March 2020" as well as L3's label "\$4M"/.test(w)), competing.warnings.join('\n'));
});

// #5 ─────────────────────────────────────────────────────────────────────────

test("#5 frame words are only the hook's words or a script line's label", () => {
  const own = check(plan(draft(), (f) => (f.n === 3 ? (f.on_screen = '$5 million, said the filing') : undefined)));
  assert.ok(own.problems.some((p) => /frame 3's on-screen words .* are not the script's/.test(p)), own.problems.join('\n'));
  const label = check(plan(draft(), (f) => (f.n === 3 ? (f.on_screen = '  $4m ') : undefined)));
  assert.deepEqual(label.problems, [], 'a line label, loosely matched, is allowed');
});

// #6 ─────────────────────────────────────────────────────────────────────────

test('#6 one image, one job: character images only in cutout_lift and collision; logos are not character images; reuse is listed', () => {
  const photo = check(plan(draft(), (f) => (f.n === 2 ? (f.asset_ids = ['V2']) : undefined)));
  assert.ok(photo.problems.some((p) => /frame 2 \(photo\) uses V2, a person's character image/.test(p)), photo.problems.join('\n'));
  const lifted = check(plan(draft(), (f) => (f.n === 2 ? Object.assign(f, { treatment: 'cutout_lift', asset_ids: ['V2'] }) : undefined)));
  assert.deepEqual(lifted.problems, []);
  const logo = check(plan(draft(), (f) => (f.n === 2 ? (f.asset_ids = ['V1', 'V4']) : undefined)));
  assert.deepEqual(logo.problems, [], 'a logo (even one the bank marked as a character image) is not a person');
  const seen = inventoryForDirecting(INVENTORY).find((a) => a.id === 'V4')!;
  assert.equal(seen.character_image, false);
  assert.equal(seen.logo, true);

  // V1 in every frame: the same job is fine; a different job is a warning, and the integrity look sees each use.
  const p = plan(draft(), (f) => (f.n === 4 ? (f.purpose = 'a backdrop for the deal') : undefined));
  const warned = planWarnings(p, { draft: draft(), inventory: INVENTORY });
  assert.ok(warned.some((w) => /V1 is used in frames 1, 2, 3, 4, 5, 6, 7 for different purposes/.test(w)), warned.join('\n'));
  const items = lookItems(p, INVENTORY, draft());
  const four = items.find((i) => i.frame === 4)!;
  assert.equal(four.purpose, 'a backdrop for the deal');
  assert.equal(four.otherUses.length, 6);
  const lift = plan(draft(), (f) => (f.n <= 2 ? Object.assign(f, { treatment: 'cutout_lift', asset_ids: ['V2'] }) : undefined));
  assert.ok(lookItems(lift, INVENTORY, draft()).filter((i) => i.asset.id === 'V2').every((i) => i.otherUses.length === 0), 'a character image may move through the story');
});

// #9 ─────────────────────────────────────────────────────────────────────────

test('#9 pause_after: 0–1s, counted toward the length, ends its frame, written to the storyboard', () => {
  const ctx = { facts: FACTS, inventory: INVENTORY, limits: DEFAULT_SETTINGS };
  assert.deepEqual(validateDraft(draft({ pauseOn: 'L4', pause: 0.6 }), ctx).problems, []);
  assert.ok(validateDraft(draft({ pauseOn: 'L4', pause: 1.5 }), ctx).problems.some((p) => /L4's pause_after is 1.5/.test(p)));
  const tight = validateDraft(draft({ pauseOn: 'L4', pause: 1 }), { ...ctx, limits: { ...DEFAULT_SETTINGS, max_seconds: 50.3 } }).problems;
  assert.ok(tight.some((p) => /plus 1s of pauses runs about 51s; at most 50.3s/.test(p)), tight.join('\n'));

  const mid = draft({ pauseOn: 'L3', pause: 0.6 });
  assert.ok(check(plan(mid), mid).problems.some((p) => /L3 has a 0.6s pause after it; end frame 2 on L3/.test(p)));
  const end = draft({ pauseOn: 'L4', pause: 0.6 });
  assert.deepEqual(check(plan(end), end).problems, []);
  assert.match(storyboardMarkdown(end, planFrames(plan(end), end)), /## Frame 2 — f2[\s\S]*?- pause_after: 0.6s\n/);
});

// #18 ────────────────────────────────────────────────────────────────────────

test("#18 a pitch stays in its cell: the cell's player in the cast, its story type and its era", () => {
  const pitch = {
    title: 'T', logline: 'L', pitch: 'P', story_type: 'big_bet', era: 'origins', event_date: '1996-03-01', date_precision: 'month',
    cast: [{ name: 'A founder', role: 'founder', kind: 'person', player_id: null, want: 'to survive' }, { name: 'Nvidia', role: 'the company', kind: 'company', player_id: 'nvidia', want: 'to live' }],
    central_figure: 'A founder', scene: 'S', turn: 'T', implication: 'I', why_now: null, engine: 'countdown',
    expected_visuals: [{ kind: 'person_photo', what: 'w', hint: 'h' }], sources: [{ url: 'https://example.com/s', title: 's', publisher: 'p', date: null }], typicality: 0.2,
  } as unknown as Pitch;
  const today = '2026-10-28';
  assert.ok(validatePitch(pitch, { today, cell: { player_id: 'nvidia', story_type: 'big_bet', era: 'origins' } }).ok);
  const off = (cell: { player_id: string; story_type: Pitch['story_type']; era: Pitch['era'] }) => {
    const v = validatePitch(pitch, { today, cell });
    return v.ok ? '' : v.why;
  };
  assert.match(off({ player_id: 'openai', story_type: 'big_bet', era: 'origins' }), /cell's player \(openai\) is not in the cast/);
  assert.match(off({ player_id: 'nvidia', story_type: 'rivalry', era: 'origins' }), /story_type big_bet is not the cell's \(rivalry\)/);
  assert.match(off({ player_id: 'nvidia', story_type: 'big_bet', era: 'now' }), /era origins is not the cell's \(now\)/);
  assert.ok(validatePitch(pitch, { today }).ok, 'without a cell, only structure is judged');
});

// #19, #20 ───────────────────────────────────────────────────────────────────

test('#19 an unconfirmed core fact kills the story; #20 a quote whose page was never fetched is marked verified: false', () => {
  const sheet: FactSheet = {
    ...FACTS,
    sources: [...FACTS.sources, { id: 'S2', url: 'https://other.org/b', title: 'B', publisher: 'Other', date: null, kind: 'report' }],
    facts: [
      { id: 'F1', text: 'The founder wanted control.', source_ids: ['S1', 'S2'], key: true, core: true, confidence: 'confirmed' },
      { id: 'F2', text: 'The board met that night.', source_ids: ['S1'], key: true, core: true, confidence: 'confirmed' },
    ],
    quotes: [
      { id: 'Q1', speaker: 'The founder', text: 'We ship it.', source_id: 'S1', date: null, context: 'memo' },
      { id: 'Q2', speaker: 'The partner', text: 'Not like this.', source_id: 'S2', date: null, context: 'letter' },
    ],
  };
  const { sheet: out } = validateFactSheet(sheet, { fetched: new Map([['https://example.com/a', 'He said: We ship it. Then left.']]) });
  assert.equal(out.facts.find((f) => f.id === 'F2')!.confidence, 'single_source');
  assert.equal(out.verdict.holds, false);
  assert.match(out.verdict.reason, /core fact is not confirmed \(F2, single_source\)/);
  assert.deepEqual(out.quotes.map((q) => [q.id, q.verified]), [['Q1', true], ['Q2', false]]);

  const fine = validateFactSheet({ ...sheet, facts: [sheet.facts[0]!, { ...sheet.facts[1]!, core: false, key: false }] }).sheet;
  assert.equal(fine.verdict.holds, true, 'a single-sourced supporting fact is kept, for the writer to attribute');
});

// #22 ────────────────────────────────────────────────────────────────────────

test('#22 cutting the hook line takes its on-screen words with it; the landing keeps the last rung', () => {
  const d = draft();
  const cut = cutLines(d, ['L1', 'L14']);
  assert.deepEqual(cut.hook, { on_screen: '', line_id: 'L2' });
  assert.equal(cut.landing_rung_id, 'R7');
  assert.equal(cutLines(d, ['L5']).hook.on_screen, 'One bet');
  // With no hook words, frame 1 needs none.
  const p = plan(cut, (f) => (f.n === 1 ? (f.on_screen = null) : undefined));
  p.frames[0]!.line_ids = ['L2'];
  p.frames[6]!.line_ids = ['L13'];
  assert.ok(!check(p, cut).problems.some((x) => /hook's words/.test(x)));
});
