/**
 * The render Post for one week of AI Events This Week (plan M5): a cover, one slide per city with
 * picks (Miami, Boston, NYC, SF; AE-02/03) and a closing CTA slide, so at most 6 slides at 1080×1350.
 * The cover is the hook and the calendar CTA (AE-22); each city slide features its top pick and
 * teases the next two (AE-24/25). Every word is built here by code from the picks and the drawn hook; the
 * look only changes how the slides are drawn (lib/social/render/ai-events). Pure: no I/O, no model.
 */
import type { AeEventRow, AeIcon, AeMention, AeRankTreat, AeSlide, Post as RenderPost, SlideCopy } from '@/lib/social/render/types';

import { buildCaption, buildRankedCaption, topTrait, type CaptionCity } from './caption';
import { hookByKey, hookLines } from './hooks';
import { isLook } from './looks';
import { cleanEventTitle, cleanName, clipText } from './title';
import { AI_EVENTS_CITIES, AI_EVENTS_METROS, type AiEventsCityPostInput, type AiEventsMetro, type AiEventsPostInput, type PickedEvent } from './types';

export const MAX_PICKS_PER_CITY = 3;
/** Honorable mentions under a city's top pick (AE-25). */
export const MAX_MENTIONS = MAX_PICKS_PER_CITY - 1;
/** Longest copy a slide takes (characters); longer text is cut at a word with an ellipsis. The render test runs at these. */
export const COPY_MAX = { title: 80, mention: 46, host: 36, place: 36 } as const;

export const SITE = 'heliosgroup.ai';
export const HANDLE = '@heliosgroup.ai';
export const CALENDAR_URL = 'https://heliosgroup.ai/free-tools/ai-networking-events';
export const LINK_IN_BIO = 'Link in bio';
export const COVER_CTA = `Free AI Events Calendar · ${LINK_IN_BIO}`;
export const TOP_PICK = 'TOP PICK';
export const MENTIONS_LABEL = 'ALSO THIS WEEK';
export const FINAL_SLIDE = {
  eyebrow: 'FREE TOOL',
  lead: 'Free AI events',
  lit: 'calendar',
  line: 'Every pick, every RSVP link, four cities, updated weekly.',
} as const;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "OCT 26–NOV 1", or "NOV 2–8" inside one month, from YYYY-MM-DD dates. */
export function weekRangeLabel(weekStart: string, weekEnd: string): string {
  const parse = (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (!m) throw new Error(`not a YYYY-MM-DD date: ${d}`);
    return { month: Number(m[2]) - 1, day: Number(m[3]) };
  };
  const a = parse(weekStart);
  const b = parse(weekEnd);
  return a.month === b.month ? `${MONTHS[a.month]} ${a.day}–${b.day}` : `${MONTHS[a.month]} ${a.day}–${MONTHS[b.month]} ${b.day}`;
}

/** The parts of an instant in a time zone: weekday ("Tue"), date key and time ("6:30 PM", "6 PM"). */
function local(iso: string, timeZone: string): { weekday: string; date: string; time: string } {
  const at = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const minute = parts.minute === '00' ? '' : `:${parts.minute}`;
  return { weekday: parts.weekday!, date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}${minute} ${parts.dayPeriod!.toUpperCase()}` };
}

const MULTI_DAY_MS = 20 * 3600 * 1000;

/** The event's days in its metro's zone: "Tue", or "Tue–Thu" for a multi-day event. */
export function eventDays(ev: Pick<PickedEvent, 'start' | 'end' | 'metro'>): string {
  const tz = AI_EVENTS_CITIES[ev.metro].timezone;
  const s = local(ev.start, tz);
  if (ev.end && Date.parse(ev.end) - Date.parse(ev.start) >= MULTI_DAY_MS) {
    const e = local(ev.end, tz);
    if (e.date !== s.date) return `${s.weekday}–${e.weekday}`;
  }
  return s.weekday;
}

/** "TUE · 6:30 PM" in the metro's zone (multi-day: "TUE–THU · 9 AM"). */
export function eventWhen(ev: Pick<PickedEvent, 'start' | 'end' | 'metro'>): string {
  return `${eventDays(ev).toUpperCase()} · ${local(ev.start, AI_EVENTS_CITIES[ev.metro].timezone).time}`;
}

const ICON_RULES: Array<[AeIcon, RegExp]> = [
  ['code', /\b(hack(athon|ers?| night| day)?|build(ers?)? (night|day|session)|coding|code|developers?|dev ?(day|night)|vibe ?cod)/],
  ['graduation', /\b(workshops?|class(es)?|course|bootcamp|training|masterclass|office hours|tutorial|study group|paper (club|reading))\b/],
  ['utensils', /\b(dinners?|breakfast|brunch|lunch(eon)?|supper|food|tasting)\b/],
  ['presentation', /\b(demos?|demo (day|night)|pitch(es|ing)?|showcase|science fair)\b/],
  ['ticket', /\b(conference|summit|forum|festival|tech week|expo|congress|symposium|con)\b/],
  ['mic', /\b(talks?|panels?|fireside|speakers?|keynote|lecture|chat with|ama|q&a|podcast|live recording|in conversation)\b/],
  ['users', /\b(mixer|meetups?|happy hour|networking|social|drinks|community|founders|meet|gathering|party)\b/],
];

/** The row's Lucide icon (glass and daylight looks), from the title and the ingest's format hints. */
export function eventIcon(ev: Pick<PickedEvent, 'title' | 'signals'>): AeIcon {
  const hay = [ev.title, ev.signals?.format ?? '', ...(ev.signals?.tags ?? [])].join(' ').toLowerCase();
  return ICON_RULES.find(([, re]) => re.test(hay))?.[0] ?? 'calendar';
}

/** The metro's own city name in its usual spellings: shown on that city's slide, it adds nothing. */
const METRO_CITY_NAMES: Record<AiEventsMetro, string[]> = {
  miami: ['miami'],
  boston: ['boston'],
  nyc: ['new york', 'new york city', 'nyc', 'manhattan'],
  sf: ['san francisco', 'sf'],
};

/** "Venue" or "Venue, Locality" (the locality only when it adds something); the venue's first comma part. */
export function eventPlace(ev: Pick<PickedEvent, 'venue' | 'city' | 'metro'>): string | undefined {
  const venue = cleanName(ev.venue).split(',')[0]!.trim();
  const locality = cleanName(ev.city).split(',')[0]!.trim();
  const useful = locality && !METRO_CITY_NAMES[ev.metro].includes(locality.toLowerCase());
  const place = venue ? (useful && !venue.toLowerCase().includes(locality.toLowerCase()) ? `${venue}, ${locality}` : venue) : useful ? locality : '';
  return place ? clipText(place, COPY_MAX.place) : undefined;
}

/** The top pick's copy (AE-24): day and time, title, host and venue; no badge. */
export function eventRow(ev: PickedEvent): AeEventRow {
  const organizer = cleanName(ev.organizer);
  const place = eventPlace(ev);
  return {
    when: eventWhen(ev),
    title: clipText(cleanEventTitle(ev.title), COPY_MAX.title),
    ...(organizer ? { host: `Hosted by ${clipText(organizer, COPY_MAX.host)}` } : {}),
    ...(place ? { place } : {}),
    icon: eventIcon(ev),
    ...(ev.image ? { image: ev.image } : {}),
  };
}

/** An honorable mention (AE-25): "WED" and the title. */
export function eventMention(ev: PickedEvent): AeMention {
  return { day: eventDays(ev).toUpperCase(), title: clipText(cleanEventTitle(ev.title), COPY_MAX.mention) };
}

/** "In Miami, Boston, NYC & SF": the cities with picks, in post order. */
export function citySubline(names: string[]): string {
  if (names.length <= 1) return `In ${names[0] ?? ''}`.trim();
  return `In ${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** The city slide's CTA, before " · Link in bio": "+5 more Boston events on our free calendar", or "Full calendar". */
export function cityMore(short: string, remaining: number): string {
  return remaining > 0 ? `+${remaining} more ${short} events on our free calendar` : 'Full calendar';
}

/**
 * The cities that have picks, in post order. `top` is the ranking's first pick (pins first, then
 * score); `mentions` are the next two, in time order; `picks` is all three in time order (caption).
 */
export function postCities(cities: AiEventsPostInput['cities']) {
  return AI_EVENTS_METROS.flatMap((metro) => {
    const c = cities.find((x) => x.metro === metro && x.picks.length > 0);
    if (!c) return [];
    const shown = c.picks.slice(0, MAX_PICKS_PER_CITY);
    const byTime = (a: PickedEvent, b: PickedEvent) => Date.parse(a.start) - Date.parse(b.start);
    const top = shown[0]!;
    const mentions = shown.slice(1, 1 + MAX_MENTIONS).sort(byTime);
    const picks = [...shown].sort(byTime);
    const remaining = Math.max(0, c.remainingCount) + (c.picks.length - shown.length);
    return [{ metro, ...AI_EVENTS_CITIES[metro], top, mentions, picks, remaining }];
  });
}

/** The ranked city carousel's fixed copy (AE-29). */
export const RANKED = {
  lit: 'Ranked.',
  tease: { lead: 'Want to see', lit: 'the full list? →' },
  teaseCta: `Revealed on our free calendar · ${LINK_IN_BIO}`,
} as const;

/** "8 AI Networking Events in Miami this week." (the cover's lead; "Ranked." is lit under it). */
export function rankedCoverLead(n: number, city: string): string {
  return `${n} AI Networking ${n === 1 ? 'Event' : 'Events'} in ${city} this week.`;
}

/**
 * One city's ranked carousel (AE-29): the cover ("N AI Networking Events in {City} this week.
 * Ranked."), 3–4 spotlights from #2 to the last gated event (`spotlightRanks`, AE-33), the tease
 * ("Want to see the full list? →" over the locked #1) and the closing slide. Needs at least 2
 * picks (a #1 to hold back and one spotlight); fewer throws.
 */
export function buildAiEventsCityPost(input: AiEventsCityPostInput): RenderPost {
  if (!isLook(input.look)) throw new Error(`no look "${String(input.look)}"`);
  const look = input.look;
  const city = AI_EVENTS_CITIES[input.metro];
  const picks = input.picks.slice(0, MAX_RANKED);
  if (picks.length < 2) throw new Error(`a ranked ${city.short} post needs at least 2 picks (got ${picks.length})`);
  const n = Math.max(input.totalCount, picks.length);
  const week = weekRangeLabel(input.weekStart, input.weekEnd);
  const slide = (position: number, data: AeSlide, altText: string): SlideCopy => ({
    position,
    layoutVariant: `ae_${look}_${data.role}`,
    altText,
    aiEvents: data,
  });

  const lead = rankedCoverLead(n, city.short);
  const cover = slide(
    0,
    { look, role: 'cover', lead, lit: RANKED.lit, week, cta: COVER_CTA, cities: [{ label: city.label, short: city.short, picks: picks.length }] },
    `${lead} ${RANKED.lit} ${week}. ${COVER_CTA}.`,
  );
  const layout = input.rankLayout ?? 'poster';
  const treat = { treat: input.rankTreat ?? (['panorama'] as AeRankTreat[]) };
  const ranks = spotlightRanks(picks.length);
  const spotlights = ranks.map((rank, i) => {
    const pick = eventRow(picks[rank - 1]!);
    const next = i + 1 < ranks.length ? { next: ranks[i + 1]! } : {};
    return slide(
      i + 1,
      { look, role: 'rank', rank, pick, layout, ...treat, ...next },
      `#${rank} in ${city.short} this week: ${[pick.when, pick.title, pick.host, pick.place].filter(Boolean).join(', ')}.`,
    );
  });
  const teaseAt = spotlights.length + 1;
  const tease = slide(
    teaseAt,
    { look, role: 'tease', lead: RANKED.tease.lead, lit: RANKED.tease.lit, rank: '#1', label: `${city.short.toUpperCase()}'S #1 THIS WEEK`, cta: RANKED.teaseCta },
    `Want to see the full list? ${city.short}'s #1 event this week is on our free calendar. ${RANKED.teaseCta}.`,
  );
  const line = `Every ranked ${city.short} event, every RSVP link, updated weekly.`;
  const final = slide(
    teaseAt + 1,
    { look, role: 'cta', eyebrow: FINAL_SLIDE.eyebrow, lead: FINAL_SLIDE.lead, lit: FINAL_SLIDE.lit, site: SITE, line, cta: LINK_IN_BIO, handle: HANDLE },
    `${FINAL_SLIDE.lead} ${FINAL_SLIDE.lit} at ${SITE}. ${line} ${LINK_IN_BIO}.`,
  );

  return {
    format: 'carousel',
    storyType: 'tech',
    source: 'Helios Group',
    sourceUrl: CALENDAR_URL,
    publishedAt: `${input.weekStart.slice(0, 10)}T00:00:00.000Z`,
    issueNumber: input.issueNumber ?? 0,
    slides: [cover, ...spotlights, tease, final],
    caption: buildRankedCaption({
      total: n,
      city: city.short,
      hashtag: city.hashtag,
      top: { trait: topTrait(picks[0]!), days: eventDays(picks[0]!) },
    }),
  };
}

/** The deepest rank the post reads (lib/networking/pick/picks.ts RANK_DEPTH). */
export const MAX_RANKED = 20;

/**
 * 3–4 teasers from a list of `n` ranked events (#1 held back). Always starts at #2 and always
 * ends on the last event, so the swipe covers the gated list instead of clustering at the top.
 * Two ranked: #2. Three: #2 and #3. Four or five: three ranks. Six or more: four ranks.
 */
export function spotlightRanks(n: number): number[] {
  if (n < 2) return [];
  const first = 2;
  const last = n;
  if (last === first) return [2];
  const available = last - first + 1;
  const count = last >= 6 ? 4 : Math.min(3, available);
  const span = last - first;
  const ranks: number[] = [];
  for (let i = 0; i < count; i += 1) {
    ranks.push(Math.round(first + (span * i) / (count - 1)));
  }
  ranks[0] = first;
  ranks[ranks.length - 1] = last;
  return [...new Set(ranks)].sort((a, b) => a - b);
}

export function buildAiEventsPost(input: AiEventsPostInput): RenderPost {
  const hook = hookByKey(input.hookKey);
  if (!hook) throw new Error(`no hook "${input.hookKey}" in the bank`);
  if (!isLook(input.look)) throw new Error(`no look "${String(input.look)}"`);
  const look = input.look;
  const cities = postCities(input.cities);
  if (!cities.length) throw new Error('an AI Events post needs at least one city with picks');

  const week = weekRangeLabel(input.weekStart, input.weekEnd);
  const { lead, lit } = hookLines(hook);
  const slide = (position: number, data: AeSlide, altText: string): SlideCopy => ({
    position,
    layoutVariant: `ae_${look}_${data.role}`,
    altText,
    aiEvents: data,
  });

  const subline = citySubline(cities.map((c) => c.short));
  const cover = slide(
    0,
    { look, role: 'cover', lead, lit, week, cta: COVER_CTA, cities: cities.map((c) => ({ label: c.label, short: c.short, picks: c.picks.length })) },
    `${hook.text} ${week}, ${subline}. ${COVER_CTA}.`,
  );
  const citySlides = cities.map((c, i) => {
    const pick = eventRow(c.top);
    const mentions = c.mentions.map(eventMention);
    const more = cityMore(c.short, c.remaining);
    const also = mentions.length ? ` Also this week: ${mentions.map((m) => `${m.day}, ${m.title}`).join('; ')}.` : '';
    return slide(
      i + 1,
      { look, role: 'city', city: c.label, label: TOP_PICK, pick, mentionsLabel: MENTIONS_LABEL, mentions, more, cta: LINK_IN_BIO },
      `${c.label} top pick: ${[pick.when, pick.title, pick.host, pick.place].filter(Boolean).join(', ')}.${also} ${more} · ${LINK_IN_BIO}.`,
    );
  });
  const final = slide(
    cities.length + 1,
    { look, role: 'cta', eyebrow: FINAL_SLIDE.eyebrow, lead: FINAL_SLIDE.lead, lit: FINAL_SLIDE.lit, site: SITE, line: FINAL_SLIDE.line, cta: LINK_IN_BIO, handle: HANDLE },
    `${FINAL_SLIDE.lead} ${FINAL_SLIDE.lit} at ${SITE}. ${FINAL_SLIDE.line} ${LINK_IN_BIO}.`,
  );

  const captionCities: CaptionCity[] = cities.map((c) => ({
    name: c.short,
    hashtag: c.hashtag,
    events: c.picks.map((ev) => ({ day: eventDays(ev), title: cleanEventTitle(ev.title), organizer: cleanName(ev.organizer) || null })),
  }));

  return {
    format: 'carousel',
    storyType: 'tech',
    source: 'Helios Group',
    sourceUrl: CALENDAR_URL,
    publishedAt: `${input.weekStart.slice(0, 10)}T00:00:00.000Z`,
    issueNumber: input.issueNumber ?? 0,
    slides: [cover, ...citySlides, final],
    caption: buildCaption({ hook: hook.text, cities: captionCities }),
  };
}
