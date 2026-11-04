/** One-box seeding: the orchestrator end to end with a stubbed client and stubbed add functions (no live call). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import type Anthropic from '@anthropic-ai/sdk';

import type { FileDeps } from '@/lib/seed/one-box/file';
import { createRequest, listCards } from '@/lib/seed/one-box/requests';
import { runOneBox } from '@/lib/seed/one-box/run';
import type { Client } from '@/lib/seed/one-box/search';
import type { OneBoxInput } from '@/lib/seed/one-box/types';
import type { Query } from '@/lib/social/store/pg';

const schemaSql = (file: string) => fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
async function db(): Promise<Query> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_hub_schema.sql'));
  return async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
}
const PAGE = (w: string) => `${w} `.repeat(80);
const art = (n: number) => ({ url: `https://news.test/${n}`, headline: `Headline ${n}` });

/** A client that answers the search call with `finding` and each verifier call from `verdicts`. */
function client(finding: unknown, verdicts: boolean[], usage: Record<string, unknown> = { input_tokens: 800, output_tokens: 40 }) {
  const log: string[] = [];
  let v = 0;
  const c: Client = {
    messages: {
      async create(p) {
        const isSearch = (p.tools as Array<{ name?: string }>).some((t) => t.name === 'web_search');
        log.push(isSearch ? 'search' : 'verify');
        const block = isSearch
          ? { type: 'tool_use', id: 't', name: 'report_finding', input: finding }
          : { type: 'tool_use', id: 't', name: 'report_verdict', input: { matches: verdicts[Math.min(v++, verdicts.length - 1)], reason: 'because' } };
        return { id: 'm', type: 'message', role: 'assistant', model: 'stub', stop_reason: 'tool_use', stop_sequence: null, usage, content: [block] } as unknown as Anthropic.Message;
      },
    },
  };
  return { c, log };
}
function fileDeps(over: Partial<FileDeps> = {}) {
  const filed: unknown[] = [];
  const d: FileDeps = {
    reel: async (a) => (filed.push(a), { status: 'added', id: 'r1', title: a.headline }),
    carousel: async (a) => (filed.push(a), { id: a.url, title: a.headline }),
    lfd: async (a) => (filed.push(a), { id: 'k', title: a.headline }),
    story: async (a) => (filed.push(a), { key: 'seed:1', title: 'T' }),
    explainer: async (a) => (filed.push(a), { topicId: 'e1', title: a.title }),
    headlines: async () => ['Existing headline'],
    existing: async () => null,
    ...over,
  };
  return { d, filed };
}
const NOW = new Date('2026-11-04T14:00:00Z');
async function go(input: OneBoxInput, cl: Client, d: FileDeps, q: Query, readPage: (u: string) => Promise<string | null> = async (u) => PAGE(u)) {
  const { id } = await createRequest(q, input, NOW);
  await runOneBox({ q, id, input, client: cl, fileDeps: d, readPage, recordCost: async () => undefined, now: NOW });
  const { rows } = await q(`SELECT status, stage, message, idea_id, cost_usd::float AS cost FROM social_hub.seed_requests WHERE id = $1::uuid`, [id]);
  return rows[0] as { status: string; stage: string; message: string | null; idea_id: string | null; cost: number };
}
const input: OneBoxInput = { vertical: 'reels', blurb: 'OpenAI shipped a thing' };

test('happy path files once and marks done with the idea id', async () => {
  const q = await db();
  const { c, log } = client({ found: true, entries: [art(1)] }, [true]);
  const { d, filed } = fileDeps();
  const row = await go(input, c, d, q);
  assert.deepEqual([row.status, row.idea_id], ['done', 'r1']);
  assert.equal(filed.length, 1);
  assert.deepEqual(log, ['search', 'verify']);
  assert.ok(row.cost > 0);
});

test('first article fails the verifier, second passes: the second is filed', async () => {
  const q = await db();
  const { c } = client({ found: true, entries: [art(1), art(2)] }, [false, true]);
  const { d, filed } = fileDeps();
  const row = await go(input, c, d, q);
  assert.equal(row.status, 'done');
  assert.equal((filed[0] as { url: string }).url, 'https://news.test/2');
});

test('huge usage stops after the first call: nothing filed, cost recorded, message names the 35-cent limit', async () => {
  const q = await db();
  const { c, log } = client({ found: true, entries: [art(1), art(2)] }, [true], { input_tokens: 5_000_000, output_tokens: 10 });
  const { d, filed } = fileDeps();
  const row = await go(input, c, d, q);
  assert.equal(row.status, 'failed');
  assert.match(row.message!, /35-cent limit/);
  assert.equal(filed.length, 0);
  assert.deepEqual(log, ['search']);
  assert.ok(row.cost > 1);
});

test('duplicate_of from the model fails with that headline and files nothing', async () => {
  const q = await db();
  const { c } = client({ found: false, duplicate_of: 'Existing headline', entries: [] }, [true]);
  const { d, filed } = fileDeps();
  const row = await go(input, c, d, q);
  assert.equal(row.status, 'failed');
  assert.match(row.message!, /Existing headline/);
  assert.equal(filed.length, 0);
});

test('found:false fails with the model’s reason', async () => {
  const q = await db();
  const { c } = client({ found: false, reason: 'No article covers that.', entries: [] }, [true]);
  const row = await go(input, c, fileDeps().d, q);
  assert.deepEqual([row.status, row.message], ['failed', 'No article covers that.']);
});

test('an existing duplicate of the found URL fails before any verifier call', async () => {
  const q = await db();
  const { c, log } = client({ found: true, entries: [art(1)] }, [true]);
  const { d, filed } = fileDeps({ existing: async () => 'Already queued' });
  const row = await go(input, c, d, q);
  assert.equal(row.status, 'failed');
  assert.match(row.message!, /Already queued/);
  assert.deepEqual(log, ['search']);
  assert.equal(filed.length, 0);
});

test('verifier says no to everything: failed, nothing filed, message names the closest source', async () => {
  const q = await db();
  const { c } = client({ found: true, entries: [art(1)] }, [false]);
  const { d, filed } = fileDeps();
  const row = await go(input, c, d, q);
  assert.equal(row.status, 'failed');
  assert.match(row.message!, /Headline 1/);
  assert.equal(filed.length, 0);
});

test('a thrown filer error leaves the request failed, never working', async () => {
  const q = await db();
  const { c } = client({ found: true, entries: [art(1)] }, [true]);
  const row = await go(input, c, fileDeps({ reel: async () => { throw new Error('boom'); } }).d, q);
  assert.equal(row.status, 'failed');
});

test('an add function refusal is shown as the failure reason', async () => {
  const q = await db();
  const { c } = client({ found: true, entries: [art(1)] }, [true]);
  const row = await go({ vertical: 'carousels', blurb: 'b' }, c, fileDeps({ carousel: async () => { throw new Error('You have 10 seeded stories waiting.'); } }).d, q);
  assert.deepEqual([row.status, row.message], ['failed', 'You have 10 seeded stories waiting. Nothing was added.']);
});

test('the stage is filing at the moment the filer runs, and a crash there reads as may-have-been-added once stale', async () => {
  const q = await db();
  const { c } = client({ found: true, entries: [art(1)] }, [true]);
  let stageDuringFiling = '';
  const { id } = await createRequest(q, input, NOW);
  const d = fileDeps({
    reel: async (a) => {
      stageDuringFiling = (await q(`SELECT stage FROM social_hub.seed_requests WHERE id = $1::uuid`, [id])).rows[0].stage;
      return { status: 'added', id: 'r1', title: a.headline };
    },
  }).d;
  await runOneBox({ q, id, input, client: c, fileDeps: d, readPage: async (u) => PAGE(u), recordCost: async () => undefined, now: NOW });
  assert.equal(stageDuringFiling, 'filing');
  assert.equal((await listCards(q, 'reels', NOW)).length, 0, 'a done request shows no card');
});
