import { calendarDateKey, SOCIAL_TIMEZONE, zonedTime } from '@/lib/instagram/clock';
import type { DateRange, DateRangeId } from '@/lib/social-hub/types';

/** All hub times are America/New_York (docs/social-overnight.md). */
export const HUB_TIMEZONE = SOCIAL_TIMEZONE;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function nyDateOf(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const at = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return calendarDateKey(at, HUB_TIMEZONE);
}

export function addDays(nyDate: string, days: number): string {
  const [y, m, d] = nyDate.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + days));
  return next.toISOString().slice(0, 10);
}

export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_KEY.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y! < 2000) return false;
  const probe = new Date(Date.UTC(y!, m! - 1, d!));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m! - 1 && probe.getUTCDate() === d;
}

/** Start of a New York day as an instant. */
export function nyDayStart(nyDate: string): Date {
  const [y, m, d] = nyDate.split('-').map(Number);
  return zonedTime(y!, m!, d!, 0, 0, HUB_TIMEZONE);
}

const RANGE_DAYS: Record<Exclude<DateRangeId, 'all' | 'custom'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

export const RANGE_OPTIONS: Array<{ id: DateRangeId; label: string }> = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All' },
  { id: 'custom', label: 'Custom' },
];

/** SH-29: 7d / 30d / 90d / All + custom, default 30d. Inclusive New York days ending today. */
export function parseRange(input: { range?: string; from?: string; to?: string }, now = new Date()): DateRange {
  const today = nyDateOf(now)!;
  const id = input.range as DateRangeId | undefined;
  if (id === 'all') return { id: 'all', from: null, to: today };
  if (id === 'custom' && isDayKey(input.from)) {
    const from = input.from > today ? today : input.from;
    const to = isDayKey(input.to) && input.to >= from ? (input.to > today ? today : input.to) : today;
    return { id: 'custom', from, to };
  }
  const known = typeof id === 'string' && Object.hasOwn(RANGE_DAYS, id);
  const days = known ? RANGE_DAYS[id as keyof typeof RANGE_DAYS] : 30;
  const rangeId: DateRangeId = known ? (id as DateRangeId) : '30d';
  return { id: rangeId, from: addDays(today, -(days - 1)), to: today };
}

export function inRange(nyDate: string | null, range: DateRange): boolean {
  if (!nyDate) return false;
  if (range.from && nyDate < range.from) return false;
  return nyDate <= range.to;
}

/** Instants bounding the range for SQL: [start, end). */
export function rangeBounds(range: DateRange): { start: Date | null; end: Date } {
  return { start: range.from ? nyDayStart(range.from) : null, end: nyDayStart(addDays(range.to, 1)) };
}

export function rangeLabel(range: DateRange): string {
  if (range.id === 'all') return 'All time';
  if (range.id === 'custom') return `${range.from} – ${range.to}`;
  return RANGE_OPTIONS.find((r) => r.id === range.id)?.label ?? range.id;
}

export function monthOf(value: string | undefined, now = new Date()): string {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(5));
    if (y >= 2000 && m >= 1 && m <= 12) return value;
  }
  return nyDateOf(now)!.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return next.toISOString().slice(0, 7);
}

/**
 * Month grid, weeks starting Sunday. Every cell is a New York day key;
 * `inMonth` marks days outside the month (leading/trailing fillers).
 */
export function monthGrid(month: string): Array<Array<{ day: string; inMonth: boolean }>> {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const start = addDays(first, -weekday);
  const cells = Math.ceil((weekday + daysInMonth) / 7) * 7;
  const weeks: Array<Array<{ day: string; inMonth: boolean }>> = [];
  for (let i = 0; i < cells; i++) {
    const day = addDays(start, i);
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1]!.push({ day, inMonth: day.slice(0, 7) === month });
  }
  return weeks;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function dayLabel(nyDate: string): string {
  const [y, m, d] = nyDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

/** "9:12 AM" in New York. */
export function timeLabel(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: HUB_TIMEZONE });
}

/** "Oct 8, 9:12 AM" in New York. */
export function dateTimeLabel(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: HUB_TIMEZONE,
  });
}

export function weekdayOf(nyDate: string): number {
  const [y, m, d] = nyDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
