/**
 * The AI Events This Week caption, built by code (plan M4: no model calls in this type):
 *
 *   the hook line
 *
 *   Boston — Tue: Title (Organizer)
 *   …one line per pick, cities in post order
 *
 *   All RSVP links and the full calendar: link in bio (heliosgroup.ai)
 *
 *   4–6 hashtags
 *
 * At most CAPTION_MAX_CHARS (Instagram's limit). Over it, event lines go from the end first; the hook,
 * the link line and the hashtags stay whole. No emoji and no exclamation marks: titles and names
 * arrive cleaned (title.ts), and the fixed lines have none.
 */

import type { PickedEvent } from './types';

export const CAPTION_MAX_CHARS = 2200;
export const CAPTION_LINK_LINE = 'All RSVP links and the full calendar: link in bio (heliosgroup.ai)';
const BASE_TAGS = ['#AIEvents', '#AINetworking'];
const FILLER_TAGS = ['#StartupEvents', '#TechEvents'];

export type CaptionCity = {
  /** "Boston", "NYC", "SF". */
  name: string;
  hashtag: string;
  /** `day` is "Tue" (or "Tue–Thu" for a multi-day event) in the city's time zone. */
  events: Array<{ day: string; title: string; organizer: string | null }>;
};

/** 4–6 tags: the series tags, one per city with picks, then fillers up to 4. */
export function captionHashtags(cities: CaptionCity[]): string[] {
  const tags = [...BASE_TAGS, ...cities.map((c) => c.hashtag)];
  for (const filler of FILLER_TAGS) if (tags.length < 4) tags.push(filler);
  return [...new Set(tags)].slice(0, 6);
}

/** A #1 with at least this many people going counts as "big" when no stronger trait applies. */
export const BIG_GOING = 200;

export type TopTrait = 'selling out' | 'free' | 'big';

/**
 * What the ranked caption says about #1, in order of truth: selling out (sold out or on a waitlist), else free, else big
 * (a conference, or BIG_GOING or more going). Null when none is true, and the caption then says only the day.
 */
export function topTrait(ev: Pick<PickedEvent, 'soldOut' | 'waitlist' | 'price' | 'going' | 'signals'>): TopTrait | null {
  if (ev.soldOut || ev.waitlist) return 'selling out';
  if (ev.price.free) return 'free';
  if (ev.signals?.format === 'conference' || (ev.going ?? 0) >= BIG_GOING) return 'big';
  return null;
}

const WEEKDAYS: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

/** "Tue" becomes "it's on Tuesday"; a multi-day "Tue–Thu" becomes "it runs Tuesday to Thursday". */
function whenPhrase(days: string): { single: boolean; text: string } {
  const [from, to] = days.split('–');
  const name = (d: string | undefined) => WEEKDAYS[d ?? ''] ?? d ?? '';
  return to ? { single: false, text: `${name(from)} to ${name(to)}` } : { single: true, text: name(from) };
}

export const RANKED_LINK_LINE = 'Go to the link in bio or heliosgroup.ai to see the full calendar.';

/**
 * The ranked city post's caption (AE-29): how many events the calendar has for the city this week, what #1 is
 * (topTrait) and its day, the link line and the tags. #1 is never named: it is held back for the site.
 *
 *   We ranked the 14 AI networking events happening in Miami this week. #1 is free and it's on Thursday.
 *
 *   Go to the link in bio or heliosgroup.ai to see the full calendar.
 *
 *   #AIEvents #AINetworking #MiamiTech #StartupEvents
 *
 * `days` is eventDays(#1): "Tue" or "Tue–Thu".
 */
export function buildRankedCaption({
  total,
  city,
  hashtag,
  top,
}: {
  total: number;
  city: string;
  hashtag: string;
  top: { trait: TopTrait | null; days: string };
}): string {
  const when = whenPhrase(top.days);
  const second = top.trait
    ? `#1 is ${top.trait} and ${when.single ? `it's on ${when.text}` : `it runs ${when.text}`}.`
    : when.single
      ? `#1 is on ${when.text}.`
      : `#1 runs ${when.text}.`;
  const lead = `We ranked the ${total} AI networking events happening in ${city} this week. ${second}`;
  const tags = captionHashtags([{ name: city, hashtag, events: [] }]).join(' ');
  return [lead, RANKED_LINK_LINE, tags].join('\n\n');
}

export function buildCaption({ hook, cities }: { hook: string; cities: CaptionCity[] }): string {
  const lines = cities.flatMap((c) => c.events.map((e) => `${c.name} — ${e.day}: ${e.title}${e.organizer ? ` (${e.organizer})` : ''}`));
  const tags = captionHashtags(cities).join(' ');
  const build = (n: number) => [hook, lines.slice(0, n).join('\n'), CAPTION_LINK_LINE, tags].filter(Boolean).join('\n\n');
  let n = lines.length;
  let caption = build(n);
  while (caption.length > CAPTION_MAX_CHARS && n > 0) caption = build(--n);
  return caption.length > CAPTION_MAX_CHARS ? caption.slice(0, CAPTION_MAX_CHARS) : caption;
}
