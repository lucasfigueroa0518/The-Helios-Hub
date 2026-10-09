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
  yesNo,
} from '@/lib/social-hub/adapters/common';
import { hubId } from '@/lib/social-hub/ids';
import { foldLifecycle } from '@/lib/social-hub/lifecycle';
import { reelItem } from '@/lib/social-hub/queries/costs';
import type { ReelAttemptRow, ReelIdeaRow, ReelScheduleRow, ReelsRead } from '@/lib/social-hub/queries/reels';
import type { FactorValue, HubIdea, HubPost, NativeField } from '@/lib/social-hub/types';
import { parseMotionFactors, reelTitle } from '@/lib/reels/analytics/performance';
import { resolveSlot, slotCaption } from '@/lib/reels/publish/slots';
import { colorProfileOrNoir } from '@/lib/reels/visual/color';

/*
 * Label maps copied from lib/reels/analytics/performance.ts (copied, not
 * edited: BUILD_PLAN §B P1-M2) so hub groups read exactly like Trial Reels'.
 */
export const FRAMEWORK_LABEL: Record<string, string> = { curiosity: 'Curiosity', arousal: 'Arousal', identity: 'Identity' };
export const BUCKET_LABEL: Record<string, string> = {
  ball_knowledge: 'Ball Knowledge',
  the_number: 'The Number',
  the_saga: 'The Saga',
  personal_profile: 'Personal Profile',
  the_warning: 'The Warning',
  the_callout: 'The Callout',
};
export const SLOT_NAME: Record<string, string> = { morning: 'Morning', midday: 'Midday', evening: 'Evening', unscheduled: 'Outside a slot' };
const AUDIO_LABEL: Record<string, string> = { music: 'Music', original_sound: 'Original sound' };
const COLOR_LABEL: Record<string, string> = { noir: 'Noir', paper: 'Paper', orange: 'Orange', green: 'Green' };
const HOOK_LABEL: Record<string, string> = {
  glitch: 'Glitch',
  color_bars: 'Color bars',
  invert: 'Invert',
  vhs: 'VHS',
  thermal: 'Thermal',
  blue_screen: 'Blue screen',
  none: 'No hook',
};
const ORIGIN_LABEL: Record<string, string> = { timely: 'Timely', carryover: 'Carryover' };

/**
 * Copied from `inKnowledgeLane` in lib/reels/copy/slots.ts (D-272), because
 * importing that module pulls in the Jev client. Curiosity or identity, in
 * Ball Knowledge, or in The Number when curiosity won.
 */
export function inKnowledgeLane(framework: string | null, bucket: string | null): boolean {
  if (framework !== 'curiosity' && framework !== 'identity') return false;
  if (bucket === 'ball_knowledge') return true;
  return framework === 'curiosity' && bucket === 'the_number';
}

function labelOf(value: string | null, labels: Record<string, string>): string {
  if (!value) return '—';
  return labels[value] ?? value;
}

type ReelFacts = {
  framework: string | null;
  bucket: string | null;
  blockbuster: boolean | null;
  net: number | null;
  origin: string | null;
  slot: string;
  color: string | null;
  hook: string | null;
  hookSound: boolean | null;
  fullStory: boolean | null;
  audioType: string | null;
  genre: string | null;
};

/** Trial Reels factor values, keyed by its FACTOR_OPTIONS ids, plus the knowledge lane (D-272). */
export function reelFactorValues(f: ReelFacts): Record<string, FactorValue> {
  const genre = f.genre?.trim();
  return {
    psychology: category(f.framework, FRAMEWORK_LABEL),
    bucket: category(f.bucket, BUCKET_LABEL),
    blockbuster: yesNo(f.blockbuster, ['yes', 'Blockbuster'], ['no', 'Not a blockbuster']),
    slot: category(f.slot, SLOT_NAME, 'Outside a slot'),
    audio: category(f.audioType, AUDIO_LABEL),
    genre: genre ? { kind: 'category', key: genre, label: genre } : { kind: 'category', key: 'unknown', label: 'Unknown' },
    color: category(f.color, COLOR_LABEL),
    hook: category(f.hook, HOOK_LABEL),
    sound: yesNo(f.hookSound, ['on', 'Hook sound'], ['off', 'No hook sound']),
    story: yesNo(f.fullStory, ['on', 'Full story cue'], ['off', 'No cue']),
    origin: category(f.origin, ORIGIN_LABEL),
    score: { kind: 'number', value: f.net },
    lane: f.framework == null && f.bucket == null
      ? { kind: 'category', key: 'unknown', label: 'Unknown' }
      : inKnowledgeLane(f.framework, f.bucket)
        ? { kind: 'category', key: 'knowledge', label: 'Knowledge lane' }
        : { kind: 'category', key: 'general', label: 'General pool' },
  };
}

function nativeFields(f: ReelFacts, extra: { songTitle: string | null; songArtist: string | null; graduation: string | null; trigger: string | null }): NativeField[] {
  const graduation = extra.graduation === 'SS_PERFORMANCE'
    ? 'Instagram can still graduate this one on its own'
    : extra.graduation === 'MANUAL'
      ? 'Stays a trial until someone graduates it in the Instagram app'
      : '—';
  const fields: NativeField[] = [
    { group: 'content', label: 'Psychology', value: labelOf(f.framework, FRAMEWORK_LABEL) },
    { group: 'content', label: 'Content bucket', value: labelOf(f.bucket, BUCKET_LABEL) },
    { group: 'content', label: 'Blockbuster', value: f.blockbuster == null ? '—' : f.blockbuster ? 'Blockbuster' : 'Not a blockbuster' },
    { group: 'content', label: 'Full story cue', value: f.fullStory == null ? '—' : f.fullStory ? 'Full story cue' : 'No cue' },
    { group: 'content', label: 'Origin', value: labelOf(f.origin, ORIGIN_LABEL) },
    { group: 'production', label: 'Color grade', value: labelOf(f.color, COLOR_LABEL) },
    { group: 'production', label: 'Hook', value: labelOf(f.hook, HOOK_LABEL) },
    { group: 'production', label: 'Hook sound', value: f.hookSound == null ? '—' : f.hookSound ? 'Hook sound' : 'No hook sound' },
    { group: 'production', label: 'Audio', value: labelOf(f.audioType, AUDIO_LABEL) },
    { group: 'production', label: 'Song', value: [extra.songTitle, extra.songArtist].filter(Boolean).join(' · ') || '—' },
    { group: 'production', label: 'Song genre', value: f.genre?.trim() || '—' },
    { group: 'scoring', label: 'Net score', value: f.net == null ? '—' : f.net.toFixed(2) },
    { group: 'scheduling', label: 'Posting slot', value: f.slot === 'unscheduled' ? 'Outside a slot' : slotCaption(f.slot as never) },
    { group: 'scheduling', label: 'Graduation', value: graduation },
  ];
  if (extra.trigger) fields.push({ group: 'scheduling', label: 'Trigger', value: extra.trigger === 'force' ? 'Force post' : extra.trigger === 'approve' ? 'Approved' : 'Auto' });
  return fields;
}

function videoSrc(videoJobId: string | null, storagePath: string | null): string | null {
  return videoJobId && storagePath ? `/api/reels/video/${encodeURIComponent(videoJobId)}` : null;
}

function attemptPost(row: ReelAttemptRow, history: Map<string, import('@/lib/social-hub/types').MetricSnapshot[]>, requireApproval: boolean): HubPost {
  const finishedAt = iso(row.finished_at);
  const at = finishedAt ?? iso(row.requested_at)!;
  const slot = resolveSlot(row.schedule_slot, new Date(at));
  const motion = parseMotionFactors(row.motion_prompt);
  const blockbusterNum = num(row.blockbuster);
  const facts: ReelFacts = {
    framework: row.chosen_framework,
    bucket: row.chosen_bucket,
    blockbuster: row.blockbuster == null && row.net == null && row.chosen_bucket == null && row.chosen_framework == null
      ? null
      : (blockbusterNum ?? 0) > 0,
    net: num(row.net),
    origin: row.origin,
    slot,
    color: row.visual_render ? colorProfileOrNoir(row.visual_render.colorProfile) : null,
    hook: motion.hook,
    hookSound: motion.hookSound,
    fullStory: row.full_story_below,
    audioType: row.audio_type,
    genre: row.genre,
  };
  const name = reelTitle(row.on_screen_copy, row.headline);
  const snapshots = row.media_id ? history.get(row.media_id) ?? [] : [];
  const status = attemptStatus(row.status);
  return {
    id: hubId('reels', 'attempt', row.attempt_id),
    vertical: 'reels',
    format: 'reel',
    name,
    description: text(row.headline) && text(row.headline) !== name ? text(row.headline) : text(row.on_screen_copy),
    status,
    statusNote: status === 'failed' ? text(row.error) : null,
    postedAt: status === 'published' ? finishedAt : null,
    publishAt: iso(row.schedule_publish_at),
    nyDate: nyDateFor(status === 'published' ? finishedAt : null, row.schedule_publish_at, row.requested_at),
    slot: { id: slot, label: slot === 'unscheduled' ? 'Outside a slot' : slotCaption(slot as never) },
    permalink: row.permalink,
    pipelineHref: '/reels',
    media: { kind: 'video', src: videoSrc(row.video_job_id, row.video_storage_path) },
    costMicros: null,
    costNote: null,
    metrics: latest(snapshots),
    history: snapshots,
    native: nativeFields(facts, { songTitle: row.song_title, songArtist: row.song_artist, graduation: row.graduation_strategy, trigger: row.trigger }),
    factorValues: reelFactorValues(facts),
    approval: {
      required: requireApproval && row.trigger === 'auto',
      // Approve and Force are a person's click (SH-17); an auto slot carries approved_at.
      approvedAt: row.trigger === 'force' ? iso(row.requested_at) : iso(row.approved_at) ?? (row.trigger === 'approve' ? iso(row.requested_at) : null),
      note: row.trigger === 'force' ? 'Force post' : row.trigger === 'approve' ? 'Approved' : null,
    },
    idea: { id: row.post_idea_id, label: text(row.headline) ?? name },
    generatedAt: iso(row.video_finished_at),
    versions: [],
    sources: [],
    costItemKey: row.video_job_id ? reelItem(row.post_idea_id, row.video_slate_id) : null,
    refs: {
      attemptId: row.attempt_id,
      postIdeaId: row.post_idea_id,
      ...(row.video_job_id ? { videoJobId: row.video_job_id } : {}),
      ...(row.schedule_id ? { scheduleId: row.schedule_id } : {}),
    },
  };
}

function schedulePost(row: ReelScheduleRow, requireApproval: boolean): HubPost {
  const slot = row.slot;
  const name = reelTitle(row.on_screen_copy, row.headline);
  const status = scheduleStatus(row.status);
  const facts: ReelFacts = {
    framework: row.chosen_framework,
    bucket: row.chosen_bucket,
    blockbuster: null,
    net: num(row.net),
    origin: null,
    slot,
    color: null,
    hook: null,
    hookSound: null,
    fullStory: null,
    audioType: null,
    genre: null,
  };
  return {
    id: hubId('reels', 'schedule', row.schedule_id),
    vertical: 'reels',
    format: 'reel',
    name,
    description: text(row.headline) && text(row.headline) !== name ? text(row.headline) : null,
    status,
    statusNote: status === 'cancelled' ? cancelNote(row.error) : status === 'failed' ? text(row.error) : null,
    postedAt: null,
    publishAt: iso(row.publish_at),
    nyDate: row.ny_date.slice(0, 10),
    slot: { id: slot, label: slotCaption(slot as never) },
    permalink: null,
    pipelineHref: '/reels',
    media: { kind: 'video', src: videoSrc(row.video_job_id, row.video_storage_path) },
    costMicros: null,
    costNote: null,
    metrics: {},
    history: [],
    native: nativeFields(facts, { songTitle: null, songArtist: null, graduation: null, trigger: null }),
    factorValues: reelFactorValues(facts),
    approval: {
      required: requireApproval && row.source === 'auto',
      approvedAt: iso(row.approved_at),
      note: row.source === 'user' ? 'Scheduled by a person' : null,
    },
    idea: { id: row.post_idea_id, label: text(row.headline) ?? name },
    generatedAt: iso(row.video_finished_at),
    versions: [],
    sources: [],
    costItemKey: row.video_job_id ? reelItem(row.post_idea_id, row.video_slate_id) : null,
    refs: {
      scheduleId: row.schedule_id,
      postIdeaId: row.post_idea_id,
      ...(row.video_job_id ? { videoJobId: row.video_job_id } : {}),
    },
  };
}

export function reelPosts(read: ReelsRead): HubPost[] {
  const history = historyByMedia(read.insights);
  const sourceRefs = new Map<string, Array<{ url: string; title: string | null }>>();
  for (const s of read.sources) {
    const list = sourceRefs.get(s.post_idea_id) ?? [];
    if (!list.some((x) => x.url === s.url)) list.push({ url: s.url, title: s.headline });
    sourceRefs.set(s.post_idea_id, list);
  }
  const posts = [
    ...read.attempts.map((row) => attemptPost(row, history, read.requireApproval)),
    ...read.schedules.map((row) => schedulePost(row, read.requireApproval)),
  ];
  for (const post of posts) {
    post.sources = post.idea ? sourceRefs.get(post.idea.id) ?? [] : [];
  }
  return foldLifecycle('reels', posts);
}

export function reelIdeas(rows: readonly ReelIdeaRow[]): HubIdea[] {
  return rows.map((row) => ({
    id: `reels:idea:${row.post_idea_id}`,
    vertical: 'reels',
    title: text(row.headline) ?? 'Untitled idea',
    score: num(row.net),
    scoreLabel: 'Net score',
    // Trial Reels content is never reused (SH-59): no Content-ready state.
    state: row.published ? 'published' : row.scheduled ? 'on_deck' : 'idea_only',
    hasContent: row.has_video,
    versionCount: row.video_count ?? 0,
    generatedAt: iso(row.last_video_at),
    createdAt: iso(row.scored_at),
    detail: [row.rank != null ? `Rank ${row.rank}` : null, row.selected ? 'Selected tonight' : null, row.origin === 'carryover' ? 'Carryover' : null]
      .filter(Boolean)
      .join(' · ') || null,
  }));
}
