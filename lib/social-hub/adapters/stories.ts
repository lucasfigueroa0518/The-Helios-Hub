import { category, iso, num, text, yesNo } from '@/lib/social-hub/adapters/common';
import { hubId } from '@/lib/social-hub/ids';
import type { StoriesRead, StoryCandidateRow, StoryFrameRow, StoryInsightRow, StorySetRow } from '@/lib/social-hub/queries/stories';
import { nyDateOf, WEEKDAY_SHORT, weekdayOf } from '@/lib/social-hub/time';
import type { FactorValue, HubIdea, HubMetrics, HubPost, HubStatus, MetricSnapshot, NativeField, SourceRef } from '@/lib/social-hub/types';
import { SERIES_LABEL } from '@/lib/stories/render/copy';

const SERIES: Record<string, string> = SERIES_LABEL as Record<string, string>;
const STYLE_LABEL: Record<string, string> = { polished: 'Polished', homemade: 'Homemade' };
const BACKDROP_LABEL: Record<string, string> = { black: 'Black', white: 'White', orange: 'Orange', green: 'Green' };
const ORIGIN_LABEL: Record<string, string> = { reels: 'Trial Reels', carousel: 'Carousel', catalog: 'Catalog', github: 'GitHub', generated: 'Generated' };
const STORY_TAG_LABEL: Record<string, string> = { story_choice: 'Story choice', copy: 'Copy', photo: 'Photo', design: 'Design', accuracy: 'Accuracy' };

const STATUS: Record<string, HubStatus> = {
  ready: 'ready',
  approved: 'scheduled',
  scheduled: 'scheduled',
  publishing: 'publishing',
  published: 'published',
  failed: 'failed',
  skipped: 'skipped',
};

type FrameNumbers = { seq: number; insight: StoryInsightRow };

/**
 * One set's numbers from each frame's newest capture (DECISIONS_LOG D14).
 * Reach is the first frame's (accounts that opened the set); counts are summed
 * over frames; completion = last-frame reach ÷ first-frame reach and exits on
 * frames 1–3, exactly as `setInsights` in lib/stories/api.ts.
 */
export function setMetrics(frames: readonly FrameNumbers[]): HubMetrics {
  if (frames.length === 0) return {};
  const fr = [...frames].sort((a, b) => a.seq - b.seq);
  const sum = (key: keyof StoryInsightRow): number | null => {
    const values = fr.map((f) => num(f.insight[key])).filter((v): v is number => v != null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const first = num(fr[0]!.insight.reach);
  const last = num(fr[fr.length - 1]!.insight.reach);
  return {
    reach: first,
    views: sum('views'),
    replies: sum('replies'),
    shares: sum('shares'),
    follows: sum('follows'),
    profileVisits: sum('profile_visits'),
    totalInteractions: sum('total_interactions'),
    tapsForward: sum('taps_forward'),
    tapsBack: sum('taps_back'),
    exits: sum('exits'),
    swipeForward: sum('swipe_forward'),
    completion: first && last != null ? last / first : null,
    exitsFirst3: fr.filter((f) => f.seq <= 3).reduce((s, f) => s + (num(f.insight.exits) ?? 0), 0),
  };
}

/** Daily snapshots: at the end of each New York day, each frame's newest capture so far. */
export function setHistory(frames: readonly StoryFrameRow[], insights: readonly StoryInsightRow[]): MetricSnapshot[] {
  const seqOf = new Map(frames.map((f) => [f.frame_id, f.seq]));
  const ordered = insights.filter((i) => seqOf.has(i.frame_id)).sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  const latestByFrame = new Map<string, StoryInsightRow>();
  const out: MetricSnapshot[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i]!;
    latestByFrame.set(row.frame_id, row);
    const day = nyDateOf(row.captured_at)!;
    const nextDay = ordered[i + 1] ? nyDateOf(ordered[i + 1]!.captured_at) : null;
    if (nextDay === day) continue;
    const numbers = [...latestByFrame.entries()].map(([frameId, insight]) => ({ seq: seqOf.get(frameId)!, insight }));
    out.push({ nyDate: day, metrics: setMetrics(numbers) });
  }
  return out;
}

function payloadList(payload: Record<string, unknown> | null, key: string): Array<Record<string, unknown>> {
  const value = payload?.[key];
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as Array<Record<string, unknown>>) : [];
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? text(value) : null;
}

/** First story headline (spec §4 short name: series name + first story headline). */
export function setHeadline(set: StorySetRow): string | null {
  const p = set.payload;
  if (set.series === 'morning_download') return str(payloadList(p, 'stories')[0]?.headline);
  if (set.series === 'guess_the_number') return str(p?.question) ?? str((p?.story as Record<string, unknown> | undefined)?.headline) ?? str(p?.story);
  if (set.series === 'free_vs_paid') {
    const pair = p?.pair as Record<string, unknown> | undefined;
    const names = [str(pair?.free) ?? str((pair?.free as Record<string, unknown> | undefined)?.name), str(pair?.paid) ?? str((pair?.paid as Record<string, unknown> | undefined)?.name)].filter(Boolean);
    return names.length === 2 ? `${names[0]} vs. ${names[1]}` : null;
  }
  return null;
}

function setSources(set: StorySetRow): SourceRef[] {
  const p = set.payload;
  const out: SourceRef[] = [];
  for (const s of payloadList(p, 'stories')) {
    const url = str(s.url);
    if (url) out.push({ url, title: str(s.headline) });
  }
  const url = str(p?.url);
  if (url) out.push({ url, title: str(p?.question) ?? null });
  return out;
}

function factorValues(set: StorySetRow, frames: readonly StoryFrameRow[]): Record<string, FactorValue> {
  const first = frames[0];
  return {
    series: category(set.series, SERIES),
    style: category(set.style, STYLE_LABEL),
    frames: frames.length ? { kind: 'category', key: String(frames.length), label: `${frames.length} frames` } : { kind: 'category', key: 'unknown', label: 'Unknown' },
    backdrop: category(first?.backdrop ?? null, BACKDROP_LABEL),
    origins: { kind: 'tags', values: (set.chosen_origins ?? []).map((o) => ({ key: o, label: ORIGIN_LABEL[o] ?? o })), empty: 'No chosen items' },
    weekday: { kind: 'category', key: String(weekdayOf(set.ny_date)), label: WEEKDAY_SHORT[weekdayOf(set.ny_date)]! },
    flagged: yesNo(set.flagged || frames.some((f) => f.flagged), ['yes', 'Flagged by review'], ['no', 'Not flagged']),
    trigger: category(set.trigger, { click: 'Click', auto: 'Auto' }),
  };
}

function nativeFields(set: StorySetRow, frames: readonly StoryFrameRow[]): NativeField[] {
  return [
    { group: 'content', label: 'Series', value: SERIES[set.series] ?? set.series },
    { group: 'content', label: 'Lead item', value: setHeadline(set) ?? '—' },
    { group: 'content', label: 'Chosen from', value: set.chosen_origins?.length ? set.chosen_origins.map((o) => ORIGIN_LABEL[o] ?? o).join(', ') : '—' },
    { group: 'production', label: 'Style', value: STYLE_LABEL[set.style] ?? set.style },
    { group: 'production', label: 'Frames', value: String(frames.length) },
    { group: 'production', label: 'First backdrop', value: frames[0] ? BACKDROP_LABEL[frames[0].backdrop] ?? frames[0].backdrop : '—' },
    { group: 'production', label: 'Render review', value: set.flagged || frames.some((f) => f.flagged) ? 'Flagged' : 'Clean' },
    { group: 'scoring', label: 'Review', value: set.feedback_verdict ? `${set.feedback_verdict === 'approve' ? 'Approved' : 'Rejected'}${set.feedback_tags?.length ? ` · ${set.feedback_tags.map((t) => STORY_TAG_LABEL[t] ?? t).join(', ')}` : ''}` : '—' },
    { group: 'scheduling', label: 'Trigger', value: set.trigger === 'auto' ? 'Auto' : 'Click' },
    { group: 'scheduling', label: 'Posting window', value: '8:30–10:00 AM' },
    { group: 'scheduling', label: 'Weekday', value: WEEKDAY_SHORT[weekdayOf(set.ny_date)]! },
  ];
}

export function storyPosts(read: StoriesRead): HubPost[] {
  const framesBySet = new Map<string, StoryFrameRow[]>();
  for (const f of read.frames) {
    const list = framesBySet.get(f.set_id) ?? [];
    list.push(f);
    framesBySet.set(f.set_id, list);
  }
  const insightsByFrame = new Map<string, StoryInsightRow[]>();
  for (const i of read.insights) {
    const list = insightsByFrame.get(i.frame_id) ?? [];
    list.push(i);
    insightsByFrame.set(i.frame_id, list);
  }
  return read.sets.map((set) => {
    const frames = (framesBySet.get(set.set_id) ?? []).sort((a, b) => a.seq - b.seq);
    const latestFrames: FrameNumbers[] = [];
    const setInsights: StoryInsightRow[] = [];
    for (const f of frames) {
      const list = (insightsByFrame.get(f.frame_id) ?? []).sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
      setInsights.push(...list);
      if (list.length) latestFrames.push({ seq: f.seq, insight: list[list.length - 1]! });
    }
    const status = STATUS[set.status] ?? 'ready';
    const series = SERIES[set.series] ?? set.series;
    const headline = setHeadline(set);
    return {
      id: hubId('stories', 'set', set.set_id),
      vertical: 'stories',
      format: 'story',
      name: headline ? `${series}: ${headline}` : series,
      description: `${frames.length} frame${frames.length === 1 ? '' : 's'}${headline ? ` · ${headline}` : ''}`,
      status,
      statusNote: status === 'skipped' ? 'Missed its window. Story sets are never reused (SH-53).' : status === 'failed' ? text(set.error) : status === 'ready' ? 'Waiting for approval on /stories' : null,
      postedAt: iso(set.published_at),
      publishAt: iso(set.publish_at),
      nyDate: set.ny_date.slice(0, 10),
      slot: { id: 'story-window', label: 'Stories · 8:30–10:00 AM' },
      permalink: null,
      pipelineHref: '/stories',
      media: {
        kind: 'frames',
        frames: frames.map((f) => ({ src: f.storage_path ? `/api/stories/frames/${encodeURIComponent(f.frame_id)}` : null, label: `Frame ${f.seq} · ${f.role}` })),
      },
      costMicros: null,
      costNote: null,
      metrics: setMetrics(latestFrames),
      history: setHistory(frames, setInsights),
      native: nativeFields(set, frames),
      factorValues: factorValues(set, frames),
      // Stories are never auto-approved (docs/social-overnight.md).
      approval: { required: true, approvedAt: iso(set.approved_at), note: set.approved_at ? 'Approved' : 'Needs approval on /stories' },
      idea: null,
      generatedAt: iso(set.built_at),
      versions: [],
      sources: setSources(set),
      costItemKey: `stories:${set.set_id}`,
      reviewNotes: frames.filter((f) => f.flagged).map((f) => `Frame ${f.seq} flagged by the render review`),
      refs: { setId: set.set_id },
    } satisfies HubPost;
  });
}

export function storyIdeas(rows: readonly StoryCandidateRow[]): HubIdea[] {
  return rows.map((row) => {
    const p = row.payload ?? {};
    const title = str(p.headline) ?? str(p.title) ?? str(p.question) ?? str(p.name) ?? row.ref;
    return {
      id: `stories:candidate:${row.candidate_id}`,
      vertical: 'stories' as const,
      title,
      score: num(row.score),
      scoreLabel: 'Build score',
      state: 'idea_only' as const,
      hasContent: false,
      versionCount: 0,
      generatedAt: null,
      createdAt: iso(row.created_at),
      detail: `${SERIES[row.series] ?? row.series} · ${row.ny_date.slice(0, 10)} · from ${ORIGIN_LABEL[row.origin] ?? row.origin}`,
    };
  });
}
