import { costOfPosts } from '@/lib/social-hub/cost';
import { mean, metricSpec, postMetric } from '@/lib/social-hub/metrics';
import { addDays, dateTimeLabel, inRange } from '@/lib/social-hub/time';
import { VERTICALS, verticalInfo } from '@/lib/social-hub/verticals';
import type { DateRange, HubIdea, HubPost, HubSource, MetricKey, Vertical } from '@/lib/social-hub/types';

/** Content House (spec §7): pure selections over the dataset. */

export type HouseTab = 'approval' | 'today' | 'deck' | 'all' | 'ideas' | 'sources' | 'types';

export const HOUSE_TABS: Array<{ id: HouseTab; label: string }> = [
  { id: 'approval', label: 'Needs approval' },
  { id: 'today', label: 'Today' },
  { id: 'deck', label: 'On deck' },
  { id: 'all', label: 'All content' },
  { id: 'ideas', label: 'Ideas' },
  { id: 'sources', label: 'Sources' },
  { id: 'types', label: 'Types' },
];

export function houseTab(value: string | undefined): HouseTab {
  return HOUSE_TABS.some((t) => t.id === value) ? (value as HouseTab) : 'approval';
}

const at = (p: HubPost) => p.publishAt ?? p.postedAt;

function bySoonest(a: HubPost, b: HubPost): number {
  const x = at(a);
  const y = at(b);
  if (x && y) return x.localeCompare(y) || a.id.localeCompare(b.id);
  if (x) return -1;
  if (y) return 1;
  return (b.generatedAt ?? '').localeCompare(a.generatedAt ?? '') || a.id.localeCompare(b.id);
}

/**
 * Everything waiting on a person, across types, soonest slot first:
 * scheduled slots not yet approved, renders and sets awaiting review, and
 * carousels in review with no slot.
 */
export function needsApproval(posts: readonly HubPost[], now: Date): HubPost[] {
  const nowIso = now.toISOString();
  return posts
    .filter((p) => {
      if (p.status === 'scheduled') return p.approval.required && !p.approval.approvedAt && (p.publishAt ?? '') > nowIso;
      if (p.status !== 'ready') return false;
      if (p.vertical === 'explainers') return !p.approval.approvedAt && p.approval.note !== 'Rejected';
      return !p.approval.approvedAt;
    })
    .sort(bySoonest);
}

/** "2 h 15 m left", "slot passed", or null when there's no slot. */
export function timeLeft(post: HubPost, now: Date): string | null {
  if (!post.publishAt) return null;
  const ms = Date.parse(post.publishAt) - now.getTime();
  if (ms <= 0) return 'slot passed';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} m left`;
  return `${Math.floor(hours / 24)} days left`;
}

export function todayPosts(posts: readonly HubPost[], today: string): HubPost[] {
  return posts.filter((p) => p.nyDate === today && p.status !== 'ready').sort(bySoonest);
}

export function onDeck(posts: readonly HubPost[]): HubPost[] {
  return posts.filter((p) => p.status === 'scheduled' || p.status === 'publishing').sort(bySoonest);
}

export type ContentFilter = { vertical: Vertical | null; status: string | null; range: DateRange | null };

/** Every post (published, scheduled, failed, ready…), filterable like the analytics table. */
export function allContent(posts: readonly HubPost[], f: ContentFilter): HubPost[] {
  return posts.filter((p) => {
    if (f.vertical && p.vertical !== f.vertical) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.range && p.nyDate && !inRange(p.nyDate, f.range)) return false;
    return true;
  });
}

export function ideasView(ideas: readonly HubIdea[], f: { vertical: Vertical | null; hasContent: boolean | null }): HubIdea[] {
  return ideas
    .filter((i) => (!f.vertical || i.vertical === f.vertical) && (f.hasContent == null || i.hasContent === f.hasContent))
    .sort((a, b) => a.vertical.localeCompare(b.vertical) || (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.title.localeCompare(b.title));
}

export type SourceRow = HubSource & { reuse: number; metric: number | null };

/** Sources with reuse counts and those posts' mean on the selected metric (published posts only). */
export function sourceRows(sources: readonly HubSource[], posts: readonly HubPost[], metric: MetricKey): SourceRow[] {
  const byId = new Map(posts.map((p) => [p.id, p]));
  return sources.map((s) => {
    const used = s.postIds.map((id) => byId.get(id)).filter((p): p is HubPost => !!p && p.status === 'published');
    return { ...s, reuse: s.postIds.length, metric: mean(used.map((p) => postMetric(p, metric))) };
  });
}

export type TypeRow = { vertical: Vertical; label: string; posts: number; value: number | null; costPerPost: number | null; totalCost: number };

/** Performance by vertical for the selected metric and range, with post counts and cost per post (SH-20, SH-21). */
export function typeRows(posts: readonly HubPost[], metric: MetricKey, range: DateRange): TypeRow[] {
  return VERTICALS.map((v) => {
    const mine = posts.filter((p) => p.vertical === v.id && p.status === 'published' && inRange(p.nyDate, range));
    const cost = costOfPosts(mine);
    const applies = metricSpec(metric).formats.includes(v.format);
    return {
      vertical: v.id,
      label: v.label,
      posts: mine.length,
      // Per-post mean so verticals with different volumes compare fairly.
      value: applies ? mean(mine.map((p) => postMetric(p, metric))) : null,
      costPerPost: cost.items ? Math.round(cost.micros / cost.items) : null,
      totalCost: cost.micros,
    };
  });
}

/** Typical cost of one post for a vertical: mean over its published posts in the last 30 days (SH-16 confirm). */
export function typicalCost(posts: readonly HubPost[], vertical: Vertical, today: string): number | null {
  const range: DateRange = { id: '30d', from: addDays(today, -29), to: today };
  const mine = posts.filter((p) => p.vertical === vertical && p.status === 'published' && inRange(p.nyDate, range));
  const cost = costOfPosts(mine);
  return cost.items ? Math.round(cost.micros / cost.items) : null;
}

// ── Actions (flagged; wired only to existing functions) ──────────────────────

export type ActionPlan =
  | {
      kind: 'post';
      action: 'approveCarousel' | 'approveTrialReel' | 'approveContent' | 'hardPublish' | 'hardRegenerate' | 'reject' | 'place' | 'reschedule';
      label: string;
      endpoint: string;
      body: Record<string, unknown>;
      disabled: string | null;
      confirm?: string;
      /** The person picks a day and window before it runs (place, reschedule; D50). */
      pick?: 'slot';
    }
  | { kind: 'link'; label: string; href: string; note: string };

export type Quota = { left: number | null; total: number | null; source: string; publishedLast24h: number };

const QUOTA_HEADROOM = 5;

/** What Hard publish does per vertical today (D28): said plainly before the click. */
const PUBLISH_CONFIRM: Record<'reels' | 'carousels' | 'explainers' | 'stories', string> = {
  reels: 'This trial reel goes out now instead of in its slot. Publishing counts as your approval.',
  carousels: 'This carousel goes out now instead of in its slot. Publishing counts as your approval, and its waiting slot is released so it can’t post twice.',
  explainers: 'This reel goes out now instead of in its slot. Publishing counts as your approval unless it was rejected in review.',
  stories: 'This set is approved and goes out now, frame by frame.',
};

/** The actions a post offers in Content House, with the reason one is unavailable. */
export function actionsFor(post: HubPost, ctx: { quota: Quota | null; typicalCostLabel: string | null }): ActionPlan[] {
  const plans: ActionPlan[] = [];
  const info = verticalInfo(post.vertical);
  const live = post.status !== 'published' && post.status !== 'publishing';
  const quotaLow = ctx.quota?.left != null && ctx.quota.left < QUOTA_HEADROOM
    ? `Fewer than ${QUOTA_HEADROOM} posts left in Instagram’s 24-hour limit, so publishing is paused.`
    : null;

  if (post.vertical === 'carousels' && post.status === 'ready') {
    // Content ready (P2-M4): approving places it in the earliest open window.
    plans.push({ kind: 'post', action: 'approveCarousel', label: 'Approve', endpoint: '/api/social-hub/actions/approve-carousel', body: { postId: post.refs.postId ?? null }, disabled: post.refs.postId ? null : 'This content can’t be found any more.' });
  }
  if (post.status === 'scheduled' && post.approval.required && !post.approval.approvedAt) {
    if (post.vertical === 'carousels' && post.refs.scheduleId) {
      plans.push({ kind: 'post', action: 'approveCarousel', label: 'Approve', endpoint: '/api/social-hub/actions/approve-carousel', body: { scheduleId: post.refs.scheduleId }, disabled: null });
    } else if (post.vertical === 'reels' && post.refs.postIdeaId) {
      plans.push({ kind: 'post', action: 'approveTrialReel', label: 'Approve', endpoint: '/api/social-hub/actions/approve-trial-reel', body: { postIdeaId: post.refs.postIdeaId, videoJobId: post.refs.videoJobId ?? null }, disabled: null });
    }
  }
  // Reject (D47): content that hasn't posted yet never will. Explainers are rejected on their review
  // page, which keeps the tag-based feedback (the link below).
  if (post.vertical !== 'explainers' && (post.status === 'ready' || post.status === 'scheduled')) {
    const refs = post.vertical === 'carousels'
      ? { postId: post.refs.postId }
      : post.vertical === 'reels'
        ? { postIdeaId: post.refs.postIdeaId, ...(post.refs.videoJobId ? { videoJobId: post.refs.videoJobId } : {}) }
        : { setId: post.refs.setId };
    const missing = Object.values(refs).some((v) => !v);
    plans.push({
      kind: 'post', action: 'reject', label: 'Reject', endpoint: '/api/social-hub/actions/reject',
      body: { vertical: post.vertical, refs }, disabled: missing ? 'This content can’t be found any more.' : null,
      confirm: 'It won’t post, and its slot opens for something else.',
    });
  }
  if ((post.vertical === 'explainers' || post.vertical === 'stories') && post.status === 'ready' && !post.approval.approvedAt) {
    const ref = post.vertical === 'explainers' ? post.refs.jobId : post.refs.setId;
    plans.push({
      kind: 'post', action: 'approveContent', label: 'Approve', endpoint: '/api/social-hub/actions/approve-content',
      body: { vertical: post.vertical, refs: post.vertical === 'explainers' ? { jobId: ref } : { setId: ref } },
      disabled: ref ? null : 'This content can’t be found any more.',
    });
    plans.push({ kind: 'link', label: 'Review', href: info.reviewHref, note: `Reviewed in ${info.label}, where its tagged feedback lives.` });
  }

  // Schedule here / move (D50): content with no slot is placed; a waiting slot is moved.
  const placeRefs = contentRefs(post);
  const rejected = /\brejected\b/i.test(post.approval.note ?? '') || /\brejected\b/i.test(post.statusNote ?? '');
  if (post.status === 'ready' && !rejected) {
    plans.push({ kind: 'post', action: 'place', label: 'Schedule', endpoint: '/api/social-hub/actions/place', body: { vertical: post.vertical, refs: placeRefs }, disabled: Object.values(placeRefs).some((v) => !v) ? 'This content can’t be found any more.' : null, pick: 'slot' });
  }
  if (post.status === 'scheduled') {
    plans.push({ kind: 'post', action: 'reschedule', label: 'Move', endpoint: '/api/social-hub/actions/reschedule', body: { vertical: post.vertical, refs: placeRefs }, disabled: Object.values(placeRefs).some((v) => !v) ? 'This slot can’t be found any more.' : null, pick: 'slot' });
  }

  if (live) {
    const noContent = post.media.kind === 'none' || (post.media.kind === 'slides' && post.media.slides.length === 0) || (post.media.kind === 'frames' && post.media.frames.length === 0)
      ? 'Nothing to publish yet. Regenerate first.'
      : null;
    const ref = post.vertical === 'reels' ? post.refs.videoJobId : post.vertical === 'carousels' ? post.refs.postId : post.vertical === 'explainers' ? post.refs.jobId : post.refs.setId;
    const skipped = post.status === 'skipped' ? 'Story sets that miss their window are never reused.' : null;
    plans.push({
      kind: 'post', action: 'hardPublish', label: 'Hard publish', endpoint: '/api/social-hub/actions/hard-publish',
      body: { vertical: post.vertical, ref: ref ?? null },
      disabled: !ref ? (post.vertical === 'reels' ? 'The video isn’t made yet.' : 'This content can’t be found any more.') : skipped ?? noContent ?? quotaLow,
      confirm: PUBLISH_CONFIRM[post.vertical],
    });
  }

  if (post.vertical === 'carousels' || post.vertical === 'reels') {
    // One-post reruns (D51 carousels: a queued rerun of the same story; D52 Trial Reels: today's video rebuilt).
    const refs = post.vertical === 'carousels' ? { postId: post.refs.postId } : { postIdeaId: post.refs.postIdeaId };
    plans.push({
      kind: 'post', action: 'hardRegenerate', label: 'Hard regenerate', endpoint: '/api/social-hub/actions/hard-regenerate',
      body: { vertical: post.vertical, refs },
      disabled: Object.values(refs).some((v) => !v) ? 'The idea behind this can’t be found any more.' : post.status === 'published' ? 'Posted content isn’t rebuilt.' : null,
      confirm: post.vertical === 'carousels'
        ? `A new version is made from the same story, up to $2. It lands in Content ready; the current version stays in history and keeps any slot until you move or reject it.`
        : `Today’s video for this idea is rebuilt: copy, frames and video. Typical cost ${ctx.typicalCostLabel ?? 'unknown'} a reel. It replaces the current one when it finishes.`,
    });
  }
  if (post.vertical === 'stories' || post.vertical === 'explainers') {
    const ref = post.vertical === 'stories' ? post.refs.setId : post.refs.topicId;
    plans.push({
      kind: 'post', action: 'hardRegenerate', label: 'Hard regenerate', endpoint: '/api/social-hub/actions/hard-regenerate',
      body: { vertical: post.vertical, ref: ref ?? null },
      disabled: !ref ? 'The idea behind this can’t be found any more.' : post.vertical === 'stories' && post.status === 'published' ? 'A posted Story set isn’t rebuilt.' : null,
      confirm: post.vertical === 'stories'
        ? `A new set is built for the same day. Typical cost ${ctx.typicalCostLabel ?? 'unknown'} a set. The current set is set aside and kept in history.`
        : `A new version is rendered. Typical cost ${ctx.typicalCostLabel ?? 'unknown'} a reel. It replaces the current one when it finishes, the old one stays in history, and the daily render and spend caps still apply.`,
    });
  }
  return plans;
}

/** The content a placement or rerun names (D50): the item each type schedules. */
export function contentRefs(post: HubPost): Record<string, string | undefined> {
  switch (post.vertical) {
    case 'carousels':
      return { postId: post.refs.postId };
    case 'reels':
      return { postIdeaId: post.refs.postIdeaId };
    case 'explainers':
      return { jobId: post.refs.jobId };
    case 'stories':
      return { setId: post.refs.setId };
  }
}

// ── Quota (24 h) ─────────────────────────────────────────────────────────────

/** "The Instagram account has 3 of 100 posts left in its 24-hour quota." / "publishing quota: 98/100 used". */
export function parseQuotaMessage(text: string | null | undefined): { left: number; total: number } | null {
  if (!text) return null;
  const left = text.match(/has (\d+) of (\d+) posts left/i);
  if (left) return { left: Number(left[1]), total: Number(left[2]) };
  const used = text.match(/publishing quota: (\d+)\/(\d+) used/i);
  if (used) return { left: Number(used[2]) - Number(used[1]), total: Number(used[2]) };
  return null;
}

/** Media published in the last 24 h, counted from the pipelines' own rows (a Story set counts its frames). */
export function publishedLast24h(posts: readonly HubPost[], now: Date): number {
  const since = now.getTime() - 86_400_000;
  return posts
    .filter((p) => p.status === 'published' && p.postedAt && Date.parse(p.postedAt) > since)
    .reduce((n, p) => n + (p.media.kind === 'frames' ? Math.max(1, p.media.frames.length) : 1), 0);
}

export function quotaFrom(latest: { text: string | null; at: string | null } | null, posts: readonly HubPost[], now: Date): Quota {
  const parsed = latest && latest.at && Date.parse(latest.at) > now.getTime() - 86_400_000 ? parseQuotaMessage(latest.text) : null;
  return {
    left: parsed?.left ?? null,
    total: parsed?.total ?? null,
    source: parsed ? `as Meta reported it ${dateTimeLabel(latest!.at)} ET` : 'Meta’s number isn’t logged by the publishers yet',
    publishedLast24h: publishedLast24h(posts, now),
  };
}

