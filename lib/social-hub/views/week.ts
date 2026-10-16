import { addDays, nyDateOf, nyDayStart, weekdayOf } from '@/lib/social-hub/time';
import { resolveDay } from '@/lib/social-hub/slots/resolve';
import type { FeedMode, ResolvedSlot, TemplateRow } from '@/lib/social-hub/slots/types';
import type { HubPost, Vertical } from '@/lib/social-hub/types';
import { verticalInfo } from '@/lib/social-hub/verticals';
import { SERIES_LABEL } from '@/lib/stories/render/copy';
import { PLAN } from '@/lib/social-hub/views/plan';

/** The week grid (spec §3, layout A): rows are shared time windows, columns are days. Pure. */

export type WeekRow = { id: string; label: string; startMinute: number; windows: ReadonlyArray<{ vertical: Vertical; windowId: string }> };

const at = (v: Vertical, id: string) => PLAN[v].find((w) => w.id === id)!.startMinute;

export const ROWS: readonly WeekRow[] = [
  { id: 'stories', label: 'Stories', startMinute: at('stories', 'morning_download'), windows: [{ vertical: 'stories', windowId: 'morning_download' }, { vertical: 'stories', windowId: 'guess_the_number' }, { vertical: 'stories', windowId: 'free_vs_paid' }] },
  { id: 'reel-morning', label: 'Reel', startMinute: at('reels', 'morning'), windows: [{ vertical: 'reels', windowId: 'morning' }] },
  { id: 'feed-morning', label: 'Feed', startMinute: at('carousels', 'morning'), windows: [{ vertical: 'carousels', windowId: 'morning' }, { vertical: 'last_few_days', windowId: 'morning' }] },
  { id: 'reel-midday', label: 'Reel', startMinute: at('reels', 'midday'), windows: [{ vertical: 'reels', windowId: 'midday' }] },
  { id: 'explainer-afternoon', label: 'Explainer', startMinute: at('explainers', 'afternoon'), windows: [{ vertical: 'explainers', windowId: 'afternoon' }] },
  { id: 'feed-afternoon', label: 'Feed', startMinute: at('carousels', 'afternoon'), windows: [{ vertical: 'carousels', windowId: 'afternoon' }] },
  { id: 'explainer-late', label: 'Explainer', startMinute: at('explainers', 'late'), windows: [{ vertical: 'explainers', windowId: 'late' }] },
  { id: 'reel-evening', label: 'Reel', startMinute: at('reels', 'evening'), windows: [{ vertical: 'reels', windowId: 'evening' }] },
];

/** Stories run three series in one cell, so each chip names its series. */
const SERIES_SHORT: Record<keyof typeof SERIES_LABEL, string> = { morning_download: 'Morning Dl', guess_the_number: 'Guess #', free_vs_paid: 'Free/Paid' };

/** A chip's visible name and its full name (for the aria-label). */
export function chipNames(vertical: Vertical, windowId: string): { short: string; full: string } {
  if (vertical === 'stories' && windowId in SERIES_LABEL) {
    const id = windowId as keyof typeof SERIES_LABEL;
    return { short: SERIES_SHORT[id], full: SERIES_LABEL[id] };
  }
  const info = verticalInfo(vertical);
  return { short: info.short, full: info.label };
}

/** Each weekday's Carousel windows in the template ("Every <weekday>" edits change the template, not a date). */
export function carouselsByWeekday(template: readonly TemplateRow[]): Record<number, string[]> {
  const out: Record<number, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const r of template) if (r.vertical === 'carousels') out[r.weekday]!.push(r.windowId);
  for (const w of Object.values(out)) w.sort((a, b) => PLAN.carousels.findIndex((p) => p.id === a) - PLAN.carousels.findIndex((p) => p.id === b));
  return out;
}

export type WeekChip = { vertical: Vertical; windowId: string; feedMode: FeedMode | null; origin: 'template' | 'override'; booked: HubPost | null };

export type WeekCell = {
  nyDate: string | null;
  weekday: number;
  rowId: string;
  chips: WeekChip[];
  blockedReason: string | null;
  editable: boolean;
  addable: Array<{ vertical: Vertical; windowId: string }>;
};

export type WeekDayInput = { nyDate: string | null; weekday: number; slots: ResolvedSlot[] };

export type WeekModel = ReturnType<typeof weekModel>;

/** A post in one of these holds its slot (the same set the slot writer reports as booked). */
const HOLDS = new Set(['scheduled', 'publishing', 'published']);

export function mondayOf(nyDate: string): string {
  return addDays(nyDate, -((weekdayOf(nyDate) + 6) % 7));
}

/** The seven dates from `monday`, each resolved from a template alone (legacy view, preview). */
export function datedWeek(template: readonly TemplateRow[], monday: string): WeekDayInput[] {
  return Array.from({ length: 7 }, (_, i) => {
    const nyDate = addDays(monday, i);
    return { nyDate, weekday: weekdayOf(nyDate), slots: resolveDay(template, [], nyDate) };
  });
}

/** The template itself, Monday first, with no dates. */
export function templateWeek(template: readonly TemplateRow[], monday: string): WeekDayInput[] {
  return datedWeek(template, monday).map((d) => ({ ...d, nyDate: null }));
}

/** "Oct 19 – 25", or "Oct 26 – Nov 1" across a month end. */
export function weekLabel(monday: string): string {
  const fmt = (d: string, month: boolean) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { ...(month ? { month: 'short' as const } : {}), day: 'numeric', timeZone: 'UTC' });
  const sunday = addDays(monday, 6);
  return `${fmt(monday, true)} – ${fmt(sunday, sunday.slice(5, 7) !== monday.slice(5, 7))}`;
}

export function weekModel(input: { mode: 'week' | 'template'; days: WeekDayInput[]; posts: readonly HubPost[]; now: Date }) {
  const today = nyDateOf(input.now)!;
  const startedAt = (nyDate: string | null, minute: number) => nyDate === today && nyDayStart(today).getTime() + minute * 60_000 <= input.now.getTime();
  // Making a date an LFD day adds its 9:00 window, so it closes when that window starts.
  const lfdStart = PLAN.last_few_days[0]!.startMinute;
  const columns = input.days.map((d) => ({
    nyDate: d.nyDate,
    weekday: d.weekday,
    past: d.nyDate != null && d.nyDate < today,
    isToday: d.nyDate === today,
    lfdOpen: input.mode === 'template' || (d.nyDate != null && d.nyDate >= today && !startedAt(d.nyDate, lfdStart)),
  }));
  const rows = ROWS.map((row) => ({
    row,
    cells: input.days.map((d): WeekCell => {
      const inRow = (v: Vertical, id: string) => row.windows.some((w) => w.vertical === v && w.windowId === id);
      const chips = d.slots.filter((s) => inRow(s.vertical, s.windowId)).map((s): WeekChip => ({
        vertical: s.vertical,
        windowId: s.windowId,
        feedMode: s.feedMode,
        origin: s.origin,
        booked: d.nyDate ? input.posts.find((p) => p.vertical === s.vertical && p.nyDate === d.nyDate && p.slot?.id === s.windowId && HOLDS.has(p.status)) ?? null : null,
      }));
      const lfdDay = d.slots.some((s) => s.vertical === 'last_few_days');
      const carouselDay = d.slots.some((s) => s.vertical === 'carousels');
      const started = startedAt(d.nyDate, row.startMinute);
      const editable = input.mode === 'template' || (d.nyDate != null && d.nyDate >= today && !started);
      // The plain "+" never offers a save the writer will refuse: no Carousel on an LFD day, no LFD on a Carousel day.
      const addable = !editable ? [] : row.windows.filter((w) =>
        !chips.some((c) => c.vertical === w.vertical && c.windowId === w.windowId)
        && !(w.vertical === 'carousels' && lfdDay)
        && !(w.vertical === 'last_few_days' && (carouselDay || chips.length > 0)));
      const blockedReason = chips.length === 0 && lfdDay && row.windows.some((w) => w.vertical === 'carousels') ? 'LFD day' : null;
      return { nyDate: d.nyDate, weekday: d.weekday, rowId: row.id, chips, blockedReason, editable, addable: [...addable] };
    }),
  }));
  return { columns, rows };
}
