import type { Queryable } from '@/lib/explainers/db';
import { listPool, listTopics } from '@/lib/explainers/repository';
import { loadSettings, loadThemeBrief, type ExplainersSettings } from '@/lib/explainers/settings';
import type { CostVendor, JobRow, TopicRow, Verdict } from '@/lib/explainers/types';

/** Read models for the three Explainers tabs. Dates go out as ISO strings. */

function iso(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function serializeTopic(topic: TopicRow): TopicRow {
  return {
    ...topic,
    scored_at: iso(topic.scored_at),
    rendered_at: iso(topic.rendered_at),
    created_at: iso(topic.created_at)!,
    updated_at: iso(topic.updated_at)!,
  };
}

export type TopicsView = {
  pool: TopicRow[];
  /** Everything else, newest first: proposed, queued, promoted, rendered, rejected, displaced. */
  others: TopicRow[];
  settings: Pick<ExplainersSettings, 'auto_render' | 'pool_size' | 'mode'>;
};

export async function loadTopicsView(db: Queryable): Promise<TopicsView> {
  const [pool, others, settings] = await Promise.all([
    listPool(db),
    listTopics(db, ['proposed', 'promoted', 'queued', 'rendered', 'rejected', 'displaced']),
    loadSettings(db),
  ]);
  return {
    pool: pool.map(serializeTopic),
    others: others.map(serializeTopic),
    settings: { auto_render: settings.auto_render, pool_size: settings.pool_size, mode: settings.mode },
  };
}

export type JobSummary = JobRow & {
  topic_title: string;
  cost_by_vendor: { vendor: CostVendor; usd: number; unknown_count: number }[];
  artifact_count: number;
  lint_count: number;
  verdict: Verdict | null;
};

export async function loadReelsView(db: Queryable, limit = 50): Promise<JobSummary[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT j.*, t.title AS topic_title, f.verdict,
            (SELECT count(*)::int FROM explainers.artifacts a WHERE a.job_id = j.id) AS artifact_count,
            (SELECT count(*)::int FROM explainers.lint_violations l WHERE l.job_id = j.id) AS lint_count,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'vendor', c.vendor,
                       'usd', c.usd,
                       'unknown_count', c.unknown_count) ORDER BY c.vendor)
                FROM (SELECT vendor, SUM(usd)::float8 AS usd,
                             count(*) FILTER (WHERE NOT usd_known)::int AS unknown_count
                        FROM explainers.cost_events
                       WHERE job_id = j.id
                       GROUP BY vendor) c
            ), '[]'::json) AS cost_by_vendor
       FROM explainers.jobs j
       JOIN explainers.topics t ON t.id = j.topic_id
       LEFT JOIN explainers.feedback f ON f.job_id = j.id
      ORDER BY j.requested_at DESC, j.seq DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    ...(row as unknown as JobSummary),
    spend_usd: Number(row.spend_usd),
    spend_cap_usd: Number(row.spend_cap_usd),
    requested_at: iso(row.requested_at)!,
    started_at: iso(row.started_at),
    finished_at: iso(row.finished_at),
    verdict: (row.verdict as Verdict | null) ?? null,
  }));
}

export type SettingsView = { settings: ExplainersSettings; themeBrief: string };

export async function loadSettingsView(db: Queryable): Promise<SettingsView> {
  const settings = await loadSettings(db);
  return { settings, themeBrief: await loadThemeBrief(db, settings.theme_brief_version) };
}

export type JobDetail = {
  job: JobSummary;
  topic: TopicRow | null;
  artifacts: { id: string; kind: string; content: string | null; bytes: number | null; hasFile: boolean; created_at: string }[];
  lint: { id: string; source: string; rule: string; frame: number | null; severity: string; detail: string }[];
  costs: { vendor: string; component: string; usd: number; usd_known: boolean; input_tokens: number; output_tokens: number }[];
  feedback: { verdict: Verdict; tags: string[]; note: string | null; updated_at: string } | null;
};

/** Everything the review drawer shows for one job. */
export async function loadJobDetail(db: Queryable, jobId: string): Promise<JobDetail | null> {
  const jobs = await loadReelsView(db, 500);
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;
  const [topic, artifacts, lint, costs, feedback] = await Promise.all([
    db.query<Record<string, unknown>>('SELECT * FROM explainers.topics WHERE id = $1', [job.topic_id]),
    db.query<Record<string, unknown>>(
      'SELECT id, kind, content, bytes, storage_path, created_at FROM explainers.artifacts WHERE job_id = $1 ORDER BY seq',
      [jobId],
    ),
    db.query<JobDetail['lint'][number]>(
      `SELECT id, source, rule, frame, severity, detail FROM explainers.lint_violations
        WHERE job_id = $1 ORDER BY frame NULLS FIRST, seq`,
      [jobId],
    ),
    db.query<Record<string, unknown>>(
      `SELECT vendor, component, usd, usd_known, input_tokens, output_tokens FROM explainers.cost_events
        WHERE job_id = $1 ORDER BY created_at`,
      [jobId],
    ),
    db.query<Record<string, unknown>>('SELECT verdict, tags, note, updated_at FROM explainers.feedback WHERE job_id = $1', [jobId]),
  ]);
  const t = topic.rows[0] ? serializeTopic(topic.rows[0] as unknown as TopicRow) : null;
  const f = feedback.rows[0];
  return {
    job,
    topic: t,
    artifacts: artifacts.rows.map((a) => ({
      id: String(a.id),
      kind: String(a.kind),
      content: (a.content as string | null) ?? null,
      bytes: a.bytes == null ? null : Number(a.bytes),
      hasFile: Boolean(a.storage_path),
      created_at: iso(a.created_at)!,
    })),
    lint: lint.rows,
    costs: costs.rows.map((c) => ({
      vendor: String(c.vendor),
      component: String(c.component),
      usd: Number(c.usd),
      usd_known: Boolean(c.usd_known),
      input_tokens: Number(c.input_tokens),
      output_tokens: Number(c.output_tokens),
    })),
    feedback: f
      ? { verdict: f.verdict as Verdict, tags: f.tags as string[], note: (f.note as string | null) ?? null, updated_at: iso(f.updated_at)! }
      : null,
  };
}
