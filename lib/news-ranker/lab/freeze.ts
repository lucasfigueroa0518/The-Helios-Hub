/**
 * Freeze a candidate set (CONTRACT.md §Lab): SET_SIZE central-intake stories chosen for information (pickSet) from
 * the last 7 NY days, read inside ONE read-only transaction (CLAUDE.md
 * §Read-only DB checks: BEGIN READ ONLY … ROLLBACK, never a session SET).
 * Writes only the local lab store.
 */
import { listStories } from '@/lib/intake/read';
import type { IntakeQuery, ScoredStory } from '@/lib/intake/types';

import { namesIn } from '../scores';

import { toRankerStory } from './adapters';
import { saveSet, type LabDb, type LabSet, type SetStory } from './db';

export const SET_SIZE = 80;
export const WINDOW_DAYS = 7;
/** A company/name may appear in at most this many picked headlines, so no one company dominates what we learn. */
export const NAME_CAP = 3;
/** A source may supply at most this many picked stories. */
export const SOURCE_CAP = 8;

/** Midnight in New York, `days` NY days before `now`'s NY day. */
export function nyDayStart(now: Date, days: number): Date {
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const offsetMs = now.getTime() - ny.getTime();
  ny.setHours(0, 0, 0, 0);
  ny.setDate(ny.getDate() - days);
  return new Date(ny.getTime() + offsetMs);
}

const major = (s: ScoredStory) => s.scores['major-news'] ?? 0;
const builder = (s: ScoredStory) => s.scores['story-builder'] ?? 0;
const best = (s: ScoredStory) => Math.max(major(s), builder(s));
const sourcesOf = (s: ScoredStory) => new Set(s.members.map((m) => m.sourceName));
/** Deterministic pseudo-random order key from the id (FNV-1a). */
const hash = (id: string) => { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/**
 * Strata chosen for INFORMATION, not for quality (D5: the graded set should
 * teach as much as possible about what makes a story good). Each stratum probes
 * one question about today's logic; the quotas sum to 1.
 *   top        what today's logic would pick: are its picks actually good?
 *   majorOnly  "important" but not built/found: does importance alone earn Cool or Need?
 *   builderOnly built/found but not "major": the stories today's queue undervalues
 *   wide       many independent sources: does wide coverage predict a good story?
 *   niche      one source, mid scores: hidden gems vs noise
 *   low        today's rejects (incl. outside the news_kind whitelist): what the old gate hid
 */
const STRATA: { id: string; share: number; test: (s: ScoredStory) => boolean; order: (s: ScoredStory) => number }[] = [
  { id: 'top', share: 0.2, test: (s) => best(s) >= 0.6, order: (s) => -best(s) },
  { id: 'majorOnly', share: 0.15, test: (s) => major(s) - builder(s) >= 0.3, order: (s) => builder(s) - major(s) },
  { id: 'builderOnly', share: 0.15, test: (s) => builder(s) - major(s) >= 0.3, order: (s) => major(s) - builder(s) },
  { id: 'wide', share: 0.125, test: (s) => sourcesOf(s).size >= 3, order: (s) => -sourcesOf(s).size },
  { id: 'niche', share: 0.125, test: (s) => sourcesOf(s).size === 1 && best(s) >= 0.3 && best(s) < 0.6, order: (s) => hash(s.id) },
  { id: 'low', share: 0.25, test: (s) => best(s) < 0.3, order: (s) => hash(s.id) },
];

/**
 * Pure pick (deterministic): fill each stratum's quota in its own order under
 * per-name and per-source caps, top up from the remaining stories spread
 * across the score range, then shuffle so the grader never sees score order.
 */
export function pickSet(stories: readonly ScoredStory[], size = SET_SIZE): ScoredStory[] {
  // News only: a story needs one member that is neither a Field Notes item nor a trivia research page
  // (search:trivia deposits from the AI Trivia writer, lib/intake/orders.ts), so no trivia fact enters the set.
  const pool = stories.filter((s) => s.members.some((m) => m.family !== 'field-notes' && !m.sourceId.startsWith('search:trivia')));
  const picked: ScoredStory[] = [];
  const taken = new Set<string>();
  const nameCount = new Map<string, number>();
  const sourceCount = new Map<string, number>();
  const fits = (s: ScoredStory) =>
    !taken.has(s.id) &&
    [...namesIn(s.headline)].every((n) => (nameCount.get(n) ?? 0) < NAME_CAP) &&
    [...sourcesOf(s)].every((n) => (sourceCount.get(n) ?? 0) < SOURCE_CAP);
  const take = (s: ScoredStory) => {
    taken.add(s.id);
    picked.push(s);
    for (const n of namesIn(s.headline)) nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    for (const n of sourcesOf(s)) sourceCount.set(n, (sourceCount.get(n) ?? 0) + 1);
  };
  for (const st of STRATA) {
    const quota = Math.round(st.share * size);
    let got = 0;
    for (const s of pool.filter(st.test).sort((a, b) => st.order(a) - st.order(b) || (a.id < b.id ? -1 : 1))) {
      if (got >= quota) break;
      if (fits(s)) { take(s); got++; }
    }
  }
  // Top up: spread over what is left by score, caps first, then without caps if still short.
  const rest = pool.filter((s) => !taken.has(s.id)).sort((a, b) => best(b) - best(a) || (a.id < b.id ? -1 : 1));
  const want = size - picked.length;
  if (want > 0 && rest.length) {
    const step = rest.length / want;
    for (let i = 0; i < rest.length && picked.length < size; i++) {
      const s = rest[Math.floor((i * step) % rest.length)]!;
      if (fits(s)) take(s);
    }
    for (const s of rest) { if (picked.length >= size) break; if (!taken.has(s.id)) take(s); }
  }
  return picked.sort((a, b) => hash(a.id) - hash(b.id));
}

/** Run `fn` inside BEGIN READ ONLY … ROLLBACK on one connection. */
export async function readOnly<T>(connectionString: string, fn: (q: IntakeQuery) => Promise<T>): Promise<T> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    return await fn({ query: async (text, params) => ({ rows: (await client.query(text, params)).rows }) });
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

/** With `ids`: freeze exactly those intake stories, in that order (hand-picked sets), from the last `days` NY days. */
export async function freezeSet(db: LabDb, q: IntakeQuery, now = new Date(), opts: { ids?: string[]; days?: number; prefix?: string } = {}): Promise<LabSet> {
  const windowFrom = nyDayStart(now, opts.days ?? WINDOW_DAYS);
  const stories = await listStories(q, { since: windowFrom, until: now });
  const byId = new Map(stories.map((s) => [s.id, s]));
  const picked = opts.ids ? opts.ids.map((id) => byId.get(id)).filter((s): s is ScoredStory => !!s) : pickSet(stories);
  const set: LabSet = {
    id: `${opts.prefix ?? 'set'}-${now.toISOString().slice(0, 16).replace(/[:T]/g, '')}`,
    createdAt: now,
    windowFrom,
    windowTo: now,
    stories: picked.map((s): SetStory => ({ ...toRankerStory(s), sources: [...new Set(s.members.map((m) => m.sourceName))] })),
  };
  await saveSet(db, set);
  return set;
}

/** The prod connection for the read (DIRECT_DATABASE_URL first: a real session for one transaction). */
export function intakeUrl(env = process.env): string {
  const local = (u?: string) => !!u && /@(127\.0\.0\.1|localhost)[:/]/.test(u);
  let url = env.NEWS_RANKER_INTAKE_URL || env.DIRECT_DATABASE_URL || env.DATABASE_URL;
  // `next dev` loads .env.development.local, which points at a local Postgres that holds no intake.
  // The intake lives in Supabase, so read .env.local's URL (still only inside BEGIN READ ONLY … ROLLBACK).
  if (!env.NEWS_RANKER_INTAKE_URL && local(url)) {
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      const file = fs.readFileSync(require('node:path').join(process.cwd(), '.env.local'), 'utf8') as string;
      const pick = (k: string) => file.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
      url = pick('DIRECT_DATABASE_URL') || pick('DATABASE_URL') || url;
    } catch { /* keep url */ }
  }
  if (!url) throw new Error('DIRECT_DATABASE_URL or DATABASE_URL is not set');
  return url;
}
