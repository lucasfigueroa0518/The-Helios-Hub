import {
  attemptStatus,
  cancelNote,
  category,
  historyByMedia,
  iso,
  latest,
  num,
  nyDateFor,
  scheduleStatus,
  text,
} from '@/lib/social-hub/adapters/common';
import { hubId } from '@/lib/social-hub/ids';
import type {
  ExplainerAttemptRow,
  ExplainerJobRow,
  ExplainersRead,
  ExplainerTopicRow,
} from '@/lib/social-hub/queries/explainers';
import type { ContentVersion, FactorValue, HubIdea, HubPost, HubStatus, MetricSnapshot, NativeField } from '@/lib/social-hub/types';
import { EXPLAINER_WINDOWS } from '@/lib/explainers/publish/config';

const ORIGIN_LABEL: Record<string, string> = { seeded: 'Seeded', generated: 'Generated', manual: 'Manual' };
const SLOT_LABEL: Record<string, string> = Object.fromEntries(
  EXPLAINER_WINDOWS.map((w) => [w.id, `${w.id === 'late' ? 'Late afternoon' : 'Afternoon'} · ${w.label}`]),
);
export const REVIEW_TAG_LABEL: Record<string, string> = {
  hook: 'Hook',
  analogy: 'Analogy',
  accuracy: 'Accuracy',
  pacing: 'Pacing',
  visuals: 'Visuals',
  voice: 'Voice',
  captions: 'Captions',
  brand: 'Brand',
};

/** Jev score columns (E-15), 0–4, banded above/below the median of the posts in view. */
export const JEV_SCORES: Array<{ id: string; column: keyof ExplainerJobRow; label: string }> = [
  { id: 'jevAudience', column: 'audience_fit', label: 'Audience fit' },
  { id: 'jevTeach', column: 'teachability_45s', label: 'Teachability' },
  { id: 'jevAnalogy', column: 'analogy_potential', label: 'Analogy' },
  { id: 'jevVisual', column: 'visual_potential', label: 'Visual' },
  { id: 'jevAccuracy', column: 'accuracy_under_simplification', label: 'Accuracy under simplification' },
  { id: 'jevHook', column: 'hook_strength', label: 'Hook strength' },
];

function factorValues(job: ExplainerJobRow, slot: string | null): Record<string, FactorValue> {
  const tags = (job.tags ?? []).map((tag) => ({ key: tag, label: REVIEW_TAG_LABEL[tag] ?? tag }));
  const out: Record<string, FactorValue> = {
    origin: category(job.origin, ORIGIN_LABEL),
    weighted: { kind: 'number', value: num(job.weighted_score) },
    slot: category(slot, SLOT_LABEL, 'Outside a slot'),
    reviewTags: { kind: 'tags', values: tags, empty: job.verdict ? 'No tags' : 'Not reviewed' },
    spend: { kind: 'number', value: num(job.spend_usd) },
  };
  for (const score of JEV_SCORES) out[score.id] = { kind: 'number', value: num(job[score.column]) };
  return out;
}

function nativeFields(job: ExplainerJobRow, slot: string | null): NativeField[] {
  const score = (value: unknown, digits = 2) => (num(value) == null ? '—' : num(value)!.toFixed(digits));
  return [
    { group: 'content', label: 'Topic', value: job.title },
    { group: 'content', label: 'Learning objective', value: text(job.scope) ?? '—' },
    { group: 'content', label: 'Origin', value: ORIGIN_LABEL[job.origin] ?? job.origin },
    { group: 'production', label: 'Render mode', value: job.mode },
    { group: 'production', label: 'Render trigger', value: job.trigger === 'auto' ? 'Auto' : 'Click' },
    { group: 'production', label: 'Render spend', value: `$${(num(job.spend_usd) ?? 0).toFixed(2)}` },
    { group: 'scoring', label: 'Weighted score', value: score(job.weighted_score, 1) },
    ...JEV_SCORES.map((s) => ({ group: 'scoring' as const, label: s.label, value: score(job[s.column]) })),
    { group: 'scoring', label: 'Review', value: job.verdict ? `${job.verdict === 'approved' ? 'Approved' : 'Rejected'}${job.tags?.length ? ` · ${job.tags.map((t) => REVIEW_TAG_LABEL[t] ?? t).join(', ')}` : ''}` : 'Not reviewed' },
    { group: 'scheduling', label: 'Posting slot', value: slot ? SLOT_LABEL[slot] ?? slot : '—' },
  ];
}

function versionsFor(job: ExplainerJobRow, all: readonly ExplainerJobRow[]): ContentVersion[] {
  const siblings = all
    .filter((j) => j.topic_id === job.topic_id && j.status === 'ok' && j.video_artifact_id)
    .sort((a, b) => Date.parse(a.finished_at ?? a.requested_at) - Date.parse(b.finished_at ?? b.requested_at));
  const newest = siblings[siblings.length - 1]?.job_id;
  return siblings.map((j) => ({
    id: j.job_id,
    createdAt: iso(j.finished_at ?? j.requested_at)!,
    trigger: j.trigger === 'auto' ? 'nightly' : 'click',
    current: j.job_id === newest,
    status: j.verdict ?? 'not reviewed',
  }));
}

type Base = {
  job: ExplainerJobRow;
  jobs: readonly ExplainerJobRow[];
  requireApproval: boolean;
  slot: string | null;
};

function shell(b: Base): Omit<HubPost, 'id' | 'status' | 'statusNote' | 'postedAt' | 'publishAt' | 'nyDate' | 'permalink' | 'metrics' | 'history' | 'refs'> {
  const { job } = b;
  return {
    vertical: 'explainers',
    format: 'reel',
    name: job.title,
    description: text(job.scope),
    slot: b.slot ? { id: b.slot, label: SLOT_LABEL[b.slot] ?? b.slot } : null,
    pipelineHref: '/explainers/reels',
    media: job.video_artifact_id
      ? { kind: 'video', src: `/api/explainers/artifacts/${encodeURIComponent(job.video_artifact_id)}` }
      : { kind: 'none', note: 'No video rendered for this job.' },
    costMicros: null,
    costNote: null,
    native: nativeFields(job, b.slot),
    factorValues: factorValues(job, b.slot),
    approval: {
      required: b.requireApproval,
      approvedAt: job.verdict === 'approved' ? iso(job.feedback_at) : null,
      note: job.verdict === 'approved' ? 'Approved' : job.verdict === 'rejected' ? 'Rejected' : 'Not reviewed',
    },
    idea: { id: job.topic_id, label: job.title },
    generatedAt: iso(job.finished_at),
    versions: versionsFor(job, b.jobs),
    sources: job.source_url ? [{ url: job.source_url, title: job.title }] : [],
    costItemKey: `explainers:${job.job_id}`,
  };
}

function attemptPost(row: ExplainerAttemptRow, job: ExplainerJobRow, read: ExplainersRead, history: Map<string, MetricSnapshot[]>): HubPost {
  const status = attemptStatus(row.status);
  const snapshots = row.media_id ? history.get(row.media_id) ?? [] : [];
  const finished = iso(row.finished_at);
  return {
    ...shell({ job, jobs: read.jobs, requireApproval: read.requireApproval, slot: row.slot }),
    id: hubId('explainers', 'attempt', row.attempt_id),
    status,
    statusNote: status === 'failed' ? text(row.error) : null,
    postedAt: status === 'published' ? finished : null,
    publishAt: iso(row.publish_at),
    nyDate: nyDateFor(status === 'published' ? finished : null, row.publish_at, row.requested_at),
    permalink: row.permalink,
    metrics: latest(snapshots),
    history: snapshots,
    refs: { attemptId: row.attempt_id, jobId: row.job_id, topicId: job.topic_id, ...(row.schedule_id ? { scheduleId: row.schedule_id } : {}) },
    // A force post is a person's click: approval for every type (SH-17).
    ...(row.trigger === 'force'
      ? { approval: { required: read.requireApproval, approvedAt: iso(row.requested_at), note: 'Force post' } }
      : {}),
  };
}

export function explainerPosts(read: ExplainersRead): HubPost[] {
  const history = historyByMedia(read.insights);
  const jobById = new Map(read.jobs.map((j) => [j.job_id, j]));
  const posts: HubPost[] = [];
  const placed = new Set<string>();

  for (const row of read.attempts) {
    const job = jobById.get(row.job_id);
    if (!job) continue;
    posts.push(attemptPost(row, job, read, history));
    if (row.status !== 'failed') placed.add(row.job_id);
  }
  for (const row of read.schedules) {
    const job = jobById.get(row.job_id);
    if (!job) continue;
    const status: HubStatus = scheduleStatus(row.status);
    posts.push({
      ...shell({ job, jobs: read.jobs, requireApproval: read.requireApproval, slot: row.slot }),
      id: hubId('explainers', 'schedule', row.schedule_id),
      status,
      statusNote: status === 'cancelled' ? cancelNote(row.error) : status === 'failed' ? text(row.error) : null,
      postedAt: null,
      publishAt: iso(row.publish_at),
      nyDate: row.ny_date.slice(0, 10),
      permalink: null,
      metrics: {},
      history: [],
      refs: { scheduleId: row.schedule_id, jobId: row.job_id, topicId: job.topic_id },
    });
    if (status === 'scheduled' || status === 'publishing') placed.add(row.job_id);
  }
  // Content ready (spec §9a): the newest finished render per topic that has no live slot or attempt.
  const newestPerTopic = new Map<string, ExplainerJobRow>();
  for (const job of read.jobs) {
    if (job.status !== 'ok' || !job.video_artifact_id) continue;
    const seen = newestPerTopic.get(job.topic_id);
    if (!seen || Date.parse(job.finished_at ?? '') > Date.parse(seen.finished_at ?? '')) newestPerTopic.set(job.topic_id, job);
  }
  for (const job of newestPerTopic.values()) {
    if (placed.has(job.job_id) || job.verdict === 'rejected') continue;
    posts.push({
      ...shell({ job, jobs: read.jobs, requireApproval: read.requireApproval, slot: null }),
      id: hubId('explainers', 'job', job.job_id),
      status: 'ready',
      statusNote: job.verdict === 'approved' ? 'Approved, waiting for a free slot' : 'Waiting for review',
      postedAt: null,
      publishAt: null,
      nyDate: null,
      permalink: null,
      metrics: {},
      history: [],
      refs: { jobId: job.job_id, topicId: job.topic_id },
    });
  }
  return posts;
}

export function explainerIdeas(rows: readonly ExplainerTopicRow[]): HubIdea[] {
  return rows.map((row) => ({
    id: `explainers:topic:${row.topic_id}`,
    vertical: 'explainers',
    title: row.title,
    score: num(row.weighted_score),
    scoreLabel: 'Weighted score (0–100)',
    state: row.published ? 'published' : row.scheduled ? 'on_deck' : row.ok_jobs > 0 ? 'content_ready' : 'idea_only',
    hasContent: row.ok_jobs > 0,
    versionCount: row.ok_jobs,
    generatedAt: iso(row.last_render_at),
    createdAt: iso(row.created_at),
    detail: [ORIGIN_LABEL[row.origin] ?? row.origin, `status ${row.status}`, text(row.scope)].filter(Boolean).join(' · '),
  }));
}
