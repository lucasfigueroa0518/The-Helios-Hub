import { NextResponse } from 'next/server';

import type { Queryable } from '@/lib/explainers/db';
import { bankingFor, loadCutouts, type BankedCutout } from '@/lib/real-case/bank';
import { listRealCaseJobs } from '@/lib/real-case/jobs';
import { listLatestScouts, listStories, nyDate, storyScores } from '@/lib/real-case/repository';
import { ensureRealCaseSchema } from '@/lib/real-case/schema';
import { storyBarMisses } from '@/lib/real-case/scoring';
import { loadRealCaseSettings } from '@/lib/real-case/settings';
import type { StoryRow } from '@/lib/real-case/types';

/** The AI News Explained lab (RC-10): what the page shows, and the session rule its routes share. */

export class LabError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Session = { email: string } | null;

/**
 * Session check and error mapping for every /api/real-case route. In development the lab works
 * without a session, as the meme lab does (the middleware has the same rule); production requires one.
 */
export async function realCaseRoute(
  fn: (ctx: { db: Queryable }) => Promise<unknown>,
  opts: { session?: () => Promise<Session>; db?: () => Promise<Queryable> } = {},
): Promise<NextResponse> {
  let session = opts.session ? await opts.session() : await (await import('@/lib/session')).getSession();
  if (!session && !opts.session && process.env.NODE_ENV === 'development') session = { email: 'local' };
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const db = opts.db ? await opts.db() : await (await import('@/lib/explainers/connection')).explainersDb();
    await ensureRealCaseSchema(db);
    return NextResponse.json(await fn({ db }));
  } catch (err) {
    if (err instanceof LabError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export type LabStory = {
  id: string;
  title: string;
  term: string;
  summary: string;
  polarity: string;
  status: string;
  /** The event date (RC-27); null on the first build's stories. */
  eventDate: string | null;
  topic: string | null;
  score: number | null;
  scores: Record<string, number> | null;
  misses: string[];
  rejectReason: string | null;
  story: StoryRow['story'];
  /** Each player's banked art, for the thumbnails (RC-33, RC-34); null when it has none. */
  banked: ({ kind: 'logo' | 'cutout'; id: string } | null)[];
  facts: { id: string; text: string; act: string | null; core: boolean; check: string; via: string | null; detail: string | null; source: { url: string; publisher: string } | null }[];
  createdAt: string;
};

function labStory(s: StoryRow, topics: Map<string, string>, fresh: { windowDays: number; now: Date }, cutouts: readonly BankedCutout[]): LabStory {
  const scores = storyScores(s, fresh);
  return {
    id: s.id,
    title: s.title,
    term: s.term,
    summary: s.summary,
    polarity: s.polarity,
    status: s.status,
    eventDate: s.event_date,
    topic: s.topic_id ? (topics.get(s.topic_id) ?? null) : null,
    score: s.weighted_score,
    scores,
    misses: scores ? storyBarMisses(scores) : [],
    rejectReason: s.reject_reason,
    story: s.story,
    banked: (Array.isArray(s.story?.cast) ? s.story.cast : []).map((m) => {
      const b = bankingFor(m, cutouts);
      return b.cutout ? { kind: 'cutout', id: b.cutout.id } : b.logo ? { kind: 'logo', id: b.logo.id } : null;
    }),
    facts: s.claims.map((c) => {
      const src = s.sources.find((x) => x.id === c.source_id);
      return {
        id: c.id,
        text: c.text,
        act: c.act ?? null,
        core: c.core,
        check: c.check?.status ?? 'unchecked',
        via: c.check?.via ?? null,
        detail: c.check?.detail ?? null,
        source: src ? { url: src.url, publisher: src.publisher } : null,
      };
    }),
    createdAt: s.created_at,
  };
}

export async function labData(db: Queryable, now: Date = new Date()) {
  const settings = await loadRealCaseSettings(db);
  const fresh = { windowDays: settings.news_window_days, now };
  const stories = await listStories(db, ['pool', 'promoted', 'rendered'], 200);
  const others = await listStories(db, ['rejected', 'displaced', 'archived'], 60);
  const { rows: topicRows } = await db.query<{ id: string; title: string }>('SELECT id, title FROM explainers.topics');
  const topics = new Map(topicRows.map((t) => [t.id, t.title]));
  const jobs = await listRealCaseJobs(db, 30);
  const cutouts = loadCutouts();
  const { rows: videos } = await db.query<{ job_id: string; id: string }>(
    `SELECT job_id, id FROM real_case.artifacts WHERE kind = 'video' AND job_id = ANY($1::uuid[])`,
    [jobs.map((j) => j.id)],
  );
  const videoOf = new Map(videos.map((v) => [v.job_id, v.id]));
  const { rows: spend } = await db.query<{ usd: unknown }>(
    `SELECT COALESCE(SUM(usd), 0) AS usd FROM real_case.cost_events WHERE (created_at AT TIME ZONE 'America/New_York')::date = $1::date`,
    [nyDate(now)],
  );
  return {
    settings,
    spendTodayUsd: Number(spend[0]?.usd ?? 0),
    pool: stories.map((s) => labStory(s, topics, fresh, cutouts)),
    others: others.map((s) => labStory(s, topics, fresh, cutouts)),
    scouts: await listLatestScouts(db, 30),
    jobs: jobs.map((j) => ({
      id: j.id,
      storyId: j.story_id,
      title: j.story_title,
      term: j.term,
      status: j.status,
      stage: j.stage,
      spendUsd: j.spend_usd,
      capUsd: j.spend_cap_usd,
      error: j.error,
      flags: j.flags,
      requestedAt: j.requested_at,
      finishedAt: j.finished_at,
      videoId: videoOf.get(j.id) ?? null,
    })),
  };
}

export type LabData = Awaited<ReturnType<typeof labData>>;
