import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { checkDesign, designFindingText, frameBrief, FAST_ITEMS, JUDGE_ITEMS, parseDesignFindings } from '@/lib/reel-ai-drama/checks/design';
import { designReviewSystem } from '@/lib/reel-ai-drama/prompts';
import type { Sheet } from '@/lib/reel-ai-drama/render/sheets';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { DirectorPlan, WriterDraft } from '@/lib/reel-ai-drama/types';
import type { SendMessage, SubmitParams } from '@/lib/reel-ai-drama/writing/llm';

import { scratchExplainersDb } from './explainers-pglite';

// ── Fixtures (canned; no model, no network) ────────────────────────────────

const DRAFT = {
  title: 'T',
  hook: { on_screen: 'One bet', line_id: 'L1' },
  rungs: [
    { id: 'R1', purpose: 'open', lines: [{ id: 'L1', text: 'In the first year, a founder bet everything.', on_screen: 'Year one', on_screen_kind: 'date', fact_ids: ['F1'], must_show: null }] },
    { id: 'R2', purpose: 'turn', lines: [{ id: 'L2', text: 'Then the partner walked.', on_screen: 'Walked out', fact_ids: ['F1'], must_show: null }] },
  ],
  peak_rung_id: 'R2',
  landing_rung_id: 'R2',
  close_question: 'Would you ship it?',
  word_count: 11,
  central: [],
} as unknown as WriterDraft;

const PLAN = {
  frames: [
    { n: 1, name: 'the bet', line_ids: ['L1'], treatment: 'photo', asset_ids: ['V1'], purpose: 'who and when', motion: 'push', marks: '', sound: '', music: 'start', on_screen: null, focus: { kind: 'person', what: 'the founder' } },
    { n: 2, name: 'the walk', line_ids: ['L2'], treatment: 'collage', asset_ids: ['V2'], purpose: 'the break', motion: '', marks: '', sound: '', music: 'hold', on_screen: null, drop_labels: ['L2'] },
    { n: 3, name: 'close', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'close', motion: '', marks: '', sound: '', music: 'end', on_screen: null, focus: null },
  ],
  lines_back: [],
} as unknown as DirectorPlan;

const SHEETS: Sheet[] = [
  { frame: 1, file: 'frame-01-1.jpg', moments: [{ frame: 1, id: '01-bet', t: 0.1, reel_t: 0.1, what: "the reel's first instant", source: 'edge' }] },
  { frame: 2, file: 'frame-02-1.jpg', moments: [{ frame: 2, id: '02-walk', t: 2, reel_t: 6.1, what: 'the frame ends', source: 'edge' }] },
];

function toolMessage(model: string, input: unknown): Anthropic.Message {
  return {
    id: `msg_${model}`, type: 'message', role: 'assistant', model,
    content: [{ type: 'tool_use', id: `tu_${model}`, name: 'submit_design_review', input }], stop_reason: 'tool_use', stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

/** Answers by model, so the two parallel calls can arrive in any order. A thrown answer fails that call. */
function stubSend(byModel: Record<string, Anthropic.Message | Error>): SendMessage & { calls: SubmitParams[] } {
  const calls: SubmitParams[] = [];
  const fn = (async (params: SubmitParams) => {
    calls.push(structuredClone(params));
    const a = byModel[params.model];
    if (!a) throw new Error(`no stub for ${params.model}`);
    if (a instanceof Error) throw a;
    return a;
  }) as SendMessage & { calls: SubmitParams[] };
  fn.calls = calls;
  return fn;
}

async function freshDb() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  return db;
}

const FAST = DEFAULT_SETTINGS.vision_model;
const JUDGE = DEFAULT_SETTINGS.design_judge_model;

// ── Tests ──────────────────────────────────────────────────────────────────

test('design_judge_model defaults to Sonnet 5.5; the prompt splits into a shared intro and two item sets', () => {
  assert.equal(DEFAULT_SETTINGS.design_judge_model, 'claude-sonnet-5-5');
  const fast = designReviewSystem('fast');
  const judge = designReviewSystem('judge');
  for (const s of [fast, judge]) assert.match(s, /submit_design_review/);
  for (const item of FAST_ITEMS) {
    assert.ok(fast.includes(`\`${item}\``), item);
    assert.ok(!judge.includes(`\`${item}\``), item);
  }
  for (const item of JUDGE_ITEMS) {
    assert.ok(judge.includes(`\`${item}\``), item);
    assert.ok(!fast.includes(`\`${item}\``), item);
  }
  assert.ok(!fast.includes('<!-- set:') && !judge.includes('<!-- set:'));
});

test('the frame brief carries treatment, purpose, focus, narration and shown labels (dates marked, dropped labels left out)', () => {
  const one = frameBrief(1, PLAN, DRAFT, 2);
  assert.match(one, /Frame 1 of 2 — "the bet" · treatment: photo/);
  assert.match(one, /Purpose: who and when/);
  assert.match(one, /Focus: person — the founder/);
  assert.match(one, /Narration: "In the first year, a founder bet everything\."/);
  assert.match(one, /On-screen labels: "Year one" \(date\)/);
  assert.match(frameBrief(2, PLAN, DRAFT, 2), /On-screen labels: none/);
});

test('checkDesign: Haiku takes the fast set, Sonnet the judge set; findings split into problems and warnings; cost per component', async () => {
  const db = await freshDb();
  const send = stubSend({
    [FAST]: toolMessage(FAST, {
      findings: [
        { frame: 2, item: 'off_edge', severity: 'problem', what: 'The headline runs past the right edge.' },
        { frame: 9, item: 'off_edge', severity: 'problem', what: 'A frame that was never shown.' },
        { frame: 1, item: 'focal_point', severity: 'problem', what: 'Not this call\'s item.' },
      ],
    }),
    [JUDGE]: toolMessage(JUDGE, { findings: [{ frame: 1, item: 'composed', severity: 'warning', what: 'A single photo with a push, like frame 2.' }] }),
  });
  const out = await checkDesign({ create: send, db, mode: 'production', jobId: null, readSheet: async () => 'AAAA' }, { sheets: SHEETS, plan: PLAN, draft: DRAFT });

  assert.deepEqual(out.problems, [{ frame: 2, item: 'off_edge', severity: 'problem', what: 'The headline runs past the right edge.' }]);
  assert.deepEqual(out.warnings, [{ frame: 1, item: 'composed', severity: 'warning', what: 'A single photo with a push, like frame 2.' }]);
  assert.deepEqual(out.errors, []);
  assert.ok(out.usd > 0);

  assert.equal(send.calls.length, 2);
  const byModel = new Map(send.calls.map((c) => [c.model, c]));
  const fast = byModel.get(FAST)!;
  const judge = byModel.get(JUDGE)!;
  assert.ok(fast && judge, 'one call per model');
  // Stable prefix cached; the sheets are the per-request suffix.
  for (const c of [fast, judge]) {
    const system = c.system as { text: string; cache_control?: unknown }[];
    assert.ok(system.at(-1)!.cache_control, 'the system prompt carries cache_control');
    const user = c.messages[0]!.content as Anthropic.ContentBlockParam[];
    assert.equal(user.filter((b) => b.type === 'image').length, 2, 'every sheet is sent');
    assert.ok(!JSON.stringify(c.system).includes('frame-01'), 'nothing of this reel in the cached prefix');
    assert.ok(user.every((b) => !('cache_control' in b)), 'no breakpoint on the per-request suffix');
  }
  assert.match((fast.system as { text: string }[])[0]!.text, /`off_edge`/);
  assert.match((judge.system as { text: string }[])[0]!.text, /`one_medium`/);
  const enumOf = (c: SubmitParams) => ((c.tools![0] as unknown as { input_schema: { properties: { findings: { items: { properties: { item: { enum: string[] } } } } } } }).input_schema.properties.findings.items.properties.item.enum);
  assert.deepEqual(enumOf(fast), [...FAST_ITEMS]);
  assert.deepEqual(enumOf(judge), [...JUDGE_ITEMS]);
  assert.equal(judge.output_config?.effort, 'medium');

  const { rows } = await db.query<{ component: string }>('SELECT component FROM reel_ai_drama.cost_events ORDER BY component');
  assert.deepEqual(rows.map((r) => r.component), ['design_review_fast', 'design_review_judge']);
});

test('checkDesign fails open: a call that errors is reported, the other call still counts', async () => {
  const db = await freshDb();
  const send = stubSend({
    [FAST]: new Error('overloaded'),
    [JUDGE]: toolMessage(JUDGE, { findings: [{ frame: 1, item: 'one_medium', severity: 'problem', what: 'A drawn figure beside a real photo.' }] }),
  });
  const out = await checkDesign({ create: send, db, mode: 'production', readSheet: async () => 'AAAA' }, { sheets: SHEETS, plan: PLAN, draft: DRAFT });
  assert.equal(out.problems.length, 1);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0]!, /^design_review_fast: overloaded/);
  const none = await checkDesign({ create: stubSend({}), db, mode: 'production' }, { sheets: [], plan: PLAN, draft: DRAFT });
  assert.deepEqual(none.errors, ['no sheets to review']);
});

test('checkDesign: a frame\'s brief comes once, above all its sheets, in frame order', async () => {
  const db = await freshDb();
  const send = stubSend({ [FAST]: toolMessage(FAST, { findings: [] }), [JUDGE]: toolMessage(JUDGE, { findings: [] }) });
  const sheets = [SHEETS[1]!, SHEETS[0]!, { ...SHEETS[0]!, file: 'frame-01-2.png' }];
  await checkDesign({ create: send, db, mode: 'production', readSheet: async (f) => f }, { sheets, plan: PLAN, draft: DRAFT });
  const user = send.calls[0]!.messages[0]!.content as Anthropic.ContentBlockParam[];
  const shape = user.map((b) => (b.type === 'image' ? (b.source as { data: string }).data : /^Frame (\d)/.exec((b as { text: string }).text)?.[0] ?? 'end'));
  assert.deepEqual(shape, ['Frame 1', 'frame-01-1.jpg', 'frame-01-2.png', 'Frame 2', 'frame-02-1.jpg', 'end']);
  assert.equal(((user[2] as Anthropic.ImageBlockParam).source as { media_type: string }).media_type, 'image/png');
});

test('the review prompts say what a sheet is and judge text at phone size; no prompt still speaks of one still', () => {
  const fast = designReviewSystem('fast');
  const judge = designReviewSystem('judge');
  for (const s of [fast, judge]) {
    assert.match(s, /A sheet is a grid of up to six tiles/);
    assert.match(s, /about 40%/);
    assert.ok(!/\bstills?\b/.test(s), 'no reference to the old stills');
  }
  assert.match(fast, /`readable_text`[\s\S]*against the width of the tile/);
  assert.match(judge, /`formed_opening`[\s\S]*the reel's first instant/);
  const viewer = fs.readFileSync(path.join('explainers/reel-ai-drama/prompts', 'first-viewer.md'), 'utf8');
  assert.match(viewer, /\*\*Sheets\*\*/);
  assert.ok(!/contact sheet/i.test(viewer));
});

test('parseDesignFindings: bad frames, foreign items and empty findings are dropped; unreadable output is a problem', () => {
  const parse = parseDesignFindings(new Set([1, 2]), FAST_ITEMS);
  assert.deepEqual(parse({ findings: [{ frame: 1, item: 'off_edge', severity: 'problem', what: ' ' }, { frame: 2, item: 'nothing_missing', severity: 'odd', what: 'blank' }] }).value, [
    { frame: 2, item: 'nothing_missing', severity: 'warning', what: 'blank' },
  ]);
  assert.equal(parse({}).value, null);
  assert.equal(designFindingText({ frame: 3, item: 'marks_on_target', what: 'The ring circles blank paper.' }), 'Frame 3, marks on target: The ring circles blank paper.');
});

