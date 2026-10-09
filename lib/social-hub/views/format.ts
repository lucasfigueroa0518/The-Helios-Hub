import { addDays, HUB_TIMEZONE, nyDateOf } from '@/lib/social-hub/time';
import type { HubPost } from '@/lib/social-hub/types';

/**
 * Person-facing text for the hub (REVISIONS G13, G14). One date format
 * everywhere, New York time, words inside two days; titles in sentence case
 * when a pipeline stored them shouting.
 */

const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: HUB_TIMEZONE });
const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: HUB_TIMEZONE });
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: HUB_TIMEZONE });

/** "9:23 AM" */
export function clock(iso: string | null | undefined): string {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : TIME.format(at);
}

/** "Today", "Tomorrow", "Yesterday", or "Fri Oct 9" for a New York day key. */
export function dayWord(nyDate: string, now: Date): string {
  const today = nyDateOf(now)!;
  if (nyDate === today) return 'Today';
  if (nyDate === addDays(today, 1)) return 'Tomorrow';
  if (nyDate === addDays(today, -1)) return 'Yesterday';
  return DAY.format(new Date(`${nyDate}T12:00:00Z`)).replace(',', '');
}

/** "Today 9:23 AM", "Tomorrow 7:11 AM", "Fri Oct 9 · 9:23 AM". */
export function when(iso: string | null | undefined, now: Date): string {
  if (!iso) return '';
  const day = nyDateOf(iso);
  if (!day) return '';
  const word = dayWord(day, now);
  return word.length <= 9 ? `${word} ${clock(iso)}` : `${word} · ${clock(iso)}`;
}

/** "Oct 8" for a day key or an instant. */
/** when(), for the middle of a sentence: "posts today 3:47 PM". */
export function whenInline(iso: string | null | undefined, now: Date): string {
  return when(iso, now).replace(/^(Today|Tomorrow|Yesterday)\b/, (w) => w.toLowerCase());
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return '';
  const at = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return Number.isNaN(at.getTime()) ? '' : DATE.format(at);
}

/** "in 2 h 15 m", "in 40 m", "3 h ago", "2 days ago". */
export function relative(iso: string | null | undefined, now: Date): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - now.getTime();
  if (Number.isNaN(ms)) return '';
  const future = ms >= 0;
  const minutes = Math.round(Math.abs(ms) / 60_000);
  let text: string;
  if (minutes < 1) text = 'now';
  else if (minutes < 60) text = `${minutes} m`;
  else if (minutes < 48 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    text = m && h < 6 ? `${h} h ${m} m` : `${h} h`;
  } else text = `${Math.round(minutes / 1440)} days`;
  if (text === 'now') return 'now';
  return future ? `in ${text}` : `${text} ago`;
}

/** "2 h left" until a slot; null once it has passed. */
export function timeLeft(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now.getTime();
  if (Number.isNaN(ms) || ms <= 0) return null;
  return `${relative(iso, now).replace(/^in /, '')} left`;
}

/** Common acronyms kept in capitals when a shouting title is sentence-cased. */
const ACRONYMS = new Set(['AI', 'AGI', 'API', 'APIS', 'AWS', 'CEO', 'CFO', 'CTO', 'EU', 'GPU', 'GPUS', 'IBM', 'AMD', 'IPO', 'LLM', 'LLMS', 'SDK', 'UK', 'US', 'USA', 'UN', 'VR', 'AR', 'TV', 'NBA', 'NFL', 'NYC', 'SEC', 'FTC', 'FDA', 'HR', 'ML', 'IOS', 'PC', 'OS']);

/**
 * Pipelines sometimes store titles in capitals; the hub shows them as a person
 * would write them (REVISIONS G14). A matching description already has the
 * right capitals (proper nouns included), so it wins; otherwise sentence case
 * with common acronyms kept.
 */
export function displayName(post: Pick<HubPost, 'name'> & { description?: string | null }): string {
  const name = post.name.trim();
  const letters = name.replace(/[^A-Za-z]/g, '');
  if (letters.length < 6 || letters !== letters.toUpperCase()) return name;
  const description = post.description?.trim();
  if (description && description.toUpperCase() === name.toUpperCase()) return description;
  return name
    .split(/(\s+)/)
    .map((word, i) => {
      if (/^\s+$/.test(word)) return word;
      const bare = word.replace(/['’]s$/i, '').replace(/[^A-Za-z]/g, '');
      if (ACRONYMS.has(bare.toUpperCase())) return word.replace(/['’]S$/, (m) => m.toLowerCase());
      const lower = word.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join('');
}

/** "1 post", "3 posts". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
