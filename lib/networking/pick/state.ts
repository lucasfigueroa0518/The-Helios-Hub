/**
 * The Jev state for one event-pick@1 call (plan M2 step 3). Facts the ingest read from the
 * source's structured fields sit at the top level; everything a host wrote (host names and
 * bios, the description) sits in `listing` under `untrusted_content` (JEV-06 / D-030).
 *
 * Luma featured guests are attendees and are never stored, so they can never be sent (AE-21).
 */
import { excerpt, untrusted, type UntrustedText } from '@/lib/reels/jev/state';
import { METRO_PROFILES } from '@/lib/networking/cities';
import type { StoredNetworkingEvent } from '@/lib/networking/types';

import type { CodeTerms } from './terms';
import type { ComingWeek } from './week';

export const DESCRIPTION_CHARS = 4000;
export const HOST_BIO_CHARS = 240;
export const MAX_STATE_HOSTS = 8;

export type EventPickState = {
  city: string;
  week: string;
  title: string;
  when: string;
  venue: string | null;
  price: string;
  access: string;
  attendance: { going: number | null; capacity: number | null; sold_out: boolean; waitlist: boolean };
  organizer: { name: string | null; track_record: string | null; rating: string | null };
  ecosystem_context: { roster_match: string | null; nearby_anchor_event: string | null };
  listing: UntrustedText;
};

function formatDay(date: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** "Tue, Oct 27, 2026, 6:00 PM – 9:00 PM EDT" in the event's zone (the metro's when unknown). */
export function formatWhen(event: Pick<StoredNetworkingEvent, 'startAt' | 'endAt' | 'timezone' | 'metro'>): string {
  const timeZone = event.timezone || METRO_PROFILES[event.metro].timezone;
  const start = new Date(event.startAt);
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(start).find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  if (!event.endAt) return `${day.format(start)}, ${time.format(start)} ${zone}`;
  const end = new Date(event.endAt);
  const sameDay = day.format(start) === day.format(end);
  return sameDay
    ? `${day.format(start)}, ${time.format(start)} – ${time.format(end)} ${zone}`
    : `${day.format(start)}, ${time.format(start)} – ${day.format(end)}, ${time.format(end)} ${zone}`;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export function formatPrice(event: Pick<StoredNetworkingEvent, 'isFree' | 'priceMinCents' | 'priceMaxCents' | 'priceCurrency' | 'access'>): string {
  const currency = event.priceCurrency && event.priceCurrency !== 'USD' ? ` ${event.priceCurrency}` : '';
  const min = event.priceMinCents;
  const max = event.priceMaxCents;
  if (min != null && min > 0) return max != null && max > min ? `${dollars(min)}–${dollars(max)}${currency}` : `${dollars(min)}${currency}`;
  if (max != null && max > 0) return `Free to ${dollars(max)}${currency}`;
  if (event.isFree) return 'Free';
  if (event.access === 'paid') return 'Paid (price not listed)';
  return 'Not listed';
}

export function formatAccess(event: Pick<StoredNetworkingEvent, 'access' | 'requiresApproval'>): string {
  if (event.access === 'invite_only') return 'Invite or application only';
  if (event.requiresApproval) return 'Registration requires host approval';
  if (event.access === 'paid') return 'Open, paid ticket';
  return 'Open registration';
}

/** Host names and short bios, then the description (at most DESCRIPTION_CHARS). */
export function listingText(event: Pick<StoredNetworkingEvent, 'hosts' | 'description'>): string {
  const hosts = (event.hosts ?? []).slice(0, MAX_STATE_HOSTS).filter((h) => h.name?.trim());
  const blocks: string[] = [];
  if (hosts.length) {
    const lines = hosts.map((h) => {
      const bio = h.bioShort?.trim() ? `: ${excerpt(h.bioShort.replace(/\s+/g, ' '), HOST_BIO_CHARS)}` : '';
      return `- ${h.name.trim()}${bio}`;
    });
    blocks.push(`Hosts:\n${lines.join('\n')}`);
  }
  const description = event.description?.trim();
  blocks.push(description ? `Description:\n${excerpt(description, DESCRIPTION_CHARS)}` : 'Description: (none listed)');
  return blocks.join('\n\n');
}

export function buildEventState(event: StoredNetworkingEvent, week: ComingWeek, terms: CodeTerms): EventPickState {
  const text = listingText(event);
  const anchor = terms.anchor;
  return {
    city: METRO_PROFILES[event.metro].label,
    week: `${formatDay(week.startDate)} to ${formatDay(week.endDate)}`,
    title: event.title,
    when: formatWhen(event),
    venue: [event.venueName, event.city].filter(Boolean).join(', ') || null,
    price: formatPrice(event),
    access: formatAccess(event),
    attendance: {
      going: event.guestCount ?? null,
      capacity: event.capacity ?? null,
      sold_out: event.isSoldOut === true,
      waitlist: event.waitlistActive === true,
    },
    organizer: {
      name: event.organizerName ?? null,
      track_record: terms.trackRecordDetail,
      rating:
        event.organizerRating != null && event.organizerRatingCount
          ? `${event.organizerRating.toFixed(1)} over ${event.organizerRatingCount} ratings`
          : null,
    },
    ecosystem_context: {
      roster_match: terms.rosterMatch,
      nearby_anchor_event: anchor
        ? `${anchor.name} (${anchor.startsOn}${anchor.endsOn && anchor.endsOn !== anchor.startsOn ? ` to ${anchor.endsOn}` : ''})`
        : null,
    },
    // The text is already cut to size above; untrusted() only wraps it.
    listing: untrusted(text, text.length),
  };
}
