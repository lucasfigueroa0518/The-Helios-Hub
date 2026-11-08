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
  slotCategory,
  slotText,
  text,
} from '@/lib/social-hub/adapters/common';
import { hubId } from '@/lib/social-hub/ids';
import { foldLifecycle } from '@/lib/social-hub/lifecycle';
import type { DramaAttemptRow, ReelAiDramaRead } from '@/lib/social-hub/queries/reel-ai-drama';
import type { ContentVersion, FactorValue, HubIdea, HubPost, HubStatus, MetricSnapshot, NativeField, ScoreBreakdown } from '@/lib/social-hub/types';
import type { DramaJobRow, DramaPitchRow } from '@/lib/reel-ai-drama/hub-read';
import type { RunSnapshot } from '@/lib/content-type/run-status';

/**
 * AI Drama Reels → HubPost / HubIdea, the Explainers adapter's shape
 * (lib/social-hub/adapters/explainers.ts): post = production job, idea = pitch.
 * Content id `reel_ai_drama:<jobId>`, idea id `reel_ai_drama:pitch:<pitchId>`.
 */

const VERTICAL = 'reel_ai_drama' as const;

const ORIGIN_LABEL: Record<string, string> = { producer: 'Producer', seed: 'Seeded', calibration: 'Calibration' };
const SLOT_LABEL: Record<string, string> = { evening: 'Evening · 8:00–8:45 PM' };
const GRADE_LABEL: Record<string, string> = { green: 'Green', amber: 'Amber', red: 'Red' };

export const DRAMA_REVIEW_TAG_LABEL: Record<string, string> = {
  hook: 'Hook',
  story: 'Story',
  accuracy: 'Accuracy',
  pacing: 'Pacing',
  visuals: 'Visuals',
  voice: 'Voice',
  captions: 'Captions',
  sound: 'Sound',
  brand: 'Brand',
};

const label = (raw: string | null | undefined) => (raw ? raw.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null);

export function dramaPitchHubId(pitchId: string): string {
  return `${VERTICAL}:pitch:${pitchId}`;
}

function factorValues(job: DramaJobRow, slot: string | null): Record<string, FactorValue> {
  const tags = (job.tags ?? []).map((tag) => ({ key: tag, label: DRAMA_REVIEW_TAG_LABEL[tag] ?? tag }));
  const storyType = job.story_type ? { [job.story_type]: label(job.story_type)! } : {};
  const era = job.era ? { [job.era]: label(job.era)! } : {};
  return {
    storyType: category(job.story_type, storyType),
    era: category(job.era, era),
    visualsGrade: category(job.visuals_grade, GRADE_LABEL),
    dramaScore: { kind: 'number', value: num(job.drama_score) },
    seconds: { kind: 'number', value: num(job.seconds) },
    rank: { kind: 'number', value: num(job.rank_score) },
    slot: slotCategory(slot, SLOT_LABEL),
    reviewTags: { kind: 'tags', values: tags, empty: job.verdict ? 'No tags' : 'Not reviewed' },
    spend: { kind: 'number', value: num(job.spend_usd) },
  };
}

function nativeFields(job: DramaJobRow, slot: string | null): NativeField[] {
  const score = (value: unknown, digits = 2) => (num(value) == null ? '—' : num(value)!.toFixed(digits));
  return [
    { group: 'content', label: 'Story', value: job.title },
    { group: 'content', label: 'Brief', value: text(job.brief) ?? '—' },
    { group: 'content', label: 'Story type', value: label(job.story_type) ?? '—' },
    { group: 'content', label: 'Era', value: label(job.era) ?? '—' },
    { group: 'content', label: 'Central player', value: text(job.central_player_id) ?? '—' },
    { group: 'content', label: 'Length', value: num(job.seconds) == null ? '—' : `${Math.round(num(job.seconds)!)} s` },
    { group: 'production', label: 'Mode', value: job.mode },
    { group: 'production', label: 'Trigger', value: job.trigger === 'auto' ? 'Night' : 'Click' },
    { group: 'production', label: 'Spend', value: `$${(num(job.spend_usd) ?? 0).toFixed(2)} of $${(num(job.spend_cap_usd) ?? 0).toFixed(2)}` },
    { group: 'production', label: 'Flags', value: job.flags ? String(job.flags) : 'None' },
    { group: 'scoring', label: 'Rank score', value: score(job.rank_score) },
    { group: 'scoring', label: 'Drama score', value: score(job.drama_score) },
    { group: 'scoring', label: 'Material score', value: score(job.material_score) },
    { group: 'scoring', label: 'Visuals', value: GRADE_LABEL[job.visuals_grade ?? ''] ?? '—' },
    { group: 'scoring', label: 'Review', value: job.verdict ? `${job.verdict === 'approved' ? 'Approved' : 'Rejected'}${job.tags?.length ? ` · ${job.tags.map((t) => DRAMA_REVIEW_TAG_LABEL[t] ?? t).join(', ')}` : ''}` : 'Not reviewed' },
    { group: 'scheduling', label: 'Posting slot', value: slot ? slotText(slot, SLOT_LABEL) : '—' },
  ];
}

function versionsFor(job: DramaJobRow, all: readonly DramaJobRow[]): ContentVersion[] {
  const siblings = all
    .filter((j) => j.pitch_id === job.pitch_id && j.status === 'ok' && j.video_artifact_id)
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

type Base = { job: DramaJobRow; jobs: readonly DramaJobRow[]; requireApproval: boolean; slot: string | null };

function shell(b: Base): Omit<HubPost, 'id' | 'status' | 'statusNote' | 'postedAt' | 'publishAt' | 'nyDate' | 'permalink' | 'metrics' | 'history' | 'refs'> {
  const { job } = b;
  return {
    vertical: VERTICAL,
    format: 'reel',
    name: job.title,
    description: text(job.brief),
    slot: b.slot ? { id: b.slot, label: slotText(b.slot, SLOT_LABEL) } : null,
    pipelineHref: `/reel-ai-drama/lab?job=${encodeURIComponent(job.job_id)}`,
    media: job.video_artifact_id
      ? { kind: 'video', src: `/api/reel-ai-drama/artifacts/${encodeURIComponent(job.video_artifact_id)}` }
      : { kind: 'none', note: 'No video made for this job.' },
    costMicros: null,
    costNote: null,
    native: nativeFields(job, b.slot),
    factorValues: factorValues(job, b.slot),
    approval: {
      required: b.requireApproval,
      approvedAt: job.verdict === 'approved' ? iso(job.feedback_at) : null,
      note: job.verdict === 'approved' ? 'Approved' : job.verdict === 'rejected' ? 'Rejected' : 'Not reviewed',
    },
    idea: { id: job.pitch_id, label: job.title },
    generatedAt: iso(job.finished_at),
    versions: versionsFor(job, b.jobs),
    sources: (job.sources ?? []).filter((s) => s?.url).map((s) => ({ url: s.url, title: s.title ?? null })),
    costItemKey: `${VERTICAL}:${job.job_id}`,
  };
}

function attemptPost(row: DramaAttemptRow, job: DramaJobRow, read: ReelAiDramaRead, history: Map<string, MetricSnapshot[]>): HubPost {
  const status = attemptStatus(row.status);
  const snapshots = row.media_id ? history.get(row.media_id) ?? [] : [];
  const finished = iso(row.finished_at);
  return {
    ...shell({ job, jobs: read.jobs, requireApproval: read.requireApproval, slot: row.slot }),
    id: hubId(VERTICAL, 'attempt', row.attempt_id),
    status,
    statusNote: status === 'failed' ? text(row.error) : null,
    postedAt: status === 'published' ? finished : null,
    publishAt: iso(row.publish_at),
    nyDate: nyDateFor(status === 'published' ? finished : null, row.publish_at, row.requested_at),
    permalink: row.permalink,
    metrics: latest(snapshots),
    history: snapshots,
    refs: { attemptId: row.attempt_id, jobId: row.job_id, pitchId: job.pitch_id, ...(row.schedule_id ? { scheduleId: row.schedule_id } : {}) },
    ...(row.trigger === 'force'
      ? { approval: { required: read.requireApproval, approvedAt: iso(row.requested_at), note: 'Force post' } }
      : {}),
  };
}

export function dramaPosts(read: ReelAiDramaRead): HubPost[] {
  const history = historyByMedia(read.insights);
  const jobById = new Map(read.jobs.map((j) => [j.job_id, j]));
  const posts: HubPost[] = [];

  for (const row of read.attempts) {
    const job = jobById.get(row.job_id);
    if (!job) continue;
    posts.push(attemptPost(row, job, read, history));
  }
  for (const row of read.schedules) {
    const job = jobById.get(row.job_id);
    if (!job) continue;
    const status: HubStatus = scheduleStatus(row.status);
    posts.push({
      ...shell({ job, jobs: read.jobs, requireApproval: read.requireApproval, slot: row.slot }),
      id: hubId(VERTICAL, 'schedule', row.schedule_id),
      status,
      statusNote: status === 'cancelled' ? cancelNote(row.error) : status === 'failed' ? text(row.error) : null,
      postedAt: null,
      publishAt: iso(row.publish_at),
      nyDate: row.ny_date.slice(0, 10),
      permalink: null,
      metrics: {},
      history: [],
      refs: { scheduleId: row.schedule_id, jobId: row.job_id, pitchId: job.pitch_id },
    });
  }
  // Content ready: the newest finished reel per pitch. The lifecycle view keeps it only when nothing live holds it.
  const newestPerPitch = new Map<string, DramaJobRow>();
  for (const job of read.jobs) {
    if (job.status !== 'ok' || !job.video_artifact_id) continue;
    const seen = newestPerPitch.get(job.pitch_id);
    if (!seen || Date.parse(job.finished_at ?? '') > Date.parse(seen.finished_at ?? '')) newestPerPitch.set(job.pitch_id, job);
  }
  for (const job of newestPerPitch.values()) {
    if (job.verdict === 'rejected') continue;
    posts.push({
      ...shell({ job, jobs: read.jobs, requireApproval: read.requireApproval, slot: null }),
      id: hubId(VERTICAL, 'job', job.job_id),
      status: 'ready',
      statusNote: job.verdict === 'approved' ? 'Approved, waiting for a free slot' : 'Waiting for review',
      postedAt: null,
      publishAt: null,
      nyDate: null,
      permalink: null,
      metrics: {},
      history: [],
      refs: { jobId: job.job_id, pitchId: job.pitch_id },
    });
  }
  return foldLifecycle(VERTICAL, posts);
}

function pitchRun(row: DramaPitchRow): RunSnapshot | null {
  const status = row.job_status;
  if (!row.job_id) return null;
  const state = status === 'queued' ? 'queued' : status === 'running' ? 'running' : status === 'failed' ? 'failed' : null;
  if (!state) return null;
  return {
    state,
    stage: row.job_stage ?? null,
    error: row.job_error ?? null,
    requestedAt: row.job_requested_at ?? '',
    startedAt: row.job_started_at ?? null,
  };
}

/** Where a pitch's rank comes from: the producer's drama and material scores and the visuals grade. */
export function dramaBreakdown(row: DramaPitchRow): ScoreBreakdown | null {
  if (num(row.rank_score) == null) return null;
  const drama = num(row.drama_score);
  const material = num(row.material_score);
  return {
    formula: 'The producer’s rank: drama and material scores, held back by a weak visuals grade.',
    parts: [
      { label: 'Drama score', points: drama, detail: drama == null ? 'Not scored' : drama.toFixed(2) },
      { label: 'Material score', points: material, detail: material == null ? 'Not scored' : material.toFixed(2) },
      { label: 'Visuals grade', points: null, detail: GRADE_LABEL[row.visuals_grade ?? ''] ?? 'Not graded' },
    ],
  };
}

export function dramaIdeas(rows: readonly DramaPitchRow[]): HubIdea[] {
  return rows.map((row) => ({
    id: dramaPitchHubId(row.pitch_id),
    vertical: VERTICAL,
    title: row.title,
    yours: row.origin === 'seed',
    score: num(row.rank_score),
    scoreLabel: 'Rank score',
    breakdown: dramaBreakdown(row),
    state: row.published ? 'published' : row.scheduled ? 'on_deck' : row.ok_jobs > 0 ? 'content_ready' : 'idea_only',
    hasContent: row.ok_jobs > 0,
    versionCount: row.ok_jobs,
    generatedAt: iso(row.last_made_at),
    createdAt: iso(row.created_at),
    detail: [ORIGIN_LABEL[row.origin] ?? row.origin, text(row.brief), row.event_date ? `Event ${row.event_date.slice(0, 10)}` : null].filter(Boolean).join(' · '),
    run: pitchRun(row),
  }));
}
