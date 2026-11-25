// tests/lfd-caption-lines.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import {
  checkLfdCaptionLines,
  LFD_CAPTION_INSTRUCTIONS,
  LFD_CAPTION_MODEL,
  LFD_CAPTION_VERSION,
  lfdCaptionSystem,
  writeLfdCaptionLines,
} from '@/lib/lfd/caption-lines';
import type { Ready } from '@/lib/lfd/types';
import { readHeliosVoice } from '@/lib/social/voice/voice';

const ready = (i: number): Ready => ({
  pick: { key: `k${i}`, refs: [`r${i}`], origin: 'reels', headline: `H${i}`, sourceName: `Outlet ${i}`, url: `https://o${i}.com/a`, body: '', publishedAt: null, net: 1, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, builder: null, eventDate: null, lane: 'rundown' },
  copy: { key: `k${i}`, setup: '', headline: `Story ${i} Just Dropped`, highlight: '', names: [], body: `Body ${i} sentence one. Two`, photo: { kind: 'logo', query: 'q', subjects: [], alts: [] } },
  photo: { src: `https://img/${i}.jpg`, credit: `Credit ${i}`, kind: 'scene' },
});

const VALID = {
  opener: '⬅️ Swipe for a robot that folds laundry and a new Claude model.',
  body: 'A robot folded a full load of laundry on its own this week.\nAnthropic also put out a new Claude model.',
  question: 'Which one caught your attention? 👇',
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

const recent = [{ closing: 'Which of these would change your week?', buildLine: false, createdAt: new Date('2026-10-12T00:00:00Z') }];
const two = [0, 1].map(ready);

test('valid lines pass through: opener, body, question only', async () => {
  const s = stub(VALID);
  const res = await writeLfdCaptionLines(two, recent, s.create);
  assert.deepEqual(res.lines, VALID);
  assert.ok(res.costUsd > 0, 'the call is priced');
  assert.equal(s.calls.length, 1);
});

test('body lines are trimmed and blank lines collapse to single newlines', () => {
  const lines = checkLfdCaptionLines({ ...VALID, body: '  Line one.  \n\n\nLine two.  ' }, 2);
  assert.equal(lines.body, 'Line one.\nLine two.');
});

test('a body whose line count differs from the story count gives null', async () => {
  const res = await writeLfdCaptionLines([0, 1, 2].map(ready), [], stub(VALID).create);
  assert.equal(res.lines, null);
  assert.match(res.reason ?? '', /2 lines for 3 stories/);
  assert.doesNotThrow(() => checkLfdCaptionLines(VALID), 'no story count: no line-count check');
});

test('opener over 125 chars gives null', async () => {
  const res = await writeLfdCaptionLines([ready(0)], [], stub({ ...VALID, body: 'One line.', opener: `Swipe ${'x'.repeat(125)}` }).create);
  assert.equal(res.lines, null);
  assert.match(res.reason ?? '', /opener/);
  assert.ok(res.costUsd > 0, 'a rejected reply still cost money');
});

test('Helios named in any field gives null', () => {
  for (const field of ['opener', 'body', 'question'] as const) {
    const raw = { ...VALID, [field]: field === 'body' ? `${VALID.body} Helios` : `${VALID[field]} Helios` };
    assert.throws(() => checkLfdCaptionLines(raw, 2), /names Helios/, field);
  }
});

test('en and em dashes give null', () => {
  assert.throws(() => checkLfdCaptionLines({ ...VALID, opener: 'Swipe — three stories' }, 2), /dash/);
  assert.throws(() => checkLfdCaptionLines({ ...VALID, question: 'Which one, 2024–2026?' }, 2), /dash/);
});

test('an empty body or question gives null', async () => {
  assert.equal((await writeLfdCaptionLines(two, [], stub({ ...VALID, body: '  ' }).create)).lines, null);
  assert.equal((await writeLfdCaptionLines(two, [], stub({ ...VALID, question: '' }).create)).lines, null);
});

test('emoji: none in the body, at most two in total', () => {
  assert.throws(() => checkLfdCaptionLines({ ...VALID, body: `🤖 ${VALID.body}` }, 2), /body has an emoji/);
  assert.throws(() => checkLfdCaptionLines({ ...VALID, question: 'Which one caught your eye? 👇🔥' }, 2), /3 emoji/);
  assert.doesNotThrow(() => checkLfdCaptionLines({ ...VALID, question: 'Which one caught your eye? 👇' }, 2));
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

test('system is the cached voice + instructions; stories and recent questions in the user message', async () => {
  const s = stub(VALID);
  await writeLfdCaptionLines(two, recent, s.create);
  const p = s.calls[0]! as Anthropic.MessageCreateParamsNonStreaming & { output_config?: { effort?: string; format?: { type: string; schema: { required: string[] } } } };
  assert.equal(p.model, 'claude-sonnet-5-5');
  assert.equal(p.output_config?.effort, 'low');
  assert.equal(p.output_config?.format?.type, 'json_schema');
  assert.deepEqual(p.output_config?.format?.schema.required, ['opener', 'body', 'question']);
  const system = p.system as Array<{ text: string; cache_control?: unknown }>;
  assert.equal(system.length, 1);
  assert.ok(system[0]!.cache_control, 'the system prefix carries the cache breakpoint');
  assert.equal(system[0]!.text, lfdCaptionSystem());
  assert.ok(system[0]!.text.startsWith(readHeliosVoice()), 'the shared voice leads the prefix');
  assert.ok(system[0]!.text.includes(LFD_CAPTION_INSTRUCTIONS));
  assert.ok(system[0]!.text.includes(LFD_CAPTION_VERSION));
  assert.ok(!system[0]!.text.includes('change your week'), 'recent questions stay out of the cached prefix');
  const user = String(p.messages[0]!.content);
  assert.match(user, /change your week/);
  assert.match(user, /Story 0 Just Dropped/);
  assert.match(user, /Body 1 sentence one/);
});

test('no recent-questions block when the log is empty', async () => {
  const s = stub({ ...VALID, body: 'One line.' });
  await writeLfdCaptionLines([ready(0)], [], s.create);
  assert.doesNotMatch(String(s.calls[0]!.messages[0]!.content), /Recent posts asked/);
});

test('the instructions are plain product copy: no em dashes', () => {
  assert.doesNotMatch(LFD_CAPTION_INSTRUCTIONS, /—/);
});

test('a reply with no usage never throws: the lines still come back, priced at 0', async () => {
  const res = await writeLfdCaptionLines(two, [], stub(VALID, { noUsage: true }).create);
  assert.ok(res.lines, res.reason);
  assert.ok(Number.isFinite(res.costUsd));
  const bad = await writeLfdCaptionLines(two, [], stub({ ...VALID, opener: 'Helios says swipe' }, { noUsage: true }).create);
  assert.equal(bad.lines, null);
});

test('lfd-caption-v3 (caption voice, 2026-11-24): version bumped, no model-written Helios line', () => {
  assert.equal(LFD_CAPTION_VERSION, 'lfd-caption-v3');
  assert.match(LFD_CAPTION_INSTRUCTIONS, /No field names Helios/);
  assert.match(LFD_CAPTION_INSTRUCTIONS, /exactly one line per story/);
});
