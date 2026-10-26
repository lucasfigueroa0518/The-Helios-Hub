import { dbQuery } from '@/lib/db';
import type { ContentType } from '@/lib/content-type/posting';

/**
 * What a content type is making right now, for the "it's working" strip on
 * its page: each item in flight, since when, and how long the same kind of
 * job usually takes (the median of its recent finished ones), so the page can
 * say how much longer. Read only.
 */
export type ProgressItem = {
  id: string;
  label: string;
  state: 'queued' | 'running' | 'failed';
  /** What it is doing, when the pipeline says (Explainers keep a stage). */
  stage: string | null;
  /** Why a failed run stopped. Null while it is still queued or running. */
  error: string | null;
  /** The idea this run belongs to, when the type has one (Explainers: the topic). */
  topicId: string | null;
  /** When it was queued, and when work began (null while queued). */
  requestedAt: string;
  startedAt: string | null;
  /** The usual running time in seconds, or null with too little history. */
  typicalSeconds: number | null;
};

const SERIES: Record<string, string> = { morning_download: 'Morning Download', guess_the_number: 'Guess the Number', free_vs_paid: 'Free vs. Paid' };

const median = (xs: number[]): number | null => {
  const s = xs.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  return s.length >= 2 ? Math.round(s[Math.floor(s.length / 2)]!) : null;
};

async function typical(sql: string, params: unknown[] = []): Promise<number | null> {
  const { rows } = await dbQuery(sql, params);
  return median(rows.map((r) => Number(r.secs)));
}

export async function readProgress(type: ContentType): Promise<ProgressItem[]> {
  if (type === 'stories') {
    const { rows } = await dbQuery(
      `SELECT id::text, series, status, created_at::text AS requested_at, claimed_at::text AS started_at
         FROM stories.sets WHERE status IN ('requested', 'building') ORDER BY created_at`,
    );
    const out: ProgressItem[] = [];
    for (const r of rows) {
      const secs = await typical(
        `SELECT extract(epoch FROM built_at - claimed_at) AS secs FROM stories.sets
          WHERE series = $1 AND built_at IS NOT NULL AND claimed_at IS NOT NULL ORDER BY created_at DESC LIMIT 15`,
        [r.series],
      );
      out.push({ id: r.id, label: SERIES[r.series] ?? r.series, state: r.status === 'building' ? 'running' : 'queued', stage: null, error: null, topicId: null, requestedAt: r.requested_at, startedAt: r.started_at, typicalSeconds: secs });
    }
    return out;
  }
  if (type === 'carousels') {
    const { rows } = await dbQuery(
      `SELECT id::text, status, story_ids, requested_at::text AS requested_at, started_at::text AS started_at
         FROM social.runs WHERE kind = 'daily' AND status IN ('requested', 'running') ORDER BY requested_at`,
    );
    if (!rows.length) return [];
    const secs = await typical(
      `SELECT extract(epoch FROM finished_at - started_at) AS secs FROM social.runs
        WHERE kind = 'daily' AND status IN ('ok', 'partial') AND started_at IS NOT NULL AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 15`,
    );
    // A run asked for particular stories is one item per story, so each card shows its own; otherwise one item for the run.
    return rows.flatMap((r) => {
      const ids = (r.story_ids as string[] | null) ?? [];
      const item = (id: string, topicId: string | null) => ({ id, label: 'Carousel run', state: r.status === 'running' ? 'running' : 'queued', stage: null, error: null, topicId, requestedAt: r.requested_at, startedAt: r.started_at, typicalSeconds: secs }) as ProgressItem;
      return ids.length ? ids.map((storyId, i) => item(`${r.id}:${i}`, storyId)) : [item(r.id, null)];
    });
  }
  if (type === 'explainers') {
    const { rows } = await dbQuery(
      `SELECT j.id::text, j.topic_id::text AS topic_id, j.status, j.stage, j.error,
              j.requested_at::text AS requested_at, j.started_at::text AS started_at, t.title
         FROM explainers.jobs j
         JOIN explainers.topics t ON t.id = j.topic_id
        WHERE j.id IN (
                SELECT DISTINCT ON (topic_id) id FROM explainers.jobs
                 ORDER BY topic_id, requested_at DESC, seq DESC
              )
          AND j.status IN ('requested', 'running', 'failed')
          AND t.status <> 'archived'
        ORDER BY j.requested_at`,
    );
    if (!rows.length) return [];
    const secs = await typical(
      `SELECT extract(epoch FROM finished_at - started_at) AS secs FROM explainers.jobs
        WHERE status = 'ok' AND started_at IS NOT NULL AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 15`,
    );
    const state = (status: string): ProgressItem['state'] => (status === 'running' ? 'running' : status === 'failed' ? 'failed' : 'queued');
    return rows.map((r) => ({ id: r.id, label: r.title, state: state(r.status), stage: r.stage ?? null, error: r.error ?? null, topicId: r.topic_id, requestedAt: r.requested_at, startedAt: r.started_at, typicalSeconds: r.status === 'failed' ? null : secs }) as ProgressItem);
  }
  if (type === 'last_few_days') {
    const { rows } = await dbQuery(
      `SELECT id::text, status, requested_at::text AS requested_at, started_at::text AS started_at
         FROM lfd.runs WHERE status IN ('requested', 'running') ORDER BY requested_at`,
    );
    if (!rows.length) return [];
    const secs = await typical(
      `SELECT extract(epoch FROM finished_at - started_at) AS secs FROM lfd.runs
        WHERE status IN ('ok', 'partial') AND started_at IS NOT NULL AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 15`,
    );
    return rows.map((r) => ({ id: r.id, label: 'Last Few Days run', state: r.status === 'running' ? 'running' : 'queued', stage: null, error: null, topicId: null, requestedAt: r.requested_at, startedAt: r.started_at, typicalSeconds: secs }) as ProgressItem);
  }
  if (type === 'ai_events') {
    const { rows } = await dbQuery(
      `SELECT id::text, kind, status, requested_at::text AS requested_at, started_at::text AS started_at
         FROM ai_events.runs WHERE status IN ('requested', 'running') ORDER BY requested_at`,
    );
    if (!rows.length) return [];
    // A rebuild re-renders from cached scores, so it times against other rebuilds; a build against builds.
    const out: ProgressItem[] = [];
    for (const r of rows) {
      const secs = await typical(
        `SELECT extract(epoch FROM finished_at - started_at) AS secs FROM ai_events.runs
          WHERE kind = $1 AND status IN ('ok', 'partial') AND started_at IS NOT NULL AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 15`,
        [r.kind],
      );
      out.push({ id: r.id, label: r.kind === 'rebuild' ? 'AI Events rebuild' : 'AI Events run', state: r.status === 'running' ? 'running' : 'queued', stage: null, error: null, topicId: null, requestedAt: r.requested_at, startedAt: r.started_at, typicalSeconds: secs });
    }
    return out;
  }
  return [];
}

export type AllProgress = Record<'carousels' | 'stories' | 'explainers', ProgressItem[]> & {
  /** Optional, so a progress map built for the first three types (tests/social-hub-run-for.test.ts) still holds; missing reads as none. */
  last_few_days?: ProgressItem[];
  ai_events?: ProgressItem[];
};

/** Every type's runs in flight, for the Content page's cards and tiles. A type that cannot be read shows nothing in flight. */
export async function readAllProgress(): Promise<AllProgress> {
  const one = (t: ContentType) => readProgress(t).then((items) => items.filter((i) => i.state !== 'failed')).catch(() => [] as ProgressItem[]);
  const [carousels, stories, explainers, lastFewDays, aiEvents] = await Promise.all([one('carousels'), one('stories'), one('explainers'), one('last_few_days'), one('ai_events')]);
  return { carousels, stories, explainers, last_few_days: lastFewDays, ai_events: aiEvents };
}
