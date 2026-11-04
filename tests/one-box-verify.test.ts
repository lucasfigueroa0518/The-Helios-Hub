/** One-box seeding: page read and the independent verifier, with a stubbed client (no live call). */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { Ledger } from '@/lib/seed/one-box/budget';
import type { Client } from '@/lib/seed/one-box/search';
import type { Entry, Finding, OneBoxInput } from '@/lib/seed/one-box/types';
import { verifyFinding } from '@/lib/seed/one-box/verify';

const PAGE = (word: string) => `${word} `.repeat(80);
function stub(verdicts: boolean[], usage: Record<string, unknown> = { input_tokens: 800, output_tokens: 40 }) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let n = 0;
  const client: Client = {
    messages: {
      async create(params) {
        calls.push(params);
        const matches = verdicts[Math.min(n++, verdicts.length - 1)]!;
        return { id: 'm', type: 'message', role: 'assistant', model: 'stub', stop_reason: 'tool_use', stop_sequence: null, usage, content: [{ type: 'tool_use', id: 't', name: 'report_verdict', input: { matches, reason: matches ? 'same story' : 'different story' } }] } as unknown as Anthropic.Message;
      },
    },
  };
  return { client, calls };
}
const e = (n: number): Entry => ({ headline: `Headline ${n}`, url: `https://news.test/${n}` });
const finding = (entries: Entry[] = [e(1), e(2)]): Finding => ({ found: true, entries });
const base = { input: { vertical: 'reels' } as OneBoxInput & { vertical: 'reels' }, recordCost: async () => undefined };
const reader = async (url: string) => PAGE(url.includes('/1') ? 'alpha' : 'beta');
const stories = (series: 'guess_the_number' | 'free_vs_paid'): OneBoxInput => ({ vertical: 'stories', series, blurb: 'b' });

test('first entry rejected, second accepted: the second is primary', async () => {
  const { client } = stub([false, true]);
  const r = await verifyFinding({ ...base, input: { vertical: 'reels', blurb: 'b' }, client, ledger: new Ledger('reels'), finding: finding(), readPage: reader });
  assert.ok(r.ok);
  assert.equal(r.verified.passed[0]!.url, 'https://news.test/2');
  assert.equal(r.verified.passed.length, 1);
});

test('all rejected: ok:false and the reason names the closest entry', async () => {
  const { client } = stub([false]);
  const r = await verifyFinding({ ...base, input: { vertical: 'reels', blurb: 'b' }, client, ledger: new Ledger('reels'), finding: finding(), readPage: reader });
  assert.ok(!r.ok);
  assert.match(r.reason, /Headline 1/);
  assert.match(r.reason, /different story/);
});

test('an entry missing a required field is not verified and no call is made', async () => {
  const { client, calls } = stub([true]);
  const r = await verifyFinding({ ...base, input: { vertical: 'carousels', blurb: 'b' }, client, ledger: new Ledger('carousels'), finding: finding([{ headline: 'only a headline' }]), readPage: reader });
  assert.ok(!r.ok);
  assert.match(r.reason, /missing url/);
  assert.equal(calls.length, 0);
});

test('an unreadable page and a private host are skipped without a verifier call', async () => {
  const { client, calls } = stub([true]);
  const r1 = await verifyFinding({ ...base, input: { vertical: 'reels', blurb: 'b' }, client, ledger: new Ledger('reels'), finding: finding([e(1)]), readPage: async () => null });
  const r2 = await verifyFinding({ ...base, input: { vertical: 'reels', blurb: 'b' }, client, ledger: new Ledger('reels'), finding: finding([{ headline: 'h', url: 'http://10.0.0.1/x' }]), readPage: reader });
  assert.ok(!r1.ok && !r2.ok);
  assert.equal(calls.length, 0);
});

test('Guess the Number: the figure must be on the page', async () => {
  const num: Entry = { value: '73%', fact: 'of x', url: 'https://news.test/1' };
  const bad = await verifyFinding({ ...base, input: stories('guess_the_number'), client: stub([true]).client, ledger: new Ledger('stories'), finding: finding([num]), readPage: reader });
  assert.ok(!bad.ok);
  assert.match(bad.reason, /73%/);
  const good = await verifyFinding({ ...base, input: stories('guess_the_number'), client: stub([true]).client, ledger: new Ledger('stories'), finding: finding([num]), readPage: async () => `${PAGE('alpha')} the figure was 73% overall` });
  assert.ok(good.ok);
});

test('Free vs. Paid: the tool’s page must mention its name', async () => {
  const tool: Entry = { toolName: 'Acme Studio', url: 'https://acme.test', description: 'd' };
  const bad = await verifyFinding({ ...base, input: stories('free_vs_paid'), client: stub([true]).client, ledger: new Ledger('stories'), finding: finding([tool]), readPage: reader });
  assert.ok(!bad.ok);
  const good = await verifyFinding({ ...base, input: stories('free_vs_paid'), client: stub([true]).client, ledger: new Ledger('stories'), finding: finding([tool]), readPage: async () => `${PAGE('alpha')} welcome to acme studio` });
  assert.ok(good.ok);
});

test('Explainers keeps every page that passes as source material', async () => {
  const { client } = stub([true, true]);
  const r = await verifyFinding({ ...base, input: { vertical: 'explainers', blurb: 'AI hallucinations' }, client, ledger: new Ledger('explainers'), finding: finding([{ title: 'Hallucination', sourceUrl: 'https://news.test/1' }, { title: 'Hallucination', sourceUrl: 'https://news.test/2' }]), readPage: reader });
  assert.ok(r.ok);
  assert.equal(r.verified.passed.length, 2);
});

test('huge usage stops further verifier calls at the cap', async () => {
  const { client, calls } = stub([false], { input_tokens: 5_000_000, output_tokens: 10 });
  const r = await verifyFinding({ ...base, input: { vertical: 'reels', blurb: 'b' }, client, ledger: new Ledger('reels'), finding: finding([e(1), e(2), e(3)]), readPage: reader });
  assert.ok(!r.ok);
  assert.equal(calls.length, 1);
  assert.match(r.reason, /35-cent limit/);
});

test('the verifier request caches the system and the tool, never the user turn', async () => {
  const { client, calls } = stub([true]);
  await verifyFinding({ ...base, input: { vertical: 'reels', blurb: 'b' }, client, ledger: new Ledger('reels'), finding: finding([e(1)]), readPage: reader });
  const p = calls[0]!;
  assert.ok((p.system as Anthropic.TextBlockParam[])[0]!.cache_control);
  assert.ok((p.tools as Array<{ cache_control?: unknown }>)[0]!.cache_control);
  assert.equal(typeof p.messages[0]!.content, 'string');
  assert.equal(p.model, 'claude-haiku-5-5');
});
