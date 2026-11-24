/** One-box seeding, Field Notes: free with a link (one tiny classify call), search without. All stubbed; no live call. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import type Anthropic from '@anthropic-ai/sdk';

import type { FileDeps } from '@/lib/seed/one-box/file';
import { createRequest } from '@/lib/seed/one-box/requests';
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
const USAGE = { input_tokens: 400, output_tokens: 30 };

/** Answers classify (report_kind), search (web_search) and verify (report_verdict) calls. */
function client(o: { kind?: unknown; finding?: unknown; verdict?: boolean }) {
  const log: string[] = [];
  const params: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const c: Client = {
    messages: {
      async create(p) {
        params.push(p);
        const names = (p.tools as Array<{ name?: string }>).map((t) => t.name);
        let block: unknown;
        if (names.includes('web_search')) (log.push('search'), (block = { type: 'tool_use', id: 't', name: 'report_finding', input: o.finding }));
        else if (names.includes('report_verdict')) (log.push('verify'), (block = { type: 'tool_use', id: 't', name: 'report_verdict', input: { matches: o.verdict ?? true, reason: 'ok' } }));
        else (log.push('classify'), (block = { type: 'tool_use', id: 't', name: names[0], input: o.kind }));
        return { id: 'm', type: 'message', role: 'assistant', model: 'stub', stop_reason: 'tool_use', stop_sequence: null, usage: USAGE, content: [block] } as unknown as Anthropic.Message;
      },
    },
  };
  return { c, log, params };
}
function deps(over: Partial<FileDeps> = {}) {
  const filed: unknown[] = [];
  const unused = async () => {
    throw new Error('not used');
  };
  const d: FileDeps = {
    reel: unused as never, carousel: unused as never, lfd: unused as never, story: unused as never, explainer: unused as never,
    fieldNote: async (a) => (filed.push(a), { id: 'tip1', title: 'owner/repo' }),
    headlines: async () => [],
    existing: async () => null,
    ...over,
  };
  return { d, filed };
}
const NOW = new Date('2026-11-24T14:00:00Z');
async function go(input: OneBoxInput, cl: Client, d: FileDeps, q: Query, readPage: (u: string) => Promise<string | null>) {
  const { id } = await createRequest(q, input, NOW);
  await runOneBox({ q, id, input, client: cl, fileDeps: d, readPage, recordCost: async () => undefined, now: NOW });
  const { rows } = await q(`SELECT status, message, idea_id, cost_usd::float AS cost FROM social_hub.seed_requests WHERE id = $1::uuid`, [id]);
  return rows[0] as { status: string; message: string | null; idea_id: string | null; cost: number };
}

test('with a link: one classify call, no readPage, files the link and the blurb as the note', async () => {
  const q = await db();
  const link = 'https://news.test/2026/11/some-article-about-a-tool';
  const { c, log } = client({ kind: { leaf: 'skill', want: 'faster' } });
  const { d, filed } = deps();
  let reads = 0;
  const row = await go({ vertical: 'field_notes', blurb: 'a faster skill', link }, c, d, q, async () => (reads++, PAGE('x')));
  assert.deepEqual([row.status, row.idea_id], ['done', 'tip1']);
  assert.deepEqual(log, ['classify']);
  assert.equal(reads, 0);
  assert.deepEqual(filed, [{ sourceUrl: link, leaf: 'skill', want: 'faster', note: 'a faster skill' }]);
  assert.ok(row.cost > 0 && row.cost < 0.01);
});

test('without a link: search, verify, file with the finding\'s leaf and want', async () => {
  const q = await db();
  const finding = { found: true, entries: [{ url: 'https://github.com/owner/repo', leaf: 'repo_mcp', want: 'newly_possible' }] };
  const { c, log } = client({ finding, verdict: true });
  const { d, filed } = deps();
  const row = await go({ vertical: 'field_notes', blurb: 'an mcp server for x' }, c, d, q, async (u) => PAGE(u));
  assert.deepEqual([row.status, row.idea_id], ['done', 'tip1']);
  assert.deepEqual(log, ['search', 'verify']);
  assert.deepEqual(filed, [{ sourceUrl: 'https://github.com/owner/repo', leaf: 'repo_mcp', want: 'newly_possible', note: 'an mcp server for x' }]);
});

test('classify returns an unknown leaf: failed, nothing filed', async () => {
  const q = await db();
  const { c } = client({ kind: { leaf: 'cooking', want: 'faster' } });
  const { d, filed } = deps();
  const row = await go({ vertical: 'field_notes', blurb: 'x', link: 'https://a.test/x' }, c, d, q, async () => null);
  assert.equal(row.status, 'failed');
  assert.equal(row.message, "That didn't match a Field Notes kind; nothing was added.");
  assert.equal(filed.length, 0);
});

test('the filer reporting a duplicate fails the request without adding', async () => {
  const q = await db();
  const { c } = client({ kind: { leaf: 'skill', want: 'faster' } });
  const { d } = deps({ fieldNote: async () => ({ duplicate: 'owner/repo' }) });
  const row = await go({ vertical: 'field_notes', blurb: 'x', link: 'https://github.com/owner/repo' }, c, d, q, async () => null);
  assert.equal(row.status, 'failed');
  assert.match(row.message ?? '', /owner\/repo/);
});

test('the classify request puts cache_control on the system block and not on the user turn', async () => {
  const q = await db();
  const { c, params } = client({ kind: { leaf: 'technique', want: 'better' } });
  await go({ vertical: 'field_notes', blurb: 'my note', link: 'https://a.test/x' }, c, deps().d, q, async () => null);
  const p = params[0]!;
  assert.equal(p.max_tokens, 200);
  assert.ok((p.system as Anthropic.TextBlockParam[])[0]!.cache_control);
  assert.ok((p.tools as Array<{ cache_control?: unknown }>).at(-1)!.cache_control);
  assert.equal(typeof p.messages[0]!.content, 'string');
  assert.ok(!(p.messages[0]!.content as string).includes('repo_free_alternative'), 'lists live in the cached system prompt');
  assert.ok((p.system as Anthropic.TextBlockParam[])[0]!.text.includes('repo_free_alternative'));
  assert.ok((p.system as Anthropic.TextBlockParam[])[0]!.text.includes('stay_current'));
});
