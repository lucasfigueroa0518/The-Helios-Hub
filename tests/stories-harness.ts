/**
 * Offline harness for the Stories pipeline tests: PGlite with the real
 * `stories` schema plus the slices of `reels` and `social` Stories reads
 * (column names as in db/reels_schema.sql and Tommy's db/social_schema.sql),
 * and stubs for Jev, the Sonnet writer, the photo finder and the renderer.
 * Nothing here touches the network.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { JevTransport } from '@/lib/reels/jev/runner';
import { openLocalStoriesDb } from '@/lib/stories/local-db';
import type { PhotoFinder, PhotoRequest } from '@/lib/stories/photos';
import type { Renderer } from '@/lib/stories/render/render';
import type { Photo } from '@/lib/stories/render/types';
import type { WriterCreate } from '@/lib/stories/writer';

export const SOURCE_SQL = `
CREATE SCHEMA IF NOT EXISTS reels;
CREATE TABLE reels.score_slates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, ny_date date NOT NULL, scored_at timestamptz NOT NULL DEFAULT now(), pass1_version text, pass2_version text);
CREATE TABLE reels.post_ideas (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE reels.sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_url text NOT NULL, headline text NOT NULL, body text NOT NULL DEFAULT '', source_name text NOT NULL, adapter_id text NOT NULL DEFAULT 'rss', publish_time timestamptz, ingest_time timestamptz NOT NULL DEFAULT now());
CREATE TABLE reels.post_idea_members (source_id uuid PRIMARY KEY, post_idea_id uuid NOT NULL, role text NOT NULL);
CREATE TABLE reels.idea_scores (slate_id uuid NOT NULL, post_idea_id uuid NOT NULL, origin text NOT NULL, net double precision, selected boolean NOT NULL DEFAULT false, chosen_bucket text, blockbuster double precision NOT NULL DEFAULT 0, PRIMARY KEY (slate_id, post_idea_id));
CREATE TABLE reels.list_catalog (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), list_id text NOT NULL, entry_name text NOT NULL, entry_url text NOT NULL, description text);
CREATE SCHEMA IF NOT EXISTS social;
CREATE TABLE social.runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL DEFAULT 'daily', started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, record jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE social.posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, slug text NOT NULL UNIQUE, story_id text, title text NOT NULL DEFAULT '', status text NOT NULL, brief jsonb, render jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE social.used_photos (id bigserial PRIMARY KEY, url text NOT NULL, used_at timestamptz NOT NULL, story_id text NOT NULL, slide integer NOT NULL, source text, qid text, subject text, credit text, scene text, post_id uuid, UNIQUE (url, used_at, story_id, slide));
`;

export async function harnessDb() {
  const { db, pg } = await openLocalStoriesDb();
  await pg.exec(SOURCE_SQL);
  return { db, pg };
}

/** Insert one reels idea (primary source + score) into a slate. */
export async function addIdea(db: Awaited<ReturnType<typeof harnessDb>>['db'], slateId: string, o: { headline: string; url: string; net: number; blockbuster?: number; bucket?: string; body?: string; source?: string }) {
  const idea = (await db.query<{ id: string }>(`INSERT INTO reels.post_ideas DEFAULT VALUES RETURNING id`)).rows[0]!.id;
  const src = (await db.query<{ id: string }>(`INSERT INTO reels.sources (canonical_url, headline, body, source_name, publish_time) VALUES ($1, $2, $3, $4, '2026-10-07T12:00:00Z') RETURNING id`, [o.url, o.headline, o.body ?? `${o.headline}. Body text.`, o.source ?? 'The Verge'])).rows[0]!.id;
  await db.query(`INSERT INTO reels.post_idea_members (source_id, post_idea_id, role) VALUES ($1, $2, 'primary')`, [src, idea]);
  await db.query(`INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, blockbuster, chosen_bucket) VALUES ($1, $2, 'timely', $3, $4, $5)`, [slateId, idea, o.net, o.blockbuster ?? 0, o.bucket ?? null]);
  return idea;
}

export async function addSlate(db: Awaited<ReturnType<typeof harnessDb>>['db'], nyDate: string) {
  return (await db.query<{ id: string }>(`INSERT INTO reels.score_slates (ny_date) VALUES ($1) RETURNING id`, [nyDate])).rows[0]!.id;
}

/** A Jev stub: answers every noul with `p(component-ish key, state)`. */
export function stubJev(p: (key: string, state: EntryType) => number = () => 0.8): JevTransport & { calls: Array<{ keys: string[]; state: EntryType }> } {
  const calls: Array<{ keys: string[]; state: EntryType }> = [];
  return {
    calls,
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q): Promise<SystemOneResult<Q>> {
      const keys = Object.keys(questions);
      calls.push({ keys, state });
      const answers = Object.fromEntries(keys.map((k) => [k, { type: 'noul', noul: p(k, state) }]));
      return { model: 'jev-stub-1', answers, usage: { input_tokens: 400, output_tokens: 10 } } as unknown as SystemOneResult<Q>;
    },
  };
}

/** A Sonnet stub: the tool named in the request answers with `byTool[name](params)`. */
export function stubWriter(byTool: Record<string, (params: Record<string, unknown>, n: number) => unknown>): WriterCreate & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const counts = new Map<string, number>();
  const fn = (async (params: Record<string, unknown>) => {
    calls.push(params);
    const tool = (params.tools as Array<{ name: string; type?: string }>).find((t) => !t.type)!;
    const n = (counts.get(tool.name) ?? 0) + 1;
    counts.set(tool.name, n);
    const input = byTool[tool.name]!(params, n);
    return {
      id: `msg_${calls.length}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null,
      usage: { input_tokens: 3000, output_tokens: 600, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, server_tool_use: tool.name === 'submit_pairs' ? { web_search_requests: 4 } : undefined },
      content: [{ type: 'tool_use', id: 't', name: tool.name, input }],
    } as unknown as Anthropic.Message;
  }) as WriterCreate & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

export function stubPhotos(pick: (req: PhotoRequest) => Photo | null = (r) => ({ src: `https://photos.test/${encodeURIComponent(r.query)}.jpg`, credit: `Photo: ${r.query}`, kind: r.kind === 'person' ? 'person' : r.kind === 'logo' ? 'logo' : 'scene' })): PhotoFinder & { requests: PhotoRequest[] } {
  const requests: PhotoRequest[] = [];
  return {
    requests,
    usd: 0,
    async find(req) {
      requests.push(req);
      const p = pick(req);
      return p && !req.exclude.has(p.src) ? p : null;
    },
  };
}

/** A renderer stub: every frame renders clean to a tiny JPEG. */
export async function stubRenderer(): Promise<Renderer & { renders: number }> {
  const sharp = (await import('sharp')).default;
  const jpeg = await sharp({ create: { width: 108, height: 192, channels: 3, background: '#000' } }).jpeg().toBuffer();
  const r = {
    renders: 0,
    async render(frames: Parameters<Renderer['render']>[0]) {
      r.renders++;
      return { ok: true, problems: [], frames: frames.map((f, i) => ({ index: i + 1, role: f.data.role, problems: [], jpeg, bytes: jpeg.length })) };
    },
    async close() {},
  };
  return r;
}
