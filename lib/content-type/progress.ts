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
      `SELECT id::text, status, requested_at::text AS requested_at, started_at::text AS started_at
         FROM social.runs WHERE kind = 'daily' AND status IN ('requested', 'running') ORDER BY requested_at`,
    );
    if (!rows.length) return [];
    const secs = await typical(
      `SELECT extract(epoch FROM finished_at - started_at) AS secs FROM social.runs
        WHERE kind = 'daily' AND status IN ('ok', 'partial') AND started_at IS NOT NULL AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 15`,
    );
    return rows.map((r) => ({ id: r.id, label: 'Carousel run', state: r.status === 'running' ? 'running' : 'queued', stage: null, error: null, topicId: null, requestedAt: r.requested_at, startedAt: r.started_at, typicalSeconds: secs }) as ProgressItem);
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
  return [];
}
