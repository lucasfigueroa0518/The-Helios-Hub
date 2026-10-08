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
  | { kind: 'post'; action: 'approveCarousel' | 'approveTrialReel' | 'hardPublish' | 'hardRegenerate'; label: string; endpoint: string; body: Record<string, string | null>; disabled: string | null; confirm?: string }
  | { kind: 'link'; label: string; href: string; note: string };

export type Quota = { left: number | null; total: number | null; source: string; publishedLast24h: number };

const QUOTA_HEADROOM = 5;

/** What Hard publish does per vertical today (D28): said plainly before the click. */
const PUBLISH_CONFIRM: Record<'reels' | 'carousels' | 'explainers' | 'stories', string> = {
  reels: 'Force post this trial reel now, skipping its slot? Same as Force on /reels.',
  carousels: 'Post this carousel now, skipping its slot? Your click approves it; its waiting slot is closed so it can’t post twice.',
  explainers: 'Post this reel now, skipping its slot? Your click approves it (recorded as approved unless it was rejected in review).',
  stories: 'Approve and publish this set now ("Publish now" on /stories)?',
};

/** The actions a post offers in Content House, with the reason one is unavailable. */
export function actionsFor(post: HubPost, ctx: { quota: Quota | null; typicalCostLabel: string | null }): ActionPlan[] {
  const plans: ActionPlan[] = [];
  const info = verticalInfo(post.vertical);
  const live = post.status !== 'published' && post.status !== 'publishing';
  const quotaLow = ctx.quota?.left != null && ctx.quota.left < QUOTA_HEADROOM
    ? `Fewer than ${QUOTA_HEADROOM} posts left in the account's 24 h quota.`
    : null;

  if (post.vertical === 'carousels' && post.status === 'ready') {
    // Content ready (P2-M4): approving places it in the earliest open window.
    plans.push({ kind: 'post', action: 'approveCarousel', label: 'Approve', endpoint: '/api/social-hub/actions/approve-carousel', body: { postId: post.refs.postId ?? null }, disabled: post.refs.postId ? null : 'No content id.' });
  }
  if (post.status === 'scheduled' && post.approval.required && !post.approval.approvedAt) {
    if (post.vertical === 'carousels' && post.refs.scheduleId) {
      plans.push({ kind: 'post', action: 'approveCarousel', label: 'Approve', endpoint: '/api/social-hub/actions/approve-carousel', body: { scheduleId: post.refs.scheduleId }, disabled: null });
    } else if (post.vertical === 'reels' && post.refs.postIdeaId) {
      plans.push({ kind: 'post', action: 'approveTrialReel', label: 'Approve', endpoint: '/api/social-hub/actions/approve-trial-reel', body: { postIdeaId: post.refs.postIdeaId, videoJobId: post.refs.videoJobId ?? null }, disabled: null });
    }
  }
  if ((post.vertical === 'explainers' || post.vertical === 'stories') && post.status === 'ready' && !post.approval.approvedAt) {
    plans.push({ kind: 'link', label: 'Review', href: info.reviewHref, note: `Approved on ${info.reviewHref}, which keeps its tag-based feedback.` });
  }

  if (live) {
    const noContent = post.media.kind === 'none' || (post.media.kind === 'slides' && post.media.slides.length === 0) || (post.media.kind === 'frames' && post.media.frames.length === 0)
      ? 'Nothing generated yet. Hard regenerate first.'
      : null;
    const ref = post.vertical === 'reels' ? post.refs.videoJobId : post.vertical === 'carousels' ? post.refs.postId : post.vertical === 'explainers' ? post.refs.jobId : post.refs.setId;
    const skipped = post.status === 'skipped' ? 'A Story set that missed its window is never reused (SH-53).' : null;
    plans.push({
      kind: 'post', action: 'hardPublish', label: 'Hard publish', endpoint: '/api/social-hub/actions/hard-publish',
      body: { vertical: post.vertical, ref: ref ?? null },
      disabled: !ref ? (post.vertical === 'reels' ? 'No video yet.' : 'No content id.') : skipped ?? noContent ?? quotaLow,
      confirm: PUBLISH_CONFIRM[post.vertical],
    });
  }

  if (post.vertical === 'stories' || post.vertical === 'explainers') {
    const ref = post.vertical === 'stories' ? post.refs.setId : post.refs.topicId;
    plans.push({
      kind: 'post', action: 'hardRegenerate', label: 'Hard regenerate', endpoint: '/api/social-hub/actions/hard-regenerate',
      body: { vertical: post.vertical, ref: ref ?? null },
      disabled: !ref ? 'No idea id.' : post.vertical === 'stories' && post.status === 'published' ? 'A posted Story set is not regenerated.' : null,
      confirm: post.vertical === 'stories'
        ? `Rebuild this set now? Typical cost ${ctx.typicalCostLabel ?? 'unknown'} a set. The current set is rejected (kept in history) and a new one is requested for the same day.`
        : `Render this topic again now? Typical cost ${ctx.typicalCostLabel ?? 'unknown'} a reel. The new render replaces the current version when it finishes (old kept in history). The daily render and spend caps still apply.`,
    });
  } else {
    plans.push({ kind: 'link', label: 'Regenerate', href: info.href === '/social' ? '/social/house?tab=ideas' : info.href, note: `${info.label} has no one-post rerun; reruns start from its own page.` });
  }
  return plans;
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

