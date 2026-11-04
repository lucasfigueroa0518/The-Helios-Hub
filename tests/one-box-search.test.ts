/** One-box seeding: the agent search call, with a stubbed client (no live call). */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { Ledger } from '@/lib/seed/one-box/budget';
import { runSearch, type Client } from '@/lib/seed/one-box/search';

function stub(input: unknown, usage: Record<string, unknown> = { input_tokens: 1000, output_tokens: 200, server_tool_use: { web_search_requests: 2 } }) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: Client = {
    messages: {
      async create(params) {
        calls.push(params);
        return { id: 'm', type: 'message', role: 'assistant', model: 'stub', stop_reason: 'tool_use', stop_sequence: null, usage, content: input === undefined ? [{ type: 'text', text: 'no tool' }] : [{ type: 'tool_use', id: 't', name: 'report_finding', input }] } as unknown as Anthropic.Message;
      },
    },
  };
  return { client, calls };
}
const base = { input: { vertical: 'reels' as const, blurb: 'OpenAI shipped a thing' }, poolHeadlines: ['Existing headline'], recordCost: async () => undefined };

test('parses articles, number and tool extras', async () => {
  const { client } = stub({
    found: true, main_point: 'p', concept_title: 'Hallucination',
    articles: [{ url: 'https://a.test/1', headline: 'H1', outlet: 'A' }],
    number: { value: '40%', fact: 'of things', story_headline: 'S' },
    tool: { name: 'Tool', url: 'https://t.test', description: 'd' },
  });
  const r = await runSearch({ ...base, client, ledger: new Ledger('reels') });
  assert.ok('finding' in r);
  assert.deepEqual(r.finding.articles, [{ url: 'https://a.test/1', headline: 'H1', outlet: 'A' }]);
  assert.deepEqual(r.finding.number, { value: '40%', fact: 'of things', storyHeadline: 'S' });
  assert.equal(r.finding.tool?.name, 'Tool');
  assert.equal(r.finding.conceptTitle, 'Hallucination');
});

test('the request caches the system and the last tool, never the user turn', async () => {
  const { client, calls } = stub({ found: false, reason: 'none' });
  await runSearch({ ...base, client, ledger: new Ledger('reels') });
  const p = calls[0]!;
  assert.ok((p.system as Anthropic.TextBlockParam[])[0]!.cache_control);
  const tools = p.tools as Array<{ name: string; cache_control?: unknown }>;
  assert.equal(tools.length, 2);
  assert.equal(tools[0]!.name, 'web_search');
  assert.ok(tools[1]!.cache_control, 'last tool carries the breakpoint');
  const content = p.messages[0]!.content;
  assert.equal(typeof content, 'string', 'the user turn is a plain string with no cache_control');
  assert.ok((content as string).includes('OpenAI shipped a thing') && (content as string).includes('Existing headline'));
});

test('a private-host link becomes an unreadable hint and the call still happens', async () => {
  const { client, calls } = stub({ found: false, reason: 'none' });
  const r = await runSearch({ ...base, input: { ...base.input, link: 'http://127.0.0.1/secret' }, client, ledger: new Ledger('reels') });
  assert.equal(calls.length, 1);
  assert.ok('finding' in r);
  assert.match(calls[0]!.messages[0]!.content as string, /could not be read/);
});

test('a readable link goes in the user turn as a hint', async () => {
  const { client, calls } = stub({ found: false, reason: 'none' });
  await runSearch({ ...base, input: { ...base.input, link: 'https://news.test/a' }, client, ledger: new Ledger('reels'), readPage: async () => 'Page body '.repeat(40) });
  assert.match(calls[0]!.messages[0]!.content as string, /starting point/);
});

test('stops without calling when the ledger cannot afford the worst case', async () => {
  const { client, calls } = stub({ found: false });
  const ledger = new Ledger('reels');
  ledger.add(0.3);
  const r = await runSearch({ ...base, client, ledger });
  assert.deepEqual(r, { stopped: 'budget' });
  assert.equal(calls.length, 0);
});

test('a reply with no report_finding block is found:false with a reason', async () => {
  const { client } = stub(undefined);
  const r = await runSearch({ ...base, client, ledger: new Ledger('reels') });
  assert.ok('finding' in r);
  assert.equal(r.finding.found, false);
  assert.ok(r.finding.reason);
});

test('the ledger rises by the priced usage, and the cost is recorded', async () => {
  const { client } = stub({ found: false, reason: 'x' }, { input_tokens: 10_000, output_tokens: 1000, server_tool_use: { web_search_requests: 3 } });
  const ledger = new Ledger('reels');
  const recorded: number[] = [];
  await runSearch({ ...base, client, ledger, recordCost: async (usd) => void recorded.push(usd) });
  assert.ok(ledger.spent > 0.03 && ledger.spent < 0.2, String(ledger.spent));
  assert.deepEqual(recorded, [ledger.spent]);
});
