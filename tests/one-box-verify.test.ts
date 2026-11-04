/** One-box seeding: page read and the independent verifier, with a stubbed client (no live call). */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { Ledger } from '@/lib/seed/one-box/budget';
import type { Client } from '@/lib/seed/one-box/search';
import type { Finding } from '@/lib/seed/one-box/types';
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
const art = (n: number) => ({ url: `https://news.test/${n}`, headline: `Headline ${n}`, outlet: 'News' });
const finding = (extra: Partial<Finding> = {}): Finding => ({ found: true, articles: [art(1), art(2)], ...extra });
const base = { input: { vertical: 'reels' as const, blurb: 'blurb' }, recordCost: async () => undefined };
const reader = async (url: string) => PAGE(url.includes('/1') ? 'alpha' : 'beta');

test('first article rejected, second accepted: the second is primary', async () => {
  const { client } = stub([false, true]);
  const r = await verifyFinding({ ...base, client, ledger: new Ledger('reels'), finding: finding(), readPage: reader });
  assert.ok(r.ok);
  assert.equal(r.verified.articles[0]!.url, 'https://news.test/2');
});

test('all rejected: ok:false and the reason names the first candidate', async () => {
  const { client } = stub([false]);
  const r = await verifyFinding({ ...base, client, ledger: new Ledger('reels'), finding: finding(), readPage: reader });
  assert.ok(!r.ok);
  assert.match(r.reason, /Headline 1/);
  assert.match(r.reason, /different story/);
});

test('an unreadable page is skipped without a verifier call', async () => {
  const { client, calls } = stub([true]);
  const r = await verifyFinding({ ...base, client, ledger: new Ledger('reels'), finding: finding({ articles: [art(1)] }), readPage: async () => null });
  assert.ok(!r.ok);
  assert.equal(calls.length, 0);
});

test('a private-host article is skipped', async () => {
  const { client, calls } = stub([true]);
  const r = await verifyFinding({ ...base, client, ledger: new Ledger('reels'), finding: finding({ articles: [{ url: 'http://10.0.0.1/x', headline: 'h', outlet: 'o' }] }), readPage: reader });
  assert.ok(!r.ok);
  assert.equal(calls.length, 0);
});

test('a Number whose value is not on the page fails', async () => {
  const { client } = stub([true]);
  const r = await verifyFinding({ ...base, client, ledger: new Ledger('stories'), input: { vertical: 'stories', series: 'guess_the_number', blurb: 'b' }, finding: finding({ articles: [art(1)], number: { value: '73%', fact: 'of x' } }), readPage: reader });
  assert.ok(!r.ok);
  assert.match(r.reason, /73%/);
});

test('a Number whose value is on the page passes', async () => {
  const { client } = stub([true]);
  const r = await verifyFinding({ ...base, client, ledger: new Ledger('stories'), input: { vertical: 'stories', series: 'guess_the_number', blurb: 'b' }, finding: finding({ articles: [art(1)], number: { value: '73%', fact: 'of x' } }), readPage: async () => `${PAGE('alpha')} the figure was 73% overall` });
  assert.ok(r.ok);
  assert.deepEqual(r.verified.number, { value: '73%', fact: 'of x' });
});

test('a Tool whose page does not mention its name fails; one that does passes', async () => {
  const tool = { name: 'Acme Studio', url: 'https://acme.test', description: 'd' };
  const stories = { vertical: 'stories' as const, series: 'free_vs_paid' as const, blurb: 'b' };
  const bad = await verifyFinding({ ...base, client: stub([true]).client, ledger: new Ledger('stories'), input: stories, finding: finding({ articles: [], tool }), readPage: reader });
  assert.ok(!bad.ok);
  const good = await verifyFinding({ ...base, client: stub([true]).client, ledger: new Ledger('stories'), input: stories, finding: finding({ articles: [], tool }), readPage: async () => `${PAGE('alpha')} welcome to acme studio` });
  assert.ok(good.ok, JSON.stringify(good));
  assert.equal(good.verified.tool?.name, 'Acme Studio');
});

test('huge usage stops further verifier calls at the cap', async () => {
  const { client, calls } = stub([false], { input_tokens: 5_000_000, output_tokens: 10 });
  const ledger = new Ledger('reels');
  const r = await verifyFinding({ ...base, client, ledger, finding: finding({ articles: [art(1), art(2), art(1)] }), readPage: reader });
  assert.ok(!r.ok);
  assert.equal(calls.length, 1);
  assert.match(r.reason, /35-cent limit/);
});

test('the verifier request caches the system and the tool, never the user turn', async () => {
  const { client, calls } = stub([true]);
  await verifyFinding({ ...base, client, ledger: new Ledger('reels'), finding: finding({ articles: [art(1)] }), readPage: reader });
  const p = calls[0]!;
  assert.ok((p.system as Anthropic.TextBlockParam[])[0]!.cache_control);
  assert.ok((p.tools as Array<{ cache_control?: unknown }>)[0]!.cache_control);
  assert.equal(typeof p.messages[0]!.content, 'string');
  assert.equal(p.model, 'claude-haiku-5-5');
});

test('Explainers with no pages fails with a plain reason', async () => {
  const { client } = stub([true]);
  const r = await verifyFinding({ ...base, client, ledger: new Ledger('explainers'), input: { vertical: 'explainers', blurb: 'AI hallucinations' }, finding: finding({ articles: [], conceptTitle: 'Hallucination' }), readPage: reader });
  assert.ok(!r.ok);
});

test('Free vs Paid with no tool reported fails before any verifier call', async () => {
  const { client, calls } = stub([true]);
  const r = await verifyFinding({ ...base, client, ledger: new Ledger('stories'), input: { vertical: 'stories', series: 'free_vs_paid', blurb: 'b' }, finding: finding(), readPage: reader });
  assert.ok(!r.ok);
  assert.match(r.reason, /No tool/);
  assert.equal(calls.length, 0);
});

test('Guess the Number with no number reported fails before any verifier call', async () => {
  const { client, calls } = stub([true]);
  const r = await verifyFinding({ ...base, client, ledger: new Ledger('stories'), input: { vertical: 'stories', series: 'guess_the_number', blurb: 'b' }, finding: finding(), readPage: reader });
  assert.ok(!r.ok);
  assert.equal(calls.length, 0);
});

test('a Number found only on a supporting page, not the primary, fails', async () => {
  const { client } = stub([true, true]);
  const r = await verifyFinding({ ...base, client, ledger: new Ledger('stories'), input: { vertical: 'stories', series: 'guess_the_number', blurb: 'b' }, finding: finding({ number: { value: '73%', fact: 'of x' } }), readPage: async (u) => (u.endsWith('/2') ? `${PAGE('beta')} was 73%` : PAGE('alpha')) });
  assert.ok(!r.ok);
});

test('a malformed article url is dropped, not thrown', async () => {
  const { client } = stub([true]);
  const r = await verifyFinding({ ...base, client, ledger: new Ledger('reels'), finding: finding({ articles: [{ url: 'https://', headline: 'h', outlet: 'o' }, art(2)] }), readPage: reader });
  assert.ok(r.ok);
});
