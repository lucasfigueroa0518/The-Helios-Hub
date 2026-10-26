import { hookByKey } from '@/lib/ai-events/hooks';
import { isLook, LOOK_NAMES } from '@/lib/ai-events/looks';
import { cleanEventTitle, cleanName } from '@/lib/ai-events/title';
import { AI_EVENTS_CITIES, AI_EVENTS_METROS, type AiEventsMetro } from '@/lib/ai-events/types';
import { GATES, SCORE_FORMULA, SCORE_MAX } from '@/lib/networking/pick/score';
import { attemptStatus, cancelNote, historyByMedia, iso, latest, nyDateFor, scheduleStatus, slotCategory, slotText, text } from '@/lib/social-hub/adapters/common';
import { hubId } from '@/lib/social-hub/ids';
import { foldLifecycle } from '@/lib/social-hub/lifecycle';
import type { AiEventsPoolRow, AiEventsPostRow, AiEventsRead } from '@/lib/social-hub/queries/ai-events';
import type { FactorValue, HubIdea, HubPost, HubStatus, MetricSnapshot, NativeField, SourceRef } from '@/lib/social-hub/types';

/**
 * AI Events This Week posts and ideas for the hub (plan M4). A post is one
 * ai_events.posts row through its life (ready → scheduled → posting →
 * published), under the id `ai_events:<post id>`; a rebuild re-renders the
 * same row, so the id never changes. The ideas are the week's ranked event
 * pool, one per event, grouped by city (`group`): picks are content ready,
 * events a gate or a person excluded are retired with the reason, the rest
 * wait as ideas. Each idea carries its event-pick@1 parts (networking.event_scores).
 */

const SLOT_LABEL: Record<string, string> = { evening: 'Evening · 6:00–7:00 PM' };

/** The city tab names, in post order (AE-02): Miami, Boston, NYC, SF. */
export const AI_EVENTS_CITY_TABS: readonly string[] = AI_EVENTS_METROS.map((m) => AI_EVENTS_CITIES[m].short);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 26–Nov 1", or "Nov 2–8" inside one month. */
export function weekLabel(startDate: string, endDate: string): string {
  const [, am, ad] = startDate.slice(0, 10).split('-').map(Number);
  const [, bm, bd] = endDate.slice(0, 10).split('-').map(Number);
  return am === bm ? `${MONTHS[am! - 1]} ${ad}–${bd}` : `${MONTHS[am! - 1]} ${ad}–${MONTHS[bm! - 1]} ${bd}`;
}

const shiftDay = (date: string, days: number) => {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The week a post covers: the Monday after its Sunday (ny_date) through the Sunday after that. */
const postWeek = (row: Pick<AiEventsPostRow, 'ny_date'>) => weekLabel(shiftDay(row.ny_date, 1), shiftDay(row.ny_date, 7));

const day = (row: Pick<AiEventsPostRow, 'ny_date'>) => row.ny_date.slice(0, 10);

/** "AI Events This Week · Oct 26–Nov 1" */
export function aiEventsTitle(row: Pick<AiEventsPostRow, 'ny_date'>): string {
  return `AI Events This Week · ${postWeek(row)}`;
}

type CityJson = { metro?: string; picks?: Array<{ id?: string; title?: string; rsvpUrl?: string; organizer?: string | null }> };
type Context = { slot: string | null; approvedAt: string | null; requireApproval: boolean };
type RenderSlide = { layoutVariant?: unknown; altText?: unknown; aiEvents?: { role?: unknown; city?: unknown; lead?: unknown; lit?: unknown; pick?: unknown; mentions?: unknown } };

const citiesOf = (row: AiEventsPostRow): CityJson[] => (Array.isArray(row.cities) ? (row.cities as CityJson[]) : []);
const isMetro = (m: unknown): m is AiEventsMetro => typeof m === 'string' && (AI_EVENTS_METROS as readonly string[]).includes(m);
const listOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);
const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

/** The cities with picks, in post order, by their short names. */
export function postCityNames(row: AiEventsPostRow): string[] {
  const withPicks = new Set(citiesOf(row).filter((c) => isMetro(c.metro) && (c.picks?.length ?? 0) > 0).map((c) => c.metro));
  return AI_EVENTS_METROS.filter((m) => withPicks.has(m)).map((m) => AI_EVENTS_CITIES[m].short);
}

/** What the review screen flags: text taller than the template allows, broken slides. */
export function aiEventsReviewNotes(row: AiEventsPostRow): string[] {
  return [...listOf(row.fit_problems).map((p) => `Text fit: ${p}`), ...listOf(row.render_problems).map((p) => `Render: ${p}`)];
}

/** Each picked event's RSVP page, once, as "City: Title". */
export function aiEventsSources(row: AiEventsPostRow): SourceRef[] {
  const seen = new Set<string>();
  return citiesOf(row).flatMap((c) =>
    (c.picks ?? []).flatMap((p) => {
      if (!p.rsvpUrl || !/^https:\/\//.test(p.rsvpUrl) || seen.has(p.rsvpUrl)) return [];
      seen.add(p.rsvpUrl);
      const city = isMetro(c.metro) ? AI_EVENTS_CITIES[c.metro].short : null;
      return [{ url: p.rsvpUrl, title: [city, p.title ? cleanEventTitle(p.title) : null].filter(Boolean).join(': ') || null }];
    }),
  );
}

/** The slides: rendered JPEGs through /api/ai-events/slides once stored, else the outline from `render`. */
export function aiEventsSlides(row: AiEventsPostRow): Array<{ src: string | null; alt: string; photo: string | null; layout: string | null; headline: string | null; body: string | null }> {
  const slides = Array.isArray(row.render?.slides) ? (row.render!.slides as RenderSlide[]) : [];
  const count = Math.max(slides.length, row.slide_count ?? 0);
  return Array.from({ length: count }, (_, i) => {
    const slide = slides[i] ?? {};
    const ae = slide.aiEvents ?? {};
    const role = str(ae.role);
    const headline = role === 'city' ? str(ae.city) : [str(ae.lead), str(ae.lit)].filter(Boolean).join(' ') || null;
    // A city slide's top pick, then its mentions (AE-24/25).
    const pick = ae.pick && typeof ae.pick === 'object' ? [(ae.pick as { title?: unknown }).title] : [];
    const mentions = Array.isArray(ae.mentions) ? (ae.mentions as Array<{ title?: unknown }>).map((m) => m.title) : [];
    const events = [...pick, ...mentions].map(str).filter(Boolean);
    return {
      // ?v= so a rebuild's new slides are never served from an older cached redirect.
      src: row.has_slide_objects ? `/api/ai-events/slides/${row.post_id}/${i}?v=${row.render_version}` : null,
      alt: str(slide.altText) ?? `${aiEventsTitle(row)}, slide ${i + 1}`,
      photo: null,
      layout: str(slide.layoutVariant),
      headline,
      body: events.length ? events.join(' · ') : null,
    };
  });
}

const lookName = (look: string) => (isLook(look) ? LOOK_NAMES[look] : look);

/** A ranked city post has fixed cover copy (AE-29), stored as the hook "ranked". */
const hookLabel = (hook: string) => hookByKey(hook)?.text ?? (hook === 'ranked' ? 'N AI Networking Events in {City} this week. Ranked.' : hook);

/** The history bar tiers (AE-28), as the hub shows them. */
export const BAR_TIER_LABELS: Record<string, string> = {
  top30: 'Top 30% of past scores',
  top40: 'Top 40% (loosened)',
  top50: 'Top 50% (loosened)',
  gates: 'Passed the gates (loosened)',
};

function nativeFields(row: AiEventsPostRow, ctx: Context): NativeField[] {
  const cities = postCityNames(row);
  return [
    { group: 'content', label: 'Week', value: postWeek(row) },
    { group: 'content', label: 'Cities', value: cities.length ? cities.join(', ') : '—' },
    { group: 'content', label: 'Events', value: String(row.event_count ?? 0) },
    { group: 'content', label: 'Hook', value: hookLabel(row.hook) },
    { group: 'content', label: 'Bar cleared', value: row.bar_tier ? BAR_TIER_LABELS[row.bar_tier] ?? row.bar_tier : '—' },
    { group: 'production', label: 'Look', value: lookName(row.look) },
    { group: 'production', label: 'Slides', value: row.slide_count == null ? '—' : String(row.slide_count) },
    { group: 'production', label: 'Render version', value: String(row.render_version ?? 1) },
    { group: 'production', label: 'Text fit problems', value: String(listOf(row.fit_problems).length) },
    { group: 'scheduling', label: 'Posting slot', value: ctx.slot ? slotText(ctx.slot, SLOT_LABEL) : '—' },
    { group: 'scheduling', label: 'Approval', value: ctx.approvedAt ? 'Approved' : ctx.requireApproval ? 'Needs approval' : 'Not required' },
    { group: 'scheduling', label: 'Slug', value: row.slug },
  ];
}

function factorValues(row: AiEventsPostRow, ctx: Context): Record<string, FactorValue> {
  const cities = postCityNames(row);
  return {
    cities: { kind: 'tags', values: cities.map((c) => ({ key: c.toLowerCase(), label: c })), empty: 'No cities' },
    events: { kind: 'number', value: row.event_count ?? null },
    look: { kind: 'category', key: row.look, label: lookName(row.look) },
    hook: { kind: 'category', key: row.hook, label: hookLabel(row.hook) },
    slot: slotCategory(ctx.slot, SLOT_LABEL),
    approval: ctx.approvedAt ? { kind: 'category', key: 'approved', label: 'Approved' } : { kind: 'category', key: 'not_approved', label: 'Not approved' },
  };
}

function shell(row: AiEventsPostRow, ctx: Context) {
  return {
    vertical: 'ai_events' as const,
    format: 'feed' as const,
    name: aiEventsTitle(row),
    description: text(row.caption),
    slot: ctx.slot ? { id: ctx.slot, label: slotText(ctx.slot, SLOT_LABEL) } : null,
    pipelineHref: '/ai-events',
    media: { kind: 'slides' as const, slides: aiEventsSlides(row) },
    costMicros: null,
    costNote: null,
    native: nativeFields(row, ctx),
    factorValues: factorValues(row, ctx),
    approval: { required: ctx.requireApproval, approvedAt: ctx.approvedAt, note: ctx.approvedAt ? 'Approved' : null },
    // Not stored (idea_ref is NULL): the post's own Sunday, so "today's post" can be found.
    idea: { id: `ai_events:${day(row)}`, label: `AI Events for ${postWeek(row)}` },
    generatedAt: iso(row.updated_at ?? row.created_at),
    versions: [],
    sources: aiEventsSources(row),
    costItemKey: `ai_events:${row.post_id}`,
    reviewNotes: aiEventsReviewNotes(row),
  };
}

export function aiEventsPosts(read: AiEventsRead): HubPost[] {
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
      id: hubId('ai_events', 'attempt', row.attempt_id),
      status,
      statusNote: status === 'failed' ? text(row.error) : null,
      postedAt: status === 'published' ? finished : null,
      publishAt: iso(row.publish_at),
      nyDate: nyDateFor(status === 'published' ? finished : null, row.publish_at, row.requested_at),
      permalink: row.permalink,
      metrics: latest(snapshots),
      history: snapshots,
      refs: { attemptId: row.attempt_id, aiEventsPostId: row.post_id, ...(row.schedule_id ? { scheduleId: row.schedule_id } : {}) },
    });
  }
  for (const row of read.schedules) {
    const post = byId.get(row.post_id);
    if (!post) continue;
    const status: HubStatus = scheduleStatus(row.status);
    posts.push({
      ...shell(post, { slot: row.slot, approvedAt: iso(row.approved_at), requireApproval: read.requireApproval && row.source === 'auto' }),
      id: hubId('ai_events', 'schedule', row.schedule_id),
      status,
      statusNote: status === 'cancelled' ? cancelNote(row.error) : status === 'failed' ? text(row.error) : null,
      postedAt: null,
      publishAt: iso(row.publish_at),
      nyDate: row.ny_date.slice(0, 10),
      permalink: null,
      metrics: {},
      history: [],
      refs: { scheduleId: row.schedule_id, aiEventsPostId: row.post_id },
    });
  }
  // Content ready: every post still in review. The lifecycle view keeps it only when nothing live holds it.
  for (const row of read.posts) {
    if (row.status !== 'review') continue;
    posts.push({
      ...shell(row, { slot: null, approvedAt: null, requireApproval: read.requireApproval }),
      id: hubId('ai_events', 'post', row.post_id),
      status: 'ready',
      statusNote: 'In review, not scheduled',
      postedAt: null,
      publishAt: null,
      nyDate: null,
      permalink: null,
      metrics: {},
      history: [],
      refs: { aiEventsPostId: row.post_id },
    });
  }
  return foldLifecycle('ai_events', posts);
}

// ── The weekly pool ─────────────────────────────────────────────────────────

/** "Tue, Oct 27 · 6:30 PM" in the event's own zone (the metro's when the listing has none). */
export function eventWhenLabel(row: Pick<AiEventsPoolRow, 'start_at' | 'timezone' | 'metro'>): string {
  const timeZone = row.timezone || (isMetro(row.metro) ? AI_EVENTS_CITIES[row.metro].timezone : 'America/New_York');
  const at = new Date(row.start_at);
  if (Number.isNaN(at.getTime())) return '';
  try {
    const date = at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone });
    const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
    return `${date} · ${time}`;
  } catch {
    return at.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** The failed gates of a stored reason ("vendor_pitch, get_rich"), by their labels. */
export function gateLabels(gate: string | null | undefined): string[] {
  if (!gate) return [];
  return gate.split(',').map((id) => id.trim()).filter(Boolean).map((id) => GATES[id as keyof typeof GATES]?.label ?? id);
}

/** The idea's state and the one line that explains it (picked, gated, excluded, out of the candidates). */
function poolState(row: AiEventsPoolRow): { state: HubIdea['state']; why: string | null } {
  if (row.excluded_at) return { state: 'retired', why: `Excluded${row.excluded_by ? ` by ${row.excluded_by}` : ''}` };
  const partner = row.partner ? `Partner: ${row.partner}` : null;
  // A pin shows in the row's chip (In the post · pinned), so the line doesn't repeat it.
  if (row.picked) {
    const where = row.pick_rank === 1 ? 'Ranked #1 (held for the site)' : `Ranked #${row.pick_rank ?? '?'} in the post`;
    return { state: 'content_ready', why: [where, partner].filter(Boolean).join(' · ') };
  }
  if (row.gate && !row.partner) return { state: 'retired', why: `Gated out: ${gateLabels(row.gate).join(', ')}` };
  if (row.pinned_at) return { state: 'idea_only', why: `Pinned${row.pinned_by ? ` by ${row.pinned_by}` : ''}; goes in on the next build or Rebuild post` };
  if (row.rank == null) return { state: 'retired', why: row.status === 'cancelled' ? 'Cancelled by its host' : 'No longer one of the week’s candidates' };
  return { state: 'idea_only', why: null };
}

/**
 * The week's pool as ideas, one per event (AE-04). `group` is the city tab;
 * the score is event-pick@1 (0 to SCORE_MAX), and the breakdown its stored
 * parts. `hold` is a person's pin or exclude, which the Pin / Exclude /
 * Clear buttons read.
 */
export function aiEventsIdeas(read: Pick<AiEventsRead, 'pool' | 'week'>): HubIdea[] {
  const scoreLabel = `Event score (of ${SCORE_MAX.toFixed(1)})`;
  return read.pool.map((row) => {
    const { state, why } = poolState(row);
    const city = isMetro(row.metro) ? AI_EVENTS_CITIES[row.metro].short : row.metro;
    const host = cleanName(row.organizer_name || row.host_name);
    const venue = cleanName(row.venue_name).split(',')[0]?.trim() || null;
    const going = row.guest_count != null ? `${row.guest_count} going` : null;
    const parts = Array.isArray(row.parts) ? row.parts : null;
    const gated = gateLabels(row.gate);
    return {
      id: `ai_events:event:${row.event_id}`,
      vertical: 'ai_events',
      title: cleanEventTitle(row.title) || row.title,
      score: row.score == null ? null : Number(row.score),
      scoreLabel,
      breakdown: parts
        ? { formula: SCORE_FORMULA, parts, note: gated.length ? `Excluded by gate: ${gated.join(', ')}.` : row.rank != null ? `#${row.rank} in ${city} this week.` : null }
        : null,
      state,
      hasContent: state === 'content_ready',
      versionCount: state === 'content_ready' ? 1 : 0,
      generatedAt: state === 'content_ready' ? iso(row.updated_at) : null,
      // The pool row's last write: the run that ranked it (the pool's refill time).
      createdAt: iso(row.updated_at),
      detail: [eventWhenLabel(row), host || null, venue, going, why].filter(Boolean).join(' · '),
      group: city,
      hold: row.excluded_at ? 'excluded' : row.pinned_at ? 'pinned' : null,
      link: row.canonical_url && /^https:\/\//.test(row.canonical_url) ? row.canonical_url : null,
    };
  });
}
