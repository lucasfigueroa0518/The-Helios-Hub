/**
 * Helios Social: Hook pass prototype (offline, stubbed Claude and fit check).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { briefSuperIntelligenceForce as brief } from '@/fixtures/social/briefs';
import { sifDraft } from '@/fixtures/social/drafts';
import { applyFlags } from '@/lib/social/factcheck/flags';
import { fillerLine, measureHookBudgets } from '@/lib/social/hook/budget';
import { applyHooks, checkHooks, runHookPass, type HookEntry } from '@/lib/social/hook/hook';
import { HOOK_SYSTEM, HOOK_TESTED_TEXT } from '@/lib/social/hook/prompt';
import { checkDroppedText, expectedSlideText } from '@/lib/social/mechanical/checks';
import { STAGE_MODELS } from '@/lib/social/pipeline/models';
import type { FitCheck } from '@/lib/social/render/fit-check';
import { toRenderPost } from '@/lib/social/render/from-draft';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import { fillDraft } from '@/lib/social/writer/draft';

const BUDGETS = [80, 80, 0, 80, 80, 80];
const none = (slide: number): HookEntry => ({ slide, line: null, kind: null, facts: [] });
const entries = (over: Record<number, HookEntry>) => sifDraft().slides.map((_, i) => over[i + 2] ?? none(i + 2));

test('Hook prompt: the approved edits are in, and the old example is gone', () => {
  assert.match(HOOK_SYSTEM, /Not everyone shrugged it off\./);
  assert.ok(!HOOK_SYSTEM.includes('A governor answered'));
  assert.match(HOOK_SYSTEM, /No vague hype \('shocking', 'you won't believe'\)\. A tease must be specific to what the next slide says\./);
  assert.match(HOOK_SYSTEM, /## Voice/);
  assert.deepEqual(STAGE_MODELS.hook, { model: 'claude-sonnet-5-5', effort: 'high' });
  // Guard: the prompt is the prompts file's §6 text, word for word.
  assert.ok(readFileSync('docs/superpowers/specs/2026-10-04-helios-social-prompts.md', 'utf8').includes(HOOK_TESTED_TEXT));
});

test('Hook check: a clean line is kept on its slide; null entries add nothing', () => {
  const r = checkHooks({ hooks: entries({ 3: { slide: 3, line: 'Then he made his pitch.', kind: 'tease', facts: [] } }) }, sifDraft(), brief(), BUDGETS, 1);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.hooks[1]?.text, 'Then he made his pitch.');
  assert.equal(r.hooks.filter(Boolean).length, 1);
});

test('Hook check: structural errors fail both attempts (bad slide, two entries for one slide, no kind, unknown tag)', () => {
  const bad = [
    { hooks: [{ slide: 9, line: 'x', kind: 'tease', facts: [] }] },
    { hooks: [none(2), { slide: 2, line: 'x', kind: 'tease', facts: [] }] },
    { hooks: [{ slide: 2, line: 'x', kind: null, facts: [] }] },
    { hooks: [{ slide: 2, line: 'x', kind: 'tease', facts: ['F99'] }] },
  ];
  for (const input of bad) for (const attempt of [1, 2]) assert.throws(() => checkHooks(input, sifDraft(), brief(), BUDGETS, attempt), /hooks invalid/);
});

test('Hook check: line problems go back once, then that line is dropped and logged (budget, quote marks, new numbers, second why-it-matters, C8)', () => {
  const input = {
    hooks: entries({
      2: { slide: 2, line: 'Why this matters: the federal effort on AI now has one lead.', kind: 'why-it-matters', facts: ['F5'] },
      3: { slide: 3, line: 'Why this matters to you, again.', kind: 'why-it-matters', facts: [] },
      4: { slide: 4, line: 'Here it is.', kind: 'tease', facts: [] },
      5: { slide: 5, line: 'He has "a deadline" of 90 days.', kind: 'lead-in', facts: ['N1'] },
      6: { slide: 6, line: 'Clayton will chair it, with three vice chairs.', kind: 'tease', facts: ['F3'] },
    }),
  };
  assert.throws(() => checkHooks(input, sifDraft(), brief(), BUDGETS, 1), /second why-it-matters[\s\S]*over the slide's budget of 0[\s\S]*quotation marks[\s\S]*the number 90/);
  const r = checkHooks(input, sifDraft(), brief(), BUDGETS, 2);
  assert.equal(r.hooks[0]?.kind, 'why-it-matters');
  assert.equal(r.hooks[1], null);
  assert.equal(r.hooks[2], null);
  assert.equal(r.hooks[3], null);
  assert.equal(r.hooks[4]?.text, 'Clayton will chair it, with three vice chairs.');
  assert.equal(r.dropped.length, 4);
});

test('Hook check: C8 checks the line against its own slide only', () => {
  const own = { hooks: entries({ 3: { slide: 3, line: 'Clayton will chair the force next.', kind: 'tease', facts: ['F3'] } }) };
  assert.throws(() => checkHooks(own, sifDraft(), brief(), BUDGETS, 1), /C8: "clayton will chair the" is in both/);
  const other = { hooks: entries({ 2: { slide: 2, line: 'Clayton will chair the force next.', kind: 'tease', facts: ['F3'] } }) };
  assert.deepEqual(checkHooks(other, sifDraft(), brief(), BUDGETS, 1).dropped, []);
});

test('Hook lines: rendered (lead-in above, others below), counted by C7, and fixable by the Fact-checker', () => {
  const d = applyHooks(sifDraft(), [{ text: 'He posted it himself.', kind: 'lead-in', facts: ['F1'] }, { text: 'Then came the pitch.', kind: 'tease', facts: [] }, null, null, null, null]);
  const filled = fillDraft(d, brief());
  const post = toRenderPost(filled, { cover: null, slides: filled.slides.map(() => null) }, { source: 'TechCrunch', sourceUrl: '', publishedAt: '2026-10-04T00:00:00Z' });
  assert.deepEqual(post.slides[1]!.hook, { text: 'He posted it himself.', position: 'above' });
  assert.deepEqual(post.slides[2]!.hook, { text: 'Then came the pitch.', position: 'below' });
  assert.ok(expectedSlideText(filled)[1]!.includes('He posted it himself.'));
  const shown = expectedSlideText(filled).map((f) => f.join(' '));
  shown[1] = shown[1]!.replace('He posted it himself.', '');
  assert.match(checkDroppedText(filled, shown).map((f) => f.detail).join(), /He posted it himself/);
  // A flag on a hook fixes the hook; an emptied hook goes, the slide stays.
  const out = applyFlags(d, { main_claim_false: false, flags: [{ where: { part: 'slide', number: 2 }, quoted_text: 'He posted it himself.', type: 5, fact_id: null, fix: { kind: 'cut', replacement: null } }] }, brief());
  assert.equal(out.kind, 'ok');
  if (out.kind === 'ok') {
    assert.equal(out.draft.slides.length, 6);
    assert.equal(out.draft.slides[0]!.hook, null);
    assert.equal(out.draft.slides[0]!.headline.text, 'Announced on Truth Social');
  }
});

test('Hook budgets: measured per slide, the longest passing probe with every shorter one passing; a failing slide gets 0; nothing may shrink', async () => {
  const filled = fillDraft(sifDraft(), brief());
  // Stub render check: slide k passes while its hook is at most `room[k]` characters; slide 4 fails even with no line.
  const room: Record<number, number> = { 2: 50, 3: 200, 4: -1, 5: 0, 6: 100, 7: 200 };
  // Slide 7's body shrinks once the line passes 40 characters; slide 3's line itself shrinks past 70.
  const fitCheck: FitCheck = async (post) => {
    const problems = post.slides.flatMap((s, i) => ((s.hook?.text.length ?? 0) > room[i + 1]! || room[i + 1] === -1 ? [`slide ${i + 1} text fit: x`] : []));
    const sizes = post.slides.map((s, i) => {
      const n = s.hook?.text.length ?? 0;
      return [
        { element: 'helios-text__body', px: i + 1 === 7 && n > 40 ? 38 : 44 },
        ...(s.hook ? [{ element: 'helios-hook', px: i + 1 === 3 && n > 70 ? 28 : 34 }] : []),
      ];
    });
    return { ok: problems.length === 0, problems, violations: [], slideText: [], sizes };
  };
  const r = await measureHookBudgets(filled, { cover: null, slides: filled.slides.map(() => null) }, { source: '', sourceUrl: '', publishedAt: '' }, fitCheck, [30, 60, 90]);
  assert.deepEqual(r.budgets, [fillerLine(30).length, fillerLine(60).length, 0, 0, fillerLine(90).length, fillerLine(30).length]);
  assert.deepEqual(r.baselineFailures, [4]);
  assert.ok(fillerLine(60).length <= 60 && fillerLine(60).length > 50);
});

const usage = { input_tokens: 5000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 2500 };
const msg = (content: unknown[]) =>
  ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null, content, usage }) as unknown as Anthropic.Message;

test('runHookPass: cached system + tool, budgets in the user message, one retry, hooks applied to the draft', async () => {
  const requests: any[] = [];
  const responses = [
    msg([{ type: 'tool_use', id: 't1', name: 'submit_hooks', input: { hooks: entries({ 3: { slide: 3, line: 'It "worked".', kind: 'tease', facts: [] } }) } }]),
    msg([{ type: 'tool_use', id: 't2', name: 'submit_hooks', input: { hooks: entries({ 3: { slide: 3, line: 'Then came the pitch.', kind: 'tease', facts: [] } }) } }]),
  ];
  const create: MessagesCreate = async (p) => {
    requests.push(structuredClone(p));
    return responses.shift()!;
  };
  const r = await runHookPass(brief(), sifDraft(), BUDGETS, { create });
  assert.ok(r.ok);
  assert.equal(r.retries, 1);
  assert.equal(r.draft.slides[1]!.hook?.text, 'Then came the pitch.');
  assert.equal(r.filled.slides[1]!.hook?.text, 'Then came the pitch.');
  assert.equal(requests[0].model, STAGE_MODELS.hook.model);
  assert.equal(requests[0].system[0].text, HOOK_SYSTEM);
  assert.ok(requests[0].system[0].cache_control, 'system prompt is cached');
  assert.ok(requests[0].tools[0].cache_control, 'the submit tool is cached');
  assert.match(requests[0].messages[0].content, /\n\nBUDGETS\nSLIDE 2: 80 characters\nSLIDE 3: 80 characters\nSLIDE 4: 0 characters \(full\)/);
});
