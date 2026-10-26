/**
 * AI Events This Week (planning/AI Events/DECISIONS.md): the shapes the pure post builder reads.
 * Copy is built by code from these, never by a model (plan M4/M5).
 */
import type { AeRankLayout, AeRankTreat } from '@/lib/social/render/types';

import type { HookKey } from './hooks';
import type { Look } from './looks';

/** Cities in post order (AE-02): Miami, Boston, NYC, SF Bay Area. */
export const AI_EVENTS_METROS = ['miami', 'boston', 'nyc', 'sf'] as const;
export type AiEventsMetro = (typeof AI_EVENTS_METROS)[number];

/**
 * Per city: `label` heads its slide, `short` goes in the cover subline, the city CTA and the
 * caption, `timezone` sets every day and time shown, `hashtag` is its caption tag.
 */
export const AI_EVENTS_CITIES: Record<AiEventsMetro, { label: string; short: string; timezone: string; hashtag: string }> = {
  miami: { label: 'Miami', short: 'Miami', timezone: 'America/New_York', hashtag: '#MiamiTech' },
  boston: { label: 'Boston', short: 'Boston', timezone: 'America/New_York', hashtag: '#BostonTech' },
  nyc: { label: 'New York', short: 'NYC', timezone: 'America/New_York', hashtag: '#NYCTech' },
  sf: { label: 'SF Bay Area', short: 'SF', timezone: 'America/Los_Angeles', hashtag: '#SFTech' },
};

export type EventAccess = 'open' | 'approval' | 'apply';

/** Cents; null when the listing doesn't say. `currency` is ISO 4217 (USD when null). */
export type EventPrice = { free: boolean; minCents: number | null; maxCents: number | null; currency: string | null };

/** One picked event, as the ranking hands it over (plan M2 step 5). */
export type PickedEvent = {
  id: string;
  title: string;
  /** ISO 8601 instants. */
  start: string;
  end: string | null;
  /** The listing's IANA zone; the metro's zone when null. */
  timezone: string | null;
  metro: AiEventsMetro;
  organizer: string | null;
  venue: string | null;
  /** The locality ("Cambridge", "San Jose"); shown after the venue when it adds something. */
  city: string | null;
  price: EventPrice;
  access: EventAccess;
  soldOut: boolean;
  waitlist: boolean;
  going: number | null;
  rsvpUrl: string;
  /** Format hints from the ingest (Luma categories, Meetup topics); only used to choose an icon. */
  signals?: { format?: string | null; tags?: string[] | null } | null;
  /** The organizer's poster (Luma `cover_url`, Meetup event photo); the rank slide draws it whole. */
  image?: string | null;
};

export type CityPicks = {
  metro: AiEventsMetro;
  /** Up to 3 shown (AE-03); a city with none is skipped. */
  picks: PickedEvent[];
  /** Events on the website calendar for this city this week beyond the picks ("+{n} more"). */
  remainingCount: number;
};

/**
 * One city's ranked carousel (AE-29): the picks in rank order (#1 first, up to 4) and how many
 * events the website shows for the city that week (the cover's N).
 */
export type AiEventsCityPostInput = {
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  metro: AiEventsMetro;
  /** Rank order: picks[0] is #1 (held back for the site), picks[1..3] are the spotlights. */
  picks: PickedEvent[];
  /** Events on the website calendar for this city this week. */
  totalCount: number;
  look: Look;
  issueNumber?: number;
  /** How the rank slides set their event; `poster` when unset. */
  rankLayout?: AeRankLayout;
  rankTreat?: AeRankTreat[];
};

export type AiEventsPostInput = {
  weekKey: string;
  /** The Monday and Sunday of the post's week, YYYY-MM-DD (ET). */
  weekStart: string;
  weekEnd: string;
  cities: CityPicks[];
  hookKey: HookKey;
  look: Look;
  issueNumber?: number;
};
