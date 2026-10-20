// tests/lfd-caption-lines.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { LFD_CAPTION_MODEL, LFD_CAPTION_SYSTEM, writeLfdCaptionLines } from '@/lib/lfd/caption-lines';
import type { Ready } from '@/lib/lfd/types';
import { CAPTION_SHARED_RULES, HELIOS_CONTEXT } from '@/lib/social/captions/helios-context';

const ready = (i: number): Ready => ({
  pick: { key: `k${i}`, refs: [`r${i}`], origin: 'reels', headline: `H${i}`, sourceName: `Outlet ${i}`, url: `https://o${i}.com/a`, body: '', publishedAt: null, net: 1, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, lane: 'rundown' },
  copy: { key: `k${i}`, setup: '', headline: `Story ${i} Just Dropped`, highlight: '', names: [], body: `Body ${i} sentence one. Two`, photo: { kind: 'logo', query: 'q', subjects: [], alts: [] } },
  photo: { src: `https://img/${i}.jpg`, credit: `Credit ${i}`, kind: 'scene' },
});

const VALID = {
  opener: '⬅️ Swipe for a robot that folds laundry, a new Claude model and a chip fight.',
  body: 'A robot folded a full load of laundry on its own this week.\n\nAnthropic also put out a new Claude model.',
  question: 'Which one caught your attention? 👇',
  helios_line: 'For a real estate team, a faster model means listing follow-ups that go out in minutes, and at Helios that is the kind of thing we wire up. Follow for next week\'s roundup.',
};

function stub(reply: unknown | Error, opts: { noUsage?: boolean } = {}) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(p);
    if (reply instanceof Error) throw reply;
    return {
      id: 'm', type: 'message', role: 'assistant', model: LFD_CAPTION_MODEL, stop_reason: 'end_turn', stop_sequence: null,
      ...(opts.noUsage ? {} : { usage: { input_tokens: 2000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 3000 } }),
      content: [{ type: 'text', text: JSON.stringify(reply) }],
    } as unknown as Anthropic.Message;
  };
  return { create, calls };
}

const recent = [{ closing: 'At Helios we think law firms should care about this one.', buildLine: false, createdAt: new Date('2026-10-12T00:00:00Z') }];

test('valid lines pass through', async () => {
  const s = stub(VALID);
  const res = await writeLfdCaptionLines([0, 1].map(ready), recent, s.create);
  assert.deepEqual(res.lines, { opener: VALID.opener, body: VALID.body, question: VALID.question, heliosLine: VALID.helios_line });
  assert.ok(res.costUsd > 0, 'the call is priced');
  assert.equal(s.calls.length, 1);
});

test('opener over 125 chars gives null', async () => {
  const res = await writeLfdCaptionLines([ready(0)], [], stub({ ...VALID, opener: `Swipe ${'x'.repeat(125)}` }).create);
  assert.equal(res.lines, null);
  assert.match(res.reason ?? '', /opener/);
  assert.ok(res.costUsd > 0, 'a rejected reply still cost money');
});

test('helios_line without Helios gives null', async () => {
  const res = await writeLfdCaptionLines([ready(0)], [], stub({ ...VALID, helios_line: 'A law firm could use this. Follow for more.' }).create);
  assert.equal(res.lines, null);
});

test('Helios outside the Helios line gives null', async () => {
  for (const field of ['opener', 'body', 'question'] as const) {
    const res = await writeLfdCaptionLines([ready(0)], [], stub({ ...VALID, [field]: `${VALID[field]} Helios` }).create);
    assert.equal(res.lines, null, field);
  }
});

test('an empty body or question gives null', async () => {
  assert.equal((await writeLfdCaptionLines([ready(0)], [], stub({ ...VALID, body: '  ' }).create)).lines, null);
  assert.equal((await writeLfdCaptionLines([ready(0)], [], stub({ ...VALID, question: '' }).create)).lines, null);
});

test('emoji: at most two, none in the body or the Helios line', async () => {
  assert.equal((await writeLfdCaptionLines([ready(0)], [], stub({ ...VALID, helios_line: `${VALID.helios_line} 🚀` }).create)).lines, null);
  assert.equal((await writeLfdCaptionLines([ready(0)], [], stub({ ...VALID, body: `🤖 ${VALID.body}` }).create)).lines, null);
  assert.equal((await writeLfdCaptionLines([ready(0)], [], stub({ ...VALID, question: 'Which one caught your eye? 👇🔥' }).create)).lines, null);
});

test('a malformed reply gives null', async () => {
  assert.equal((await writeLfdCaptionLines([ready(0)], [], stub({ opener: 'Swipe' }).create)).lines, null);
  assert.equal((await writeLfdCaptionLines([ready(0)], [], stub('not an object').create)).lines, null);
});

test('create throws gives null', async () => {
  const res = await writeLfdCaptionLines([ready(0)], [], stub(new Error('budget')).create);
  assert.equal(res.lines, null);
  assert.equal(res.costUsd, 0);
  assert.match(res.reason ?? '', /budget/);
});

test('system is cached and contains HELIOS_CONTEXT; closings in user message', async () => {
  const s = stub(VALID);
  await writeLfdCaptionLines([0, 1].map(ready), recent, s.create);
  const p = s.calls[0]! as Anthropic.MessageCreateParamsNonStreaming & { output_config?: { effort?: string; format?: { type: string; schema: { required: string[] } } } };
  assert.equal(p.model, 'claude-sonnet-5-5');
  assert.equal(p.output_config?.effort, 'low');
  assert.equal(p.output_config?.format?.type, 'json_schema');
  assert.deepEqual(p.output_config?.format?.schema.required, ['opener', 'body', 'question', 'helios_line']);
  const system = p.system as Array<{ text: string; cache_control?: unknown }>;
  assert.equal(system.length, 1);
  assert.ok(system[0]!.cache_control, 'the system prefix carries the cache breakpoint');
  assert.ok(system[0]!.text.includes(HELIOS_CONTEXT));
  assert.ok(system[0]!.text.startsWith(LFD_CAPTION_SYSTEM));
  assert.ok(!system[0]!.text.includes('law firms should care'), 'closings stay out of the cached prefix');
  const user = String(p.messages[0]!.content);
  assert.match(user, /law firms should care/);
  assert.match(user, /include_build_line: false/);
  assert.match(user, /Story 0 Just Dropped/);
  assert.match(user, /Body 1 sentence one/);
});

test('no closings block when the log is empty', async () => {
  const s = stub(VALID);
  await writeLfdCaptionLines([ready(0)], [], s.create);
  assert.doesNotMatch(String(s.calls[0]!.messages[0]!.content), /Recent captions ended like this/);
});

test('the prompt is plain product copy: no em dashes', () => {
  assert.doesNotMatch(LFD_CAPTION_SYSTEM, /—/);
});

test('a reply with no usage never throws: the lines still come back, priced at 0', async () => {
  const res = await writeLfdCaptionLines([ready(0)], [], stub(VALID, { noUsage: true }).create);
  assert.ok(res.lines, res.reason);
  assert.ok(Number.isFinite(res.costUsd));
  const bad = await writeLfdCaptionLines([ready(0)], [], stub({ ...VALID, helios_line: 'no brand' }, { noUsage: true }).create);
  assert.equal(bad.lines, null);
});

test('the Helios line follows the shared rules: best-matching industry, not a recent one, no example list of its own', () => {
  const own = LFD_CAPTION_SYSTEM.slice(LFD_CAPTION_SYSTEM.indexOf(CAPTION_SHARED_RULES) + CAPTION_SHARED_RULES.length);
  assert.match(own, /industry from the Helios context that best matches the week's stories/);
  assert.match(own, /not one the recent closings used/);
  assert.doesNotMatch(own, /real estate|law firm|med spa|HVAC|consumer brand/i);
});
