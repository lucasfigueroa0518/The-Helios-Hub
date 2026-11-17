/** Offline stubs for the intake scorecard/score/seed tests: a recording Jev and story builders. No live calls. */
import fs from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { IntakeItem, IntakeJev, IntakeQuery, IntakeStory } from '@/lib/intake/types';
import type { JevRequest } from '@/lib/reels/jev/runner';
import type { JevMeta } from '@/lib/social/jev/client';
import { schemaSql } from '@/lib/stories/local-db';

export type SocialCall = { state: Record<string, unknown>; questions: Questions; meta: JevMeta };

export function stubJev(opts: { nouls?: Record<string, number>; capAfter?: number } = {}) {
  const social: SocialCall[] = [];
  const reels: JevRequest<Questions>[] = [];
  let calls = 0;
  const cap = () => {
    calls += 1;
    if (opts.capAfter !== undefined && calls > opts.capAfter) {
      const e = new Error('intake cap reached');
      e.name = 'IntakeCapReached';
      throw e;
    }
  };
  const jev: IntakeJev = {
    asSocialAsk: () => async (request, meta) => {
      cap();
      social.push({ state: request.state as Record<string, unknown>, questions: request.questions, meta });
      const answers: Record<string, { noul: number }> = {};
      for (const k of Object.keys(request.questions)) answers[k] = { noul: opts.nouls?.[k] ?? 0.5 };
      return { answers, usage: { input_tokens: 1000, output_tokens: 0 }, model: 'jev-stub' };
    },
    asReelsRunner: () => ({
      async ask<const Q extends Questions>(request: JevRequest<Q>) {
        cap();
        reels.push(request as unknown as JevRequest<Questions>);
        const answers: Record<string, unknown> = {};
        for (const k of Object.keys(request.questions)) answers[k] = { score: 4, confidence: 0.9, noul: 0.3 };
        return { model: 'jev-stub', answers, usage: { input_tokens: 1000, output_tokens: 0 } } as unknown as SystemOneResult<Q>;
      },
      get callCount() {
        return reels.length;
      },
    }),
    get usd() {
      return 0;
    },
    get calls() {
      return calls;
    },
  };
  return { jev, social, reels };
}

const T0 = new Date('2026-11-08T12:00:00Z');

export function item(p: Partial<IntakeItem> & Pick<IntakeItem, 'key' | 'family'>): IntakeItem {
  const sourceId = p.sourceId ?? (p.family === 'feeds' ? 'feed:techcrunch' : p.family === 'search' ? 'search:b6' : p.family === 'seed' ? 'seed:lfd' : 'hacker-news');
  return {
    sourceId,
    sourceName: p.sourceName ?? sourceId,
    sourceType: p.sourceType ?? (p.family === 'feeds' ? 'feed' : p.family === 'seed' ? 'seed' : ('rss' as IntakeItem['sourceType'])),
    headline: p.headline ?? `Headline ${p.key}`,
    body: p.body ?? `Body text of ${p.key}. `.repeat(20),
    url: p.url ?? `https://example.com/${p.key}`,
    publishTime: p.publishTime === undefined ? T0 : p.publishTime,
    firstSeenAt: p.firstSeenAt ?? T0,
    lastSeenAt: p.lastSeenAt ?? T0,
    engagement: null,
    dropReason: null,
    storyId: p.storyId ?? null,
    role: p.role ?? 'supporting',
    ...p,
  };
}

/** A uuid for story ids (intake.stories.id is uuid). */
export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function story(id: string, members: IntakeItem[], headline = `Story ${id}`): IntakeStory {
  return { id, representativeKey: members[0]?.key ?? '', headline, firstSeenAt: T0, lastJoinedAt: T0, mergedInto: null, members: members.map((m) => ({ ...m, storyId: id })) };
}

/** Minimal local stand-in for db/intake_schema.sql (Owner A) while that file is not written; columns follow lib/intake/types.ts. */
const FIXTURE_SCHEMA = `
CREATE SCHEMA IF NOT EXISTS intake;
CREATE TABLE intake.stories (id uuid PRIMARY KEY, representative_key text NOT NULL, headline text NOT NULL,
  first_seen_at timestamptz NOT NULL, last_joined_at timestamptz NOT NULL, merged_into uuid);
CREATE TABLE intake.items (key text PRIMARY KEY, family text NOT NULL, source_id text NOT NULL, source_name text NOT NULL,
  source_type text NOT NULL, headline text NOT NULL, body text NOT NULL DEFAULT '', url text NOT NULL, publish_time timestamptz,
  first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL, engagement jsonb, drop_reason text,
  story_id uuid REFERENCES intake.stories (id), role text, joined_at timestamptz, seeded_by text, seed_order text);
CREATE TABLE intake.scores (story_id uuid NOT NULL, scorecard text NOT NULL, version text NOT NULL, member_hash text NOT NULL,
  answers jsonb NOT NULL, result jsonb NOT NULL, usd double precision NOT NULL DEFAULT 0, scored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, scorecard));
`;

export async function intakeDb(): Promise<{ q: IntakeQuery; usedFixture: boolean }> {
  const pg = new PGlite();
  const real = path.join(process.cwd(), 'db', 'intake_schema.sql');
  const usedFixture = !fs.existsSync(real);
  await pg.exec(usedFixture ? FIXTURE_SCHEMA : schemaSql(real));
  const q: IntakeQuery = { query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await pg.query<T>(text, params)).rows }) };
  return { q, usedFixture };
}
