import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { checkSubmission, LFD_SYSTEM, LFD_TOOL, normalize, writeStories } from '@/lib/lfd/write';
import type { Pick, StoryCopy } from '@/lib/lfd/types';

const photo = { kind: 'company', query: 'Anthropic logo', subjects: [{ name: 'Anthropic', type: 'organization' as const }], alts: [] };
const copy = (o: Partial<StoryCopy> & { key: string }): StoryCopy => ({ setup: '', headline: 'Claude Haiku 5.5 Is Here', highlight: '', names: ['Claude'], body: 'Prices drop sharply. Anthropic says most requests get cheaper', photo, ...o });

test('checkSubmission rejects missing keys, over-long fields and a setup without a colon', () => {
  assert.throws(
    () => checkSubmission({ stories: [copy({ key: 'a', headline: 'x'.repeat(71), setup: 'No colon here' })] }, ['a', 'b']),
    (err: Error) => /missing story b/.test(err.message) && /headline is 71/.test(err.message) && /setup must end with ":"/.test(err.message),
  );
});

test('normalize strips a leading dash and a final period, drops a non-substring highlight, keeps 2 setups by rank', () => {
  const out = normalize([
    copy({ key: 'c', setup: 'Third setup:', headline: '– Third Story', highlight: 'Not In Headline', body: 'Ends with a period.' }),
    copy({ key: 'a', setup: 'First setup:', headline: 'First Story', highlight: 'First' }),
    copy({ key: 'b', setup: 'Second setup:', headline: 'Second Story' }),
  ], ['a', 'b', 'c']);
  const byKey = Object.fromEntries(out.map((s) => [s.key, s]));
  assert.equal(byKey.c!.headline, 'Third Story');
  assert.equal(byKey.c!.highlight, '');
  assert.equal(byKey.c!.body, 'Ends with a period');
  assert.equal(byKey.c!.setup, '', 'the third setup by rank is removed');
  assert.equal(byKey.a!.highlight, 'First');
  assert.equal(byKey.b!.setup, 'Second setup:');
});

test('the tool and system prompt are static (cacheable) and the tool is strict-shaped', () => {
  assert.equal(LFD_TOOL.name, 'submit_rundown');
  assert.match(LFD_SYSTEM, /punchy and literally true/i);
  assert.doesNotMatch(LFD_SYSTEM, /\$\{/);
  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'object') {
      assert.equal(n.additionalProperties, false, `${path} must set additionalProperties: false`);
      const props = Object.keys((n.properties as Record<string, unknown>) ?? {});
      assert.deepEqual([...((n.required as string[]) ?? [])].sort(), [...props].sort(), `${path} required must list every property`);
      for (const [k, v] of Object.entries((n.properties as Record<string, unknown>) ?? {})) walk(v, `${path}.${k}`);
    }
    if (n.type === 'array') walk(n.items, `${path}[]`);
  };
  walk(LFD_TOOL.input_schema, 'input_schema');
});

test('writeStories sends the cached system prompt and returns normalized copy', async () => {
  const pick = { key: 'a', refs: ['r'], origin: 'reels', headline: 'H', sourceName: 'Verge', url: 'https://v.com/a', body: 'b', publishedAt: null, net: 0.5, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, lane: 'rundown' } satisfies Pick;
  let sent: Anthropic.MessageCreateParamsNonStreaming | null = null;
  const create = async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    sent = p;
    return {
      id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      content: [{ type: 'tool_use', id: 't', name: 'submit_rundown', input: { stories: [copy({ key: 'a', body: 'Done.' })] } }],
    } as unknown as Anthropic.Message;
  };
  const res = await writeStories(create, [{ pick, body: 'source text' }]);
  assert.ok(res.ok);
  assert.equal(res.stories[0]!.body, 'Done');
  const system = (sent as unknown as { system: Array<{ cache_control?: unknown }> }).system;
  assert.ok(system.at(-1)!.cache_control, 'system prompt carries a cache breakpoint');
});

test('checkSubmission flags a story missing names or with a malformed photo instead of passing it to normalize', () => {
  const photoOk = { kind: 'company', query: 'q', subjects: [], alts: [] };
  assert.throws(
    () => checkSubmission({ stories: [{ key: 'a', setup: '', headline: 'H', highlight: '', body: 'b', photo: photoOk }] }, ['a']),
    (err: Error) => /names/.test(err.message),
  );
  assert.throws(
    () => checkSubmission({ stories: [{ key: 'a', setup: '', headline: 'H', highlight: '', names: [], body: 'b' }] }, ['a']),
    (err: Error) => /photo/.test(err.message),
  );
});

test('writeStories retries once when the first submission omits names, and returns the valid retry', async () => {
  const pick = { key: 'a', refs: ['r'], origin: 'reels', headline: 'H', sourceName: 'Verge', url: 'https://v.com/a', body: 'b', publishedAt: null, net: 0.5, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, lane: 'rundown' } satisfies Pick;
  const usage = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const reply = (input: unknown) => ({
    id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null, usage,
    content: [{ type: 'tool_use', id: 't', name: 'submit_rundown', input }],
  }) as unknown as Anthropic.Message;
  const { names: _omit, ...noNames } = copy({ key: 'a', body: 'Done.' });
  const replies = [reply({ stories: [noNames] }), reply({ stories: [copy({ key: 'a', body: 'Done.' })] })];
  let calls = 0;
  const create = async () => replies[calls++]!;
  const res = await writeStories(create, [{ pick, body: 'source text' }]);
  assert.equal(calls, 2, 'the malformed first submission triggers exactly one retry');
  assert.ok(res.ok);
  assert.equal(res.stories[0]!.body, 'Done');
});
