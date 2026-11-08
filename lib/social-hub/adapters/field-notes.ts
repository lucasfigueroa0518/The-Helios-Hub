import { attemptStatus, cancelNote, historyByMedia, iso, latest, nyDateFor, scheduleStatus, slotCategory, slotText, text } from '@/lib/social-hub/adapters/common';
import { LEAF_LABEL } from '@/components/field-notes/constants';
import { PLACEHOLDER_USE } from '@/lib/field-notes/types';
import { hubId } from '@/lib/social-hub/ids';
import { foldLifecycle } from '@/lib/social-hub/lifecycle';
import type { FieldNotesPostRow, FieldNotesRead, FieldNotesTipRow } from '@/lib/social-hub/queries/field-notes';
import type { FactorValue, HubIdea, HubPost, HubStatus, IdeaState, MetricSnapshot, NativeField, SourceRef } from '@/lib/social-hub/types';

/**
 * Field Notes posts and ideas for the hub. A post is one field_notes.posts row through its life
 * (ready → scheduled → posting → published), under the id `field_notes:<post id>`; a rebuild
 * re-renders the same row, so the id never changes. The ideas are the tips (field_notes.tips),
 * one per tip: a tip that made a post is content ready, one still waiting is an idea, expired
 * and rejected tips are retired.
 */

const SLOT_LABEL: Record<string, string> = { afternoon: 'Afternoon · 2:30–3:30 PM' };

/** The tip's kind: its content leaf (2026-11-06 tree), or the old branch for rows saved before the leaves existed. */
export const BRANCH_LABEL: Record<string, string> = {
  open_source_skill: 'Open source skill',
  open_source_repo: 'Open source repo',
  paid_tool_feature: 'Paid tool feature',
  ...LEAF_LABEL,
};

type Context = { slot: string | null; approvedAt: string | null; requireApproval: boolean };
type RenderSlide = { kind?: unknown; headline?: unknown; body?: unknown };

const listOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);
const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

/** "Field Notes · Claude Code skills" (the tip's subject), else the post's day. */
export function fieldNotesTitle(row: Pick<FieldNotesPostRow, 'subject' | 'ny_date'>): string {
  if (row.subject?.trim()) return `Field Notes · ${row.subject.trim()}`;
  const date = new Date(`${row.ny_date.slice(0, 10)}T12:00:00Z`);
  return `Field Notes · ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

/** What the review screen flags: text that does not fit, broken slides. */
export function fieldNotesReviewNotes(row: FieldNotesPostRow): string[] {
  return [...listOf(row.fit_problems).map((p) => `Text fit: ${p}`), ...listOf(row.render_problems).map((p) => `Render: ${p}`)];
}

/** Every tip's source page, once each, in slide order (one tip a slide). */
export function fieldNotesSources(row: FieldNotesPostRow): SourceRef[] {
  const tips = Array.isArray(row.tips) && row.tips.length ? row.tips : [{ tip_id: row.tip_id ?? '', subject: row.subject, source_url: row.source_url, source_label: row.source_label }];
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const t of tips) {
    if (!t.source_url || !/^https:\/\//.test(t.source_url) || seen.has(t.source_url)) continue;
    seen.add(t.source_url);
    out.push({ url: t.source_url, title: t.source_label ?? t.subject ?? null });
  }
  return out;
}

/** The slides: rendered JPEGs through /api/field-notes/slides once stored, else the outline from the slide text. */
export function fieldNotesSlides(row: FieldNotesPostRow): Array<{ src: string | null; alt: string; photo: string | null; layout: string | null; headline: string | null; body: string | null }> {
  const slides = Array.isArray(row.render?.slides) ? (row.render!.slides as RenderSlide[]) : [];
  const count = Math.max(slides.length, row.slide_count ?? 0);
  return Array.from({ length: count }, (_, i) => {
    const slide = slides[i] ?? {};
    const headline = str(slide.headline);
    return {
      // ?v= so a rebuild's new slides are never served from an older cached redirect.
      src: row.has_slide_objects ? `/api/field-notes/slides/${row.post_id}/${i}?v=${row.render_version}` : null,
      alt: [headline, str(slide.body)].filter(Boolean).join('. ') || `${fieldNotesTitle(row)}, slide ${i + 1}`,
      photo: null,
      layout: str(slide.kind),
      headline,
      body: str(slide.body),
    };
  });
}

function nativeFields(row: FieldNotesPostRow, ctx: Context): NativeField[] {
  return [
    { group: 'content', label: 'Tip', value: row.subject ?? '—' },
    { group: 'content', label: 'Kind of tip', value: row.branch ? BRANCH_LABEL[row.branch] ?? row.branch : '—' },
    { group: 'production', label: 'Slides', value: row.slide_count == null ? '—' : String(row.slide_count) },
    { group: 'production', label: 'Render version', value: String(row.render_version ?? 1) },
    { group: 'production', label: 'Text fit problems', value: String(listOf(row.fit_problems).length) },
    { group: 'scheduling', label: 'Posting slot', value: ctx.slot ? slotText(ctx.slot, SLOT_LABEL) : '—' },
    { group: 'scheduling', label: 'Approval', value: ctx.approvedAt ? 'Approved' : ctx.requireApproval ? 'Needs approval' : 'Not required' },
    { group: 'scheduling', label: 'Slug', value: row.slug },
  ];
}

function factorValues(row: FieldNotesPostRow, ctx: Context): Record<string, FactorValue> {
  return {
    branch: row.branch ? { kind: 'category', key: row.branch, label: BRANCH_LABEL[row.branch] ?? row.branch } : { kind: 'category', key: 'unknown', label: 'Unknown' },
    slides: { kind: 'number', value: row.slide_count ?? null },
    slot: slotCategory(ctx.slot, SLOT_LABEL),
    approval: ctx.approvedAt ? { kind: 'category', key: 'approved', label: 'Approved' } : { kind: 'category', key: 'not_approved', label: 'Not approved' },
  };
}

function shell(row: FieldNotesPostRow, ctx: Context) {
  return {
    vertical: 'field_notes' as const,
    format: 'feed' as const,
    name: fieldNotesTitle(row),
    description: text(row.caption),
    slot: ctx.slot ? { id: ctx.slot, label: slotText(ctx.slot, SLOT_LABEL) } : null,
    pipelineHref: '/field-notes',
    media: { kind: 'slides' as const, slides: fieldNotesSlides(row) },
    costMicros: null,
    costNote: null,
    native: nativeFields(row, ctx),
    factorValues: factorValues(row, ctx),
    approval: { required: ctx.requireApproval, approvedAt: ctx.approvedAt, note: ctx.approvedAt ? 'Approved' : null },
    // The tip behind the post, so "today's post" and the pool can find each other.
    idea: row.tip_id ? { id: `field_notes:tip:${row.tip_id}`, label: row.subject ?? 'Field Notes tip' } : { id: `field_notes:${row.ny_date.slice(0, 10)}`, label: `Field Notes for ${row.ny_date.slice(0, 10)}` },
    generatedAt: iso(row.updated_at ?? row.created_at),
    versions: [],
    sources: fieldNotesSources(row),
    costItemKey: `field_notes:${row.post_id}`,
    reviewNotes: fieldNotesReviewNotes(row),
  };
}

export function fieldNotesPosts(read: FieldNotesRead): HubPost[] {
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
      id: hubId('field_notes', 'attempt', row.attempt_id),
      status,
      statusNote: status === 'failed' ? text(row.error) : null,
      postedAt: status === 'published' ? finished : null,
      publishAt: iso(row.publish_at),
      nyDate: nyDateFor(status === 'published' ? finished : null, row.publish_at, row.requested_at),
      permalink: row.permalink,
      metrics: latest(snapshots),
      history: snapshots,
      refs: { attemptId: row.attempt_id, fieldNotesPostId: row.post_id, ...(row.schedule_id ? { scheduleId: row.schedule_id } : {}) },
    });
  }
  for (const row of read.schedules) {
    const post = byId.get(row.post_id);
    if (!post) continue;
    const status: HubStatus = scheduleStatus(row.status);
    posts.push({
      ...shell(post, { slot: row.slot, approvedAt: iso(row.approved_at), requireApproval: read.requireApproval && row.source === 'auto' }),
      id: hubId('field_notes', 'schedule', row.schedule_id),
      status,
      statusNote: status === 'cancelled' ? cancelNote(row.error) : status === 'failed' ? text(row.error) : null,
      postedAt: null,
      publishAt: iso(row.publish_at),
      nyDate: row.ny_date.slice(0, 10),
      permalink: null,
      metrics: {},
      history: [],
      refs: { scheduleId: row.schedule_id, fieldNotesPostId: row.post_id },
    });
  }
  // Content ready: every post still in review. The lifecycle view keeps it only when nothing live holds it.
  for (const row of read.posts) {
    if (row.status !== 'review') continue;
    posts.push({
      ...shell(row, { slot: null, approvedAt: null, requireApproval: read.requireApproval }),
      id: hubId('field_notes', 'post', row.post_id),
      status: 'ready',
      statusNote: 'In review, not scheduled',
      postedAt: null,
      publishAt: null,
      nyDate: null,
      permalink: null,
      metrics: {},
      history: [],
      refs: { fieldNotesPostId: row.post_id },
    });
  }
  return foldLifecycle('field_notes', posts);
}

// ── The tips ────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = { docs: 'Vendor docs', github: 'GitHub', hn: 'Hacker News', rss: 'RSS', seed: 'Seeded by a person' };

/** The idea's state and the line that explains it. */
function tipState(row: FieldNotesTipRow): { state: IdeaState; why: string | null } {
  switch (row.status) {
    case 'rejected':
      return { state: 'retired', why: 'Rejected' };
    case 'expired':
      return { state: 'retired', why: 'Expired unused' };
    case 'posted':
      return { state: 'published', why: 'Posted' };
    case 'approved':
      return { state: 'on_deck', why: 'Approved' };
    case 'drafted':
      return { state: 'content_ready', why: 'Post made, in review' };
    case 'selected':
      return { state: 'idea_only', why: 'Picked for the next post' };
    default:
      return { state: 'idea_only', why: null };
  }
}

/** The tips as ideas, one per tip. The score is the tip's own, when it has one. */
export function fieldNotesIdeas(read: Pick<FieldNotesRead, 'tips'>): HubIdea[] {
  return read.tips.map((row) => {
    const { state, why } = tipState(row);
    const made = state === 'content_ready' || state === 'on_deck' || state === 'published';
    return {
      id: `field_notes:tip:${row.tip_id}`,
      vertical: 'field_notes',
      title: row.subject,
      score: row.score == null ? null : Number(row.score),
      scoreLabel: 'Tip score',
      breakdown: null,
      state,
      hasContent: made && Boolean(row.post_id),
      versionCount: made && row.post_id ? 1 : 0,
      generatedAt: made ? iso(row.updated_at) : null,
      createdAt: iso(row.created_at),
      detail: [BRANCH_LABEL[row.branch] ?? row.branch, SOURCE_LABEL[row.source_kind] ?? row.source_kind, row.use_with_result === PLACEHOLDER_USE ? null : row.use_with_result, why].filter(Boolean).join(' · '),
      group: BRANCH_LABEL[row.branch] ?? row.branch,
      yours: row.source_kind === 'seed',
      link: row.source_url && /^https:\/\//.test(row.source_url) ? row.source_url : null,
    };
  });
}
