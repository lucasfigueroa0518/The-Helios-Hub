import { clampTrafficRange, combineOdata, environmentFilter, odataEq } from '@/lib/traffic/format';
import { aggregateByDay, getVercelTrafficConfig } from '@/lib/traffic/vercel-client';

/** The public pages the tracker reads views for (heliosgroup.ai). */
export const CALENDAR_PATH = '/free-tools/ai-networking-events';
export const GAME_PATH = '/free-tools/smarter-than-ai';

/** Daily visitors to one page, keyed by YYYY-MM-DD, or a note saying why there are none. Never throws. */
export async function pageVisitorsByDay(path: string, range: { from: string; to: string }): Promise<{ byDay: Record<string, number> | null; note: string | null }> {
  const config = getVercelTrafficConfig();
  if (!config) return { byDay: null, note: 'Page views need the Vercel Analytics keys the Traffic page uses.' };
  try {
    // Vercel keeps about 62 days: a longer range reads its most recent part.
    const rows = await aggregateByDay(config, clampTrafficRange(range), combineOdata([environmentFilter('production'), odataEq('requestPath', path)]));
    return { byDay: Object.fromEntries(rows.map((r) => [r.date, r.visitors])), note: null };
  } catch (err) {
    return { byDay: null, note: `Vercel Analytics did not answer: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}` };
  }
}

/** YYYY-MM-DD in New York. */
export function nyDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
