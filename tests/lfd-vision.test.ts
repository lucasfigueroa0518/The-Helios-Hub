import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { checkSlide, VISION_MODEL, VISION_SYSTEM, VISION_TOOL } from '@/lib/lfd/vision';

const png = Buffer.from('fake-png-bytes');
const story = { headline: 'Bose Brought Back Wired Earbuds', body: 'They plug into USB-C', names: ['Bose'] };
const usage = { input_tokens: 1000, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const reply = (content: unknown[]): Anthropic.Message => ({ id: 'm', type: 'message', role: 'assistant', model: VISION_MODEL, stop_reason: 'tool_use', stop_sequence: null, usage, content } as unknown as Anthropic.Message);
const verdict = (input: Record<string, unknown>) => reply([{ type: 'tool_use', id: 't', name: 'submit_verdict', input }]);

test('the request is one cached-prefix Haiku call with the image and the story in the user turn', async () => {
  let sent: Anthropic.MessageCreateParamsNonStreaming | undefined;
  await checkSlide(async (p) => { sent = p; return verdict({ shows_story_subject: true, generic_stock: false, reason: 'Bose earbuds' }); }, png, story);
  const p = sent!;
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.ok(p.max_tokens <= 500);
  const system = p.system as Anthropic.TextBlockParam[];
  assert.equal(system.at(-1)!.text, VISION_SYSTEM);
  assert.ok(system.at(-1)!.cache_control, 'system is a cached block');
  const tools = p.tools as Anthropic.Tool[];
  assert.equal(tools.length, 1);
  assert.equal(tools[0]!.name, 'submit_verdict');
  assert.ok(tools[0]!.cache_control, 'tool is cached');
  assert.deepEqual(p.tool_choice, { type: 'tool', name: 'submit_verdict' });
  assert.equal(p.messages.length, 1);
  const content = p.messages[0]!.content as Anthropic.ContentBlockParam[];
  assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } });
  assert.equal(content[1]!.type, 'text');
  assert.deepEqual(JSON.parse((content[1] as Anthropic.TextBlockParam).text), story);
  assert.ok(content.every((b) => !('cache_control' in b)), 'no breakpoint on the per-slide suffix');
});

test('the verdict tool is strict-shaped', () => {
  const schema = VISION_TOOL.input_schema as unknown as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
  assert.deepEqual(Object.keys(schema.properties).sort(), ['generic_stock', 'reason', 'shows_story_subject']);
  assert.deepEqual([...schema.required].sort(), ['generic_stock', 'reason', 'shows_story_subject']);
  assert.equal(schema.additionalProperties, false);
  assert.match(VISION_SYSTEM, /untrusted/);
});

test('subject shown and not generic stock passes', async () => {
  const r = await checkSlide(async () => verdict({ shows_story_subject: true, generic_stock: false, reason: 'Bose earbuds on a table' }), png, story);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'Bose earbuds on a table');
  assert.ok(r.costUsd > 0);
});

test('generic stock fails even when the model also says it shows the subject', async () => {
  const r = await checkSlide(async () => verdict({ shows_story_subject: true, generic_stock: true, reason: 'a stack of newspapers' }), png, story);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'a stack of newspapers');
});

test('not the story subject fails', async () => {
  const r = await checkSlide(async () => verdict({ shows_story_subject: false, generic_stock: false, reason: 'a different company logo' }), png, story);
  assert.equal(r.ok, false);
});

test('no tool call fails open as vision unavailable, still priced', async () => {
  const r = await checkSlide(async () => reply([{ type: 'text', text: 'hmm' }]), png, story);
  assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: true, reason: 'vision unavailable' });
  assert.ok(r.costUsd > 0);
});

test('a throwing call fails open as vision unavailable', async () => {
  const r = await checkSlide(async () => { throw new Error('budget exhausted'); }, png, story);
  assert.deepEqual(r, { ok: true, reason: 'vision unavailable', costUsd: 0 });
});
