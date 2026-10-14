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
import type { ContentVersion, FactorValue, HubIdea, HubPost, HubStatus, MetricSnapshot, NativeField, ScoreBreakdown, ScorePart, SourceRef } from '@/lib/social-hub/types';
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
  const plain = (t: unknown) => String(t ?? '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  // A fact-check fix is { id, where, before, after }. Show where and what it became; a straight-to-curly quote swap is not worth a line.
  const fixLine = (f: unknown): string | null => {
    if (f && typeof f === 'object' && 'after' in f) {
      const o = f as { where?: unknown; before?: unknown; after?: unknown };
      if (plain(o.before) === plain(o.after)) return null;
      return `Fixed${o.where ? ` (${String(o.where)})` : ''}: ${String(o.after).slice(0, 200)}`;
    }
    return `Fixed: ${say(f)}`;
  };
  return [
    ...(c.warnings ?? []).map((w) => `Warning: ${say(w)}`),
    ...(c.fixes ?? []).flatMap((f) => fixLine(f) ?? []),
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

const GATE_QUESTIONS: Array<[string, string]> = [['ai_main_subject', 'AI is the main subject'], ['substance', 'Enough for 5–8 slides'], ['news_event', 'A specific new event']];

/**
 * story-scoring@3 and @2 constants, copied (not imported: the question modules
 * pull in the Jev SDK, and hub read code reaches no network module).
 */
const V3 = {
  questions: [['big_news', 'Big news'], ['surprise', 'Surprising'], ['everyday_stakes', 'Stakes for everyday people'], ['tension_people', 'A real fight (conflict, firing, lawsuit)'], ['sourcing', 'Primary or multi-outlet source']] as Array<[string, string]>,
  coverageFullAt: 16,
  coverageWeight: 0.5,
  max: 5.5,
};
const V2_QUESTIONS: Array<[string, string]> = [['why_it_matters', 'Why it matters is clear'], ['sourcing', 'Primary or multi-outlet source'], ['photographable_subject', 'Named person, company or product']];
const SCORING_BARS = { REQUIRED_MIN: 0.6, BONUS_MIN: 0.5 } as const;

/**
 * story-scoring@4 constants, copied for the same reason (lib/social/jev/questions/story-scoring.v4.ts).
 * tests/idea-score-breakdown.test.ts checks this copy against the module, so the two cannot drift.
 */
export const V4 = {
  impact: [['field_shift', 'Changes what AI can do, what it costs, or who leads'], ['industry_power', 'Money or power among the companies that build AI'], ['national_policy', 'A government act on AI']] as Array<[string, string]>,
  weights: { impact: 2, policy: 1.3, mustKnow: 1, commonPerson: 1, sourcing: 1, coverage: 0.5 },
  coverageFullAt: 16,
  max: 5.5,
  REQUIRED_MIN: 0.6,
  EVENT_MIN: 0.5,
  COMMENTARY_MIN: 0.5,
  BONUS_MIN: 0.5,
};

const isV4 = (answers: Record<string, number>) => answers.field_shift != null;
const isV3 = (answers: Record<string, number>) => answers.big_news != null;

const yn = (v: number | undefined, bar: number) => (v == null ? 'Not asked' : v >= bar ? 'yes' : 'no');

/** The strongest impact axis and its weighted points: a launch or a deal can earn 2, a government act at most 1.3. */
export function v4Impact(a: Record<string, number>): { id: string; label: string; points: number } {
  const w = V4.weights;
  const axes = V4.impact.map(([id, label]) => ({ id, label, points: (a[id] ?? 0) * (id === 'national_policy' ? w.policy : w.impact) }));
  return axes.reduce((best, x) => (x.points > best.points ? x : best));
}

/** The run's score for an idea: story-scoring@4 (0–5.5), @3 (engagement, 0–5.5) or, for the oldest runs, @2 (0–3). */
export function carouselBreakdown(row: CarouselIdeaRow): ScoreBreakdown | null {
  const a = row.answers;
  if (!a) return null;
  const t = SCORING_BARS;
  const outlets = row.outlet_count ?? 0;
  const gates = GATE_QUESTIONS.map(([id, label]) => ({ label: `Gate: ${label}`, points: null, detail: a[id] == null ? 'Not asked' : `${a[id]!.toFixed(2)} (needs ${t.REQUIRED_MIN.toFixed(2)})` }));
  if (isV4(a)) {
    const w = V4.weights;
    const coverage = Math.min(1, Math.log2(1 + outlets) / Math.log2(1 + V4.coverageFullAt)) * w.coverage;
    const impact = v4Impact(a);
    const gate = (id: string, label: string, bar: number, kind: 'min' | 'max') => ({
      label: `Gate: ${label}`,
      points: null,
      detail: a[id] == null ? 'Not asked' : kind === 'min' ? `${a[id]!.toFixed(2)} (needs ${bar.toFixed(2)})` : `${a[id]!.toFixed(2)} (must stay under ${bar.toFixed(2)})`,
    });
    return {
      formula: 'The strongest of three impact answers (a launch or deal up to 2, a government act up to 1.3), plus must-know (up to 1), a regular person would care (up to 1), sourcing (up to 1), and up to 0.5 for how many outlets report it.',
      parts: [
        { label: `Impact: ${impact.label}`, points: Number(impact.points.toFixed(2)), detail: V4.impact.map(([id]) => `${id.replace('_', ' ')} ${(a[id] ?? 0).toFixed(2)}`).join(' · ') },
        { label: 'Someone who follows AI would feel behind', points: a.must_know == null ? null : Number((a.must_know * w.mustKnow).toFixed(2)), detail: yn(a.must_know, V4.BONUS_MIN) },
        { label: 'A regular person curious about AI would care', points: a.common_person == null ? null : Number((a.common_person * w.commonPerson).toFixed(2)), detail: yn(a.common_person, V4.BONUS_MIN) },
        { label: 'Primary or multi-outlet source', points: a.sourcing == null ? null : Number((a.sourcing * w.sourcing).toFixed(2)), detail: yn(a.sourcing, V4.BONUS_MIN) },
        { label: `Coverage (${outlets} outlet${outlets === 1 ? '' : 's'})`, points: Number(coverage.toFixed(2)), detail: `full ${w.coverage} at ${V4.coverageFullAt}+ outlets` },
        gate('ai_main_subject', 'AI is the main subject', V4.REQUIRED_MIN, 'min'),
        gate('substance', 'Enough for 5–8 slides', V4.REQUIRED_MIN, 'min'),
        gate('news_event', 'Something happened (a report, not an explainer or review)', V4.EVENT_MIN, 'min'),
        gate('commentary', 'Not mainly opinion, an interview or remarks', V4.COMMENTARY_MIN, 'max'),
      ],
      note: `The 3:00 AM run ranks by this score (out of ${V4.max}), keeps at most two stories per company in the top 10, and folds duplicate stories together.`,
    };
  }
  if (isV3(a)) {
    const coverage = Math.min(1, Math.log2(1 + outlets) / Math.log2(1 + V3.coverageFullAt)) * V3.coverageWeight;
    return {
      formula: 'Four engagement answers plus sourcing (yes-probabilities, 0 to 1 each), plus up to 0.5 for how many outlets report it.',
      parts: [
        ...V3.questions.map(([id, label]) => ({ label, points: a[id] == null ? null : Number(a[id]!.toFixed(2)), detail: a[id] == null ? 'Not asked' : a[id]! >= t.BONUS_MIN ? 'yes' : 'no' })),
        { label: `Coverage (${outlets} outlet${outlets === 1 ? '' : 's'})`, points: Number(coverage.toFixed(2)), detail: `full ${V3.coverageWeight} at ${V3.coverageFullAt}+ outlets` },
        ...gates,
      ],
      note: `The 3:00 AM run ranks by this score (out of ${V3.max}), keeps at most two stories per company in the top 10, and folds duplicate stories together.`,
    };
  }
  return {
    formula: 'Sum of three judge answers (yes-probabilities, 0 to 1 each). An older run (story-scoring@2).',
    parts: [
      ...V2_QUESTIONS.map(([id, label]) => ({ label, points: a[id] == null ? null : Number(a[id]!.toFixed(2)), detail: a[id] == null ? 'Not asked' : a[id]! >= t.BONUS_MIN ? 'passes' : `below ${t.BONUS_MIN.toFixed(2)}` })),
      // @2 had no news-event gate.
      ...gates.filter((g) => !g.label.endsWith('A specific new event')),
    ],
    note: `That run ranked by questions passed (${row.passes ?? 0} of 3), then outlets (${outlets}), and used this sum only to break ties.`,
  };
}

export function carouselIdeas(rows: readonly CarouselIdeaRow[]): HubIdea[] {
  return rows
    .filter((row) => row.story_id)
    .map((row) => ({
      id: `carousels:story:${row.story_id}`,
      vertical: 'carousels' as const,
      title: text(row.title) ?? row.story_id,
      score: num(row.score),
      scoreLabel: row.answers && isV4(row.answers) ? 'Score (0–5.5)' : row.answers && isV3(row.answers) ? 'Engagement score (0–5.5)' : 'Judge score (0–3)',
      breakdown: carouselBreakdown(row),
      state: row.published ? 'published' : row.scheduled ? 'on_deck' : row.post_count > 0 ? 'content_ready' : 'idea_only',
      hasContent: row.post_count > 0,
      versionCount: row.post_count,
      generatedAt: iso(row.last_post_at),
      createdAt: iso(row.run_started_at),
      detail: row.outlet_count != null ? `${row.outlet_count} outlet${row.outlet_count === 1 ? '' : 's'}` : null,
    }));
}
