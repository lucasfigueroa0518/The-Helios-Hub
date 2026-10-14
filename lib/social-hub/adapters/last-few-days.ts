import { attemptStatus, cancelNote, category, historyByMedia, iso, latest, nyDateFor, scheduleStatus, text, yesNo } from '@/lib/social-hub/adapters/common';
import { hubId } from '@/lib/social-hub/ids';
import { foldLifecycle } from '@/lib/social-hub/lifecycle';
import type { LfdPostRow, LfdRead, LfdRunRow } from '@/lib/social-hub/queries/last-few-days';
import type { FactorValue, HubIdea, HubPost, HubStatus, MetricSnapshot, NativeField, SourceRef } from '@/lib/social-hub/types';

/**
 * Last Few Days posts and ideas for the hub (spec §8). A post is one lfd.posts
 * row through its life (ready → scheduled → posting → published), under the id
 * `last_few_days:<post id>`. The review screen shows its slides, its caption,
 * each story's source, and what the pipeline flagged (short post, text fit,
 * broken slides).
 */

const SLOT_LABEL: Record<string, string> = { morning: 'Morning · 9:00–10:00 AM' };

type Story = { lane?: string; url?: string; outlet?: string; headline?: string; body?: string; photo?: { src?: string; kind?: string } };
type Context = { slot: string | null; approvedAt: string | null; requireApproval: boolean };
type RenderSlide = { layoutVariant?: unknown; altText?: unknown; photoUrl?: unknown; lfdStory?: { headline?: unknown; body?: unknown } };

const storiesOf = (row: LfdPostRow): Story[] => (Array.isArray(row.stories) ? (row.stories as Story[]) : []);
const listOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);
const day = (row: Pick<LfdPostRow, 'ny_date'>) => row.ny_date.slice(0, 10);

/** "Last Few Days · Tue, Oct 13" */
export function lfdTitle(row: Pick<LfdPostRow, 'ny_date'>): string {
  const date = new Date(`${day(row)}T12:00:00Z`);
  return `Last Few Days · ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

/** What the review screen flags: a short post, text taller than the template allows, broken slides. */
export function lfdReviewNotes(row: LfdPostRow): string[] {
  const n = storiesOf(row).length;
  return [
    ...(row.short ? [`Short post: only ${n} ${n === 1 ? 'story' : 'stories'}.`] : []),
    ...listOf(row.fit_problems).map((p) => `Text fit: ${p}`),
    ...listOf(row.render_problems).map((p) => `Render: ${p}`),
  ];
}

/** Each story's article, once, as "Outlet: Headline". */
export function lfdSources(row: LfdPostRow): SourceRef[] {
  const seen = new Set<string>();
  return storiesOf(row).flatMap((s) => {
    if (!s.url || seen.has(s.url)) return [];
    seen.add(s.url);
    return [{ url: s.url, title: [s.outlet, s.headline].filter(Boolean).join(': ') || null }];
  });
}

/** The slides: rendered JPEGs through /api/last-few-days/slides once stored, else the outline from `render`. */
export function lfdSlides(row: LfdPostRow): Array<{ src: string | null; alt: string; photo: string | null; layout: string | null; headline: string | null; body: string | null }> {
  const slides = Array.isArray(row.render?.slides) ? (row.render!.slides as RenderSlide[]) : [];
  const count = Math.max(slides.length, row.slide_count ?? 0);
  const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
  return Array.from({ length: count }, (_, i) => {
    const slide = slides[i] ?? {};
    return {
      src: row.has_slide_objects ? `/api/last-few-days/slides/${row.post_id}/${i}` : null,
      alt: str(slide.altText) ?? `${lfdTitle(row)}, slide ${i + 1}`,
      photo: typeof slide.photoUrl === 'string' && /^https:\/\//.test(slide.photoUrl) ? slide.photoUrl : null,
      layout: str(slide.layoutVariant),
      headline: str(slide.lfdStory?.headline),
      body: str(slide.lfdStory?.body),
    };
  });
}

function nativeFields(row: LfdPostRow, ctx: Context): NativeField[] {
  const stories = storiesOf(row);
  return [
    { group: 'content', label: 'Stories', value: String(stories.length) },
    { group: 'content', label: 'Major headlines', value: String(stories.filter((s) => s.lane === 'major').length) },
    { group: 'content', label: 'Short post', value: row.short ? 'Yes' : 'No' },
    { group: 'production', label: 'Slides', value: row.slide_count == null ? '—' : String(row.slide_count) },
    { group: 'production', label: 'Text fit problems', value: String(listOf(row.fit_problems).length) },
    { group: 'production', label: 'Render problems', value: String(listOf(row.render_problems).length) },
    { group: 'scheduling', label: 'Posting slot', value: ctx.slot ? SLOT_LABEL[ctx.slot] ?? ctx.slot : '—' },
    { group: 'scheduling', label: 'Approval', value: ctx.approvedAt ? 'Approved' : ctx.requireApproval ? 'Needs approval' : 'Not required' },
    { group: 'scheduling', label: 'Slug', value: row.slug },
  ];
}

function factorValues(row: LfdPostRow, ctx: Context): Record<string, FactorValue> {
  const n = storiesOf(row).length;
  return {
    stories: { kind: 'category', key: String(n), label: `${n} stories` },
    short: yesNo(row.short, ['short', 'Short post'], ['full', 'Full post']),
    slot: category(ctx.slot, SLOT_LABEL, 'Outside a slot'),
    approval: ctx.approvedAt ? { kind: 'category', key: 'approved', label: 'Approved' } : { kind: 'category', key: 'not_approved', label: 'Not approved' },
  };
}

function shell(row: LfdPostRow, ctx: Context) {
  return {
    vertical: 'last_few_days' as const,
    format: 'feed' as const,
    name: lfdTitle(row),
    description: text(row.caption),
    slot: ctx.slot ? { id: ctx.slot, label: SLOT_LABEL[ctx.slot] ?? ctx.slot } : null,
    pipelineHref: '/last-few-days',
    media: { kind: 'slides' as const, slides: lfdSlides(row) },
    costMicros: null,
    costNote: null,
    native: nativeFields(row, ctx),
    factorValues: factorValues(row, ctx),
    approval: { required: ctx.requireApproval, approvedAt: ctx.approvedAt, note: ctx.approvedAt ? 'Approved' : null },
    // Not stored (idea_ref is NULL, spec §7.2): the post's own day, so "today's post" can be found.
    idea: { id: `lfd:${day(row)}`, label: `Last Few Days for ${day(row)}` },
    generatedAt: iso(row.created_at),
    versions: [],
    sources: lfdSources(row),
    costItemKey: `last_few_days:${row.post_id}`,
    reviewNotes: lfdReviewNotes(row),
  };
}

export function lfdPosts(read: LfdRead): HubPost[] {
  const history = historyByMedia(read.insights);
  const byId = new Map(read.posts.map((p) => [p.post_id, p]));
  const posts: HubPost[] = [];

  for (const row of read.attempts) {
    const post = byId.get(row.post_id);
    if (!post) continue;
    const status = attemptStatus(row.status);
    const snapshots: MetricSnapshot[] = row.media_id ? history.get(row.media_id) ?? [] : [];
    const finished = iso(row.finished_at);
    // Approve and Force are a person's click (SH-17); an auto slot carries approved_at.
    const approvedAt = row.trigger === 'force' ? iso(row.requested_at) : iso(row.approved_at) ?? (row.trigger === 'approve' ? iso(row.requested_at) : null);
    posts.push({
      ...shell(post, { slot: row.slot, approvedAt, requireApproval: read.requireApproval && row.trigger === 'auto' }),
      id: hubId('last_few_days', 'attempt', row.attempt_id),
      status,
      statusNote: status === 'failed' ? text(row.error) : null,
      postedAt: status === 'published' ? finished : null,
      publishAt: iso(row.publish_at),
      nyDate: nyDateFor(status === 'published' ? finished : null, row.publish_at, row.requested_at),
      permalink: row.permalink,
      metrics: latest(snapshots),
      history: snapshots,
      refs: { attemptId: row.attempt_id, lfdPostId: row.post_id, ...(row.schedule_id ? { scheduleId: row.schedule_id } : {}) },
    });
  }
  for (const row of read.schedules) {
    const post = byId.get(row.post_id);
    if (!post) continue;
    const status: HubStatus = scheduleStatus(row.status);
    posts.push({
      ...shell(post, { slot: row.slot, approvedAt: iso(row.approved_at), requireApproval: read.requireApproval && row.source === 'auto' }),
      id: hubId('last_few_days', 'schedule', row.schedule_id),
      status,
      statusNote: status === 'cancelled' ? cancelNote(row.error) : status === 'failed' ? text(row.error) : null,
      postedAt: null,
      publishAt: iso(row.publish_at),
      nyDate: row.ny_date.slice(0, 10),
      permalink: null,
      metrics: {},
      history: [],
      refs: { scheduleId: row.schedule_id, lfdPostId: row.post_id },
    });
  }
  // Content ready: every post still in review. The lifecycle view keeps it only when nothing live holds it.
  for (const row of read.posts) {
    if (row.status !== 'review') continue;
    posts.push({
      ...shell(row, { slot: null, approvedAt: null, requireApproval: read.requireApproval }),
      id: hubId('last_few_days', 'post', row.post_id),
      status: 'ready',
      statusNote: 'In review, not scheduled',
      postedAt: null,
      publishAt: null,
      nyDate: null,
      permalink: null,
      metrics: {},
      history: [],
      refs: { lfdPostId: row.post_id },
    });
  }
  return foldLifecycle('last_few_days', posts);
}

type QueueEntry = { key?: string; headline?: string; lane?: string; major?: number | null; net?: number | null; reason?: string; detail?: string };

const DROP_REASON: Record<string, string> = {
  'thin-text': 'the article text was too thin',
  'not-grounded': 'it failed the fact check twice',
  'no-photo': 'no usable photo',
  'write-failed': 'the writing call failed for it',
  'image-failed': 'its photo failed to load',
  unfinished: 'still waiting when the rounds ran out',
  'vision-rejected': "the vision check said its photo doesn't show the story",
};

/**
 * The Ideas view (spec §8): the latest run's picks (in the post), its drops
 * with the reason, and the rest of each lane's queue, in post order. The pool
 * for the next post needs Jev judgments, so it is not computed on a page view.
 */
export function lfdIdeas(run: LfdRunRow | null): HubIdea[] {
  if (!run) return [];
  const r = (run.record ?? {}) as { window?: { after?: string; through?: string }; picks?: QueueEntry[]; drops?: QueueEntry[]; queues?: { major?: QueueEntry[]; rundown?: QueueEntry[] } };
  const window = r.window?.after && r.window.through ? `window ${r.window.after} → ${r.window.through}` : null;
  const at = iso(run.started_at ?? run.requested_at);
  const out: HubIdea[] = [];
  const seen = new Set<string>();
  const add = (e: QueueEntry, lane: string, state: HubIdea['state'], note: string | null) => {
    if (!e.key || seen.has(e.key)) return;
    seen.add(e.key);
    const scored = e.major != null ? `major-news ${e.major.toFixed(2)}` : e.net != null ? `net ${e.net.toFixed(2)}` : null;
    const laneLabel = lane === 'major' ? 'Major headline' : 'Rundown';
    out.push({
      id: `last_few_days:story:${e.key}`,
      vertical: 'last_few_days',
      title: text(e.headline) ?? e.key,
      // Post order, highest first: rankIdeas sorts by score.
      score: -out.length,
      scoreLabel: 'Order for the post (major headlines first)',
      breakdown: {
        formula: 'Up to 3 major headlines (major-news@2 at or above 0.55) lead; Text on Screen ideas fill the rest by best net score.',
        parts: [{ label: laneLabel, points: null, detail: scored }],
        note: window,
      },
      state,
      hasContent: state === 'content_ready',
      versionCount: state === 'content_ready' ? 1 : 0,
      generatedAt: state === 'content_ready' ? at : null,
      createdAt: at,
      detail: [laneLabel, note, window].filter(Boolean).join(' · '),
    });
  };
  for (const p of r.picks ?? []) add(p, p.lane ?? 'rundown', 'content_ready', 'in the post');
  for (const d of r.drops ?? []) add(d, d.lane ?? 'rundown', 'retired', `dropped: ${DROP_REASON[d.reason ?? ''] ?? d.reason ?? 'no reason recorded'}${d.detail ? ` (${d.detail})` : ''}`);
  for (const q of r.queues?.major ?? []) add(q, 'major', 'idea_only', null);
  for (const q of r.queues?.rundown ?? []) add(q, 'rundown', 'idea_only', null);
  return out;
}
