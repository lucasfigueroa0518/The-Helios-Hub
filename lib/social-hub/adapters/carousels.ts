import {
  attemptStatus,
  cancelNote,
  category,
  firstLine,
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
import type { CarouselIdeaRow, CarouselPostRow, CarouselsRead } from '@/lib/social-hub/queries/carousels';
import type { ContentVersion, FactorValue, HubIdea, HubPost, HubStatus, MetricSnapshot, NativeField, SourceRef } from '@/lib/social-hub/types';
import { CAROUSEL_SLOTS } from '@/lib/social/overnight/config';

const SLOT_LABEL: Record<string, string> = Object.fromEntries(
  CAROUSEL_SLOTS.map((w) => [w.id, `${w.id === 'morning' ? 'Morning' : 'Afternoon'} · ${w.label}`]),
);

export const PHOTO_SOURCE_LABEL: Record<string, string> = {
  wikimedia: 'Wikimedia',
  wikidata: 'Wikidata',
  unsplash: 'Unsplash',
  pexels: 'Pexels',
  logo: 'Logo',
  og: 'Article image',
  starter: 'Starter pool',
};

function slideCountBand(n: number | null): FactorValue {
  if (n == null) return { kind: 'category', key: 'unknown', label: 'Unknown' };
  return { kind: 'category', key: String(n), label: `${n} slides` };
}

function renderField(row: CarouselPostRow, key: string): string | null {
  const value = row.render?.[key];
  return typeof value === 'string' ? text(value) : null;
}

/** Fixes and warnings the pipeline left for the review screen (spec §7 Needs approval). */
export function checkLines(row: CarouselPostRow): string[] {
  const c = row.checks;
  if (!c) return [];
  const say = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return String(o.detail ?? o.message ?? o.rule ?? o.code ?? JSON.stringify(v)).slice(0, 200);
    }
    return String(v);
  };
  return [
    ...(c.warnings ?? []).map((w) => `Warning: ${say(w)}`),
    ...(c.fixes ?? []).map((f) => `Fixed: ${say(f)}`),
    ...(c.photoReplacements ?? []).map((p) => `Photo replaced: ${say(p)}`),
    ...(c.renderReview ?? []).map((r) => `Render review: ${say(r)}`),
  ];
}

type Context = {
  slot: string | null;
  approvedAt: string | null;
  requireApproval: boolean;
};

function factorValues(row: CarouselPostRow, ctx: Context): Record<string, FactorValue> {
  return {
    hook: yesNo(row.hook_pass, ['on', 'Hook pass on'], ['off', 'Hook pass off']),
    slides: slideCountBand(num(row.slide_count)),
    photos: {
      kind: 'tags',
      values: (row.photo_sources ?? []).map((s) => ({ key: s, label: PHOTO_SOURCE_LABEL[s] ?? s })),
      empty: 'No photo record',
    },
    source: category(renderField(row, 'source'), {}, 'Unknown source'),
    slot: category(ctx.slot, SLOT_LABEL, 'Outside a slot'),
    approval: ctx.approvedAt ? { kind: 'category', key: 'approved', label: 'Approved' } : { kind: 'category', key: 'not_approved', label: 'Not approved' },
  };
}

function nativeFields(row: CarouselPostRow, ctx: Context): NativeField[] {
  const checks = checkLines(row);
  return [
    { group: 'content', label: 'Title', value: row.title },
    { group: 'content', label: 'Story source', value: renderField(row, 'source') ?? '—' },
    { group: 'content', label: 'Story type', value: renderField(row, 'storyType') ?? '—' },
    { group: 'production', label: 'Slides', value: row.slide_count == null ? '—' : String(row.slide_count) },
    { group: 'production', label: 'Hook pass', value: row.hook_pass == null ? '—' : row.hook_pass ? 'On' : 'Off' },
    { group: 'production', label: 'Photo sources', value: row.photo_sources?.length ? row.photo_sources.map((s) => PHOTO_SOURCE_LABEL[s] ?? s).join(', ') : '—' },
    { group: 'production', label: 'Render checks', value: checks.length ? `${checks.length} note${checks.length === 1 ? '' : 's'}` : 'None' },
    { group: 'scheduling', label: 'Posting slot', value: ctx.slot ? SLOT_LABEL[ctx.slot] ?? ctx.slot : '—' },
    { group: 'scheduling', label: 'Approval', value: ctx.approvedAt ? 'Approved' : ctx.requireApproval ? 'Needs approval' : 'Not required' },
    { group: 'scheduling', label: 'Slug', value: row.slug },
  ];
}

function sourcesOf(row: CarouselPostRow): SourceRef[] {
  const url = renderField(row, 'sourceUrl');
  return url ? [{ url, title: row.title }] : [];
}

function versionsFor(row: CarouselPostRow, all: readonly CarouselPostRow[], current: string | null): ContentVersion[] {
  if (!row.story_id) return [];
  return all
    .filter((p) => p.story_id === row.story_id)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((p) => ({ id: p.post_id, createdAt: iso(p.created_at)!, trigger: 'nightly', current: p.post_id === current, status: p.status }));
}

function spanText(value: unknown): string | null {
  if (!Array.isArray(value)) return typeof value === 'string' ? text(value) : null;
  return text(value.map((span) => (span && typeof span === 'object' && typeof (span as { text?: unknown }).text === 'string' ? (span as { text: string }).text : '')).join(''));
}

/** Slide outline from the stored render (headline, body, public photo URL), in order. */
export function slideOutline(row: CarouselPostRow): Array<{ src: string | null; alt: string; photo: string | null; layout: string | null; headline: string | null; body: string | null }> {
  const slides = Array.isArray(row.render?.slides) ? (row.render!.slides as Array<Record<string, unknown>>) : [];
  const count = Math.max(slides.length, num(row.slide_count) ?? 0);
  return Array.from({ length: count }, (_, i) => {
    const slide = slides[i] ?? {};
    const photo = typeof slide.photoUrl === 'string' && /^https:\/\//.test(slide.photoUrl) ? slide.photoUrl : null;
    return {
      // Rendered JPEG through the carousel slide route when the post has slide objects.
      src: row.has_slide_objects ? `/api/social/slides/${row.post_id}/${i}` : null,
      alt: typeof slide.altText === 'string' ? slide.altText : `${row.title}, slide ${i + 1}`,
      photo,
      layout: typeof slide.layoutVariant === 'string' ? slide.layoutVariant : null,
      headline: spanText(slide.headline),
      body: spanText(slide.body),
    };
  });
}

function shell(row: CarouselPostRow, all: readonly CarouselPostRow[], ctx: Context, currentVersion: string | null) {
  return {
    vertical: 'carousels' as const,
    format: 'feed' as const,
    name: row.title,
    description: firstLine(row.caption),
    slot: ctx.slot ? { id: ctx.slot, label: SLOT_LABEL[ctx.slot] ?? ctx.slot } : null,
    pipelineHref: '/carousels',
    media: { kind: 'slides' as const, slides: slideOutline(row) },
    costMicros: null,
    costNote: null,
    native: nativeFields(row, ctx),
    factorValues: factorValues(row, ctx),
    approval: { required: ctx.requireApproval, approvedAt: ctx.approvedAt, note: ctx.approvedAt ? 'Approved' : null },
    idea: row.story_id ? { id: row.story_id, label: row.title } : null,
    generatedAt: iso(row.created_at),
    versions: versionsFor(row, all, currentVersion),
    sources: sourcesOf(row),
    costItemKey: row.story_id ? `carousels:story:${row.story_id}` : null,
    reviewNotes: checkLines(row),
  };
}

export function carouselPosts(read: CarouselsRead): HubPost[] {
  const history = historyByMedia(read.insights);
  const postById = new Map(read.posts.map((p) => [p.post_id, p]));
  const posts: HubPost[] = [];

  for (const row of read.attempts) {
    const post = postById.get(row.post_id);
    if (!post) continue;
    const status = attemptStatus(row.status);
    const snapshots: MetricSnapshot[] = row.media_id ? history.get(row.media_id) ?? [] : [];
    const finished = iso(row.finished_at);
    // Approve and Force are a person's click (SH-17); an auto slot carries approved_at.
    const approvedAt = row.trigger === 'force' ? iso(row.requested_at) : iso(row.approved_at) ?? (row.trigger === 'approve' ? iso(row.requested_at) : null);
    posts.push({
      ...shell(post, read.posts, { slot: row.slot, approvedAt, requireApproval: read.requireApproval && row.trigger === 'auto' }, post.post_id),
      id: hubId('carousels', 'attempt', row.attempt_id),
      status,
      statusNote: status === 'failed' ? text(row.error) : null,
      postedAt: status === 'published' ? finished : null,
      publishAt: iso(row.publish_at),
      nyDate: nyDateFor(status === 'published' ? finished : null, row.publish_at, row.requested_at),
      permalink: row.permalink,
      metrics: latest(snapshots),
      history: snapshots,
      refs: { attemptId: row.attempt_id, postId: row.post_id, ...(row.schedule_id ? { scheduleId: row.schedule_id } : {}) },
    });
  }
  for (const row of read.schedules) {
    const post = postById.get(row.post_id);
    if (!post) continue;
    const status: HubStatus = scheduleStatus(row.status);
    posts.push({
      ...shell(post, read.posts, { slot: row.slot, approvedAt: iso(row.approved_at), requireApproval: read.requireApproval && row.source === 'auto' }, post.post_id),
      id: hubId('carousels', 'schedule', row.schedule_id),
      status,
      statusNote: status === 'cancelled' ? cancelNote(row.error) : status === 'failed' ? text(row.error) : null,
      postedAt: null,
      publishAt: iso(row.publish_at),
      nyDate: row.ny_date.slice(0, 10),
      permalink: null,
      metrics: {},
      history: [],
      refs: { scheduleId: row.schedule_id, postId: row.post_id },
    });
  }
  // Content ready (spec §9a): the newest `review` post per story. The lifecycle view keeps it
  // only when nothing live holds that post (lib/social-hub/lifecycle.ts).
  const newest = new Map<string, CarouselPostRow>();
  for (const row of read.posts) {
    if (row.status !== 'review') continue;
    const key = row.story_id ?? row.post_id;
    const seen = newest.get(key);
    if (!seen || Date.parse(row.created_at) > Date.parse(seen.created_at)) newest.set(key, row);
  }
  for (const row of newest.values()) {
    posts.push({
      ...shell(row, read.posts, { slot: null, approvedAt: null, requireApproval: read.requireApproval }, row.post_id),
      id: hubId('carousels', 'post', row.post_id),
      status: 'ready',
      statusNote: 'In review, not scheduled',
      postedAt: null,
      publishAt: null,
      nyDate: null,
      permalink: null,
      metrics: {},
      history: [],
      refs: { postId: row.post_id },
    });
  }
  return foldLifecycle('carousels', posts);
}

export function carouselIdeas(rows: readonly CarouselIdeaRow[]): HubIdea[] {
  return rows
    .filter((row) => row.story_id)
    .map((row) => ({
      id: `carousels:story:${row.story_id}`,
      vertical: 'carousels' as const,
      title: text(row.title) ?? row.story_id,
      score: num(row.score),
      scoreLabel: 'Judge score (0–3)',
      state: row.published ? 'published' : row.scheduled ? 'on_deck' : row.post_count > 0 ? 'content_ready' : 'idea_only',
      hasContent: row.post_count > 0,
      versionCount: row.post_count,
      generatedAt: iso(row.last_post_at),
      createdAt: iso(row.run_started_at),
      detail: row.outlet_count != null ? `${row.outlet_count} outlet${row.outlet_count === 1 ? '' : 's'}` : null,
    }));
}
