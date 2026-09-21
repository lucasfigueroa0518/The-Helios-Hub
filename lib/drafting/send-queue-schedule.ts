/**
 * America/New_York calendar helpers for the handoff board.
 * Minute-level slot allocation used to live here; Smartlead now picks the minute.
 */

export const SEND_QUEUE_TIMEZONE = 'America/New_York';
export const SEND_WINDOW_START_HOUR = 9;
export const SEND_WINDOW_END_HOUR = 17;
/** Live queue board: today through this many days ahead. */
export const SEND_QUEUE_LIVE_HORIZON_DAYS = 14;
/** Extra calendar days before today, so the board can scroll back one week. */
export const SEND_QUEUE_LOOKBACK_DAYS = 7;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Calendar date YYYY-MM-DD in America/New_York for an instant. */
export function formatNyDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SEND_QUEUE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** User-facing label like "Aug 12" for a YYYY-MM-DD calendar date. */
export function formatNyDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const utc = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(utc);
}

export function addCalendarDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

/**
 * Queue board date window: prior 7 NY days through today + 14.
 * The UI starts scrolled to today so last week is reachable by scrolling left.
 */
export function sendQueueBoardWindow(today: string): { from: string; to: string } {
  return {
    from: addCalendarDays(today, -SEND_QUEUE_LOOKBACK_DAYS),
    to: addCalendarDays(today, SEND_QUEUE_LIVE_HORIZON_DAYS),
  };
}

function nyParts(date: Date): { dateStr: string; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: SEND_QUEUE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** User-facing weekday like "Thu" for a YYYY-MM-DD NY calendar date. */
export function formatNyWeekday(dateStr: string): string {
  const utc = nyWallTimeToUtc(dateStr, 12, 0);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: SEND_QUEUE_TIMEZONE,
  }).format(utc);
}

export function isNyCalendarWeekend(dateStr: string): boolean {
  const utc = nyWallTimeToUtc(dateStr, 12, 0);
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: SEND_QUEUE_TIMEZONE,
  }).format(utc);
  return weekday === 'Sat' || weekday === 'Sun';
}

function calendarDayDiff(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86_400_000);
}

/** Convert NY wall-clock on a calendar date to a UTC Date. */
export function nyWallTimeToUtc(dateStr: string, hour: number, minute: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, hour + 5, minute, 0);
  for (let i = 0; i < 6; i += 1) {
    const parts = nyParts(new Date(guess));
    const asMinutes = parts.hour * 60 + parts.minute;
    const targetMinutes = hour * 60 + minute;
    const dayOffset = calendarDayDiff(parts.dateStr, dateStr);
    const deltaMin = dayOffset * 24 * 60 + (targetMinutes - asMinutes);
    if (deltaMin === 0) break;
    guess += deltaMin * 60_000;
  }
  return new Date(guess);
}

/** Remaining seats on a day. Used by the homepage week total, not the planner. */
export function remainingCapacity(used: number, cap: number): number {
  return Math.max(0, cap - Math.max(0, used));
}
