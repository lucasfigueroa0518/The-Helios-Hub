/**
 * event-pick's code terms, score v2 (AE-30): read from the stored signals, no model. Worth 6 of
 * the score's 10 points. Each adds to the score as computed here; score.ts sums them with the
 * Jev answers.
 *
 *   attendance    2 × min(1, log2(1 + going) / log2(251)): full at 250 going. When the host
 *                 hides the count, capacity minus spots remaining stands in.
 *   demand        1.5 × the strongest of: sold out or waitlist 1, near capacity .6, requires
 *                 approval .4. Known only when the source reports ticket state (Luma, Meetup).
 *   track_record  1.5 × the larger of: min(1, log2(1 + past events) / log2(51)), where past
 *                 events is the larger of the source's count and our own count of the
 *                 organizer's past events (never their sum); and 1 for a Meetup rating of 4.5 or
 *                 better over 50 or more ratings.
 *   roster        .5 when the organizer or a host is on the city's anchor roster.
 *   satellite     .5 when the event's local day is within 3 days of a same-city anchor.
 *
 * Missing data is neutral (AE-31): attendance, demand or track record with no data takes the
 * city's median for that term over the week's events where it is known (`imputeTerms`).
 */
import type { EventAnchor, StoredNetworkingEvent } from '@/lib/networking/types';

import { rosterMatch, type AnchorRosterNumber, CURRENT_ANCHOR_ROSTER } from './anchors-roster';
import { nearbyAnchor } from './tech-weeks';

export const ATTENDANCE_POINTS = 2;
export const ATTENDANCE_FULL_AT = 250;
export const DEMAND_MAX_POINTS = 1.5;
export const DEMAND_LEVELS = { soldOut: 1, waitlist: 1, nearCapacity: 0.6, requiresApproval: 0.4 } as const;
export const DEMAND_POINTS = {
  soldOut: DEMAND_MAX_POINTS * DEMAND_LEVELS.soldOut,
  waitlist: DEMAND_MAX_POINTS * DEMAND_LEVELS.waitlist,
  nearCapacity: DEMAND_MAX_POINTS * DEMAND_LEVELS.nearCapacity,
  requiresApproval: DEMAND_MAX_POINTS * DEMAND_LEVELS.requiresApproval,
} as const;
export const TRACK_RECORD_POINTS = 1.5;
export const TRACK_RECORD_FULL_AT = 50;
export const TRACK_RECORD_MIN_RATING = 4.5;
export const TRACK_RECORD_MIN_RATINGS = 50;
export const ROSTER_POINTS = 0.5;
export const SATELLITE_POINTS = 0.5;
export const CODE_MAX = ATTENDANCE_POINTS + DEMAND_MAX_POINTS + TRACK_RECORD_POINTS + ROSTER_POINTS + SATELLITE_POINTS;

export type DemandReason = keyof typeof DEMAND_LEVELS;
/** The terms that can be missing and are then imputed. */
export const IMPUTED_TERMS = ['attendance', 'demand', 'trackRecord'] as const;
export type ImputedTerm = (typeof IMPUTED_TERMS)[number];

export type CodeTerms = {
  /** The going count behind `attendance` (or capacity minus spots left), null when unknown. */
  going: number | null;
  /** True when `going` came from capacity minus spots remaining. */
  goingFromCapacity?: boolean;
  attendance: number;
  demand: number;
  /** Which signal earned `demand`, or null. */
  demandReason: DemandReason | null;
  roster: number;
  /** The roster name matched, or null. */
  rosterMatch: string | null;
  satellite: number;
  /** The anchor the event sits near, or null. */
  anchor: EventAnchor | null;
  trackRecord: number;
  /** What earned `trackRecord`, in words ("34 past events"), or null. */
  trackRecordDetail: string | null;
  /** Terms with no data. Before `imputeTerms` they read 0; after, the city median. */
  missing?: ImputedTerm[];
  /** Terms filled with the city median by `imputeTerms`. */
  imputed?: ImputedTerm[];
};

/** Attendance points for a going count (0 for none or unknown). */
export function attendanceTerm(going: number | null | undefined): number {
  if (going == null || !Number.isFinite(going) || going <= 0) return 0;
  return ATTENDANCE_POINTS * Math.min(1, Math.log2(1 + going) / Math.log2(1 + ATTENDANCE_FULL_AT));
}

type GoingSignals = Pick<StoredNetworkingEvent, 'guestCount' | 'capacity' | 'spotsRemaining'>;

/** The going count, else capacity minus spots remaining, else null (unknown). */
export function goingCount(event: GoingSignals): { going: number | null; fromCapacity: boolean } {
  if (event.guestCount != null && event.guestCount > 0) return { going: event.guestCount, fromCapacity: false };
  if (event.capacity != null && event.spotsRemaining != null && event.capacity > 0 && event.spotsRemaining >= 0) {
    const taken = event.capacity - event.spotsRemaining;
    if (taken > 0) return { going: taken, fromCapacity: true };
  }
  return { going: null, fromCapacity: false };
}

type DemandSignals = Pick<StoredNetworkingEvent, 'isSoldOut' | 'waitlistActive' | 'requiresApproval' | 'signals'>;

/** `known` is false when the source reports no ticket state at all. */
export function demandTerm(event: DemandSignals): { points: number; reason: DemandReason | null; known: boolean } {
  if (event.isSoldOut) return { points: DEMAND_POINTS.soldOut, reason: 'soldOut', known: true };
  if (event.waitlistActive) return { points: DEMAND_POINTS.waitlist, reason: 'waitlist', known: true };
  if (event.signals?.nearCapacity) return { points: DEMAND_POINTS.nearCapacity, reason: 'nearCapacity', known: true };
  if (event.requiresApproval) return { points: DEMAND_POINTS.requiresApproval, reason: 'requiresApproval', known: true };
  const known = event.isSoldOut != null || event.waitlistActive != null || event.signals?.nearCapacity != null;
  return { points: 0, reason: null, known };
}

type RosterSignals = Pick<StoredNetworkingEvent, 'metro' | 'organizerName' | 'hostName' | 'hosts' | 'signals'>;

/** Every name the roster is matched against: organizer, hosts, calendar slug, Meetup urlname. */
export function rosterNames(event: RosterSignals): string[] {
  return [
    event.organizerName,
    event.hostName,
    ...(event.hosts ?? []).map((h) => h.name),
    event.signals?.lumaCalendarSlug,
    event.signals?.meetupGroupUrlname,
  ].filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
}

export function rosterTerm(event: RosterSignals, roster: AnchorRosterNumber = CURRENT_ANCHOR_ROSTER): { points: number; match: string | null } {
  const match = rosterMatch(event.metro, rosterNames(event), roster);
  return { points: match ? ROSTER_POINTS : 0, match };
}

type TrackSignals = Pick<StoredNetworkingEvent, 'organizerEventCount' | 'organizerRating' | 'organizerRatingCount'>;

/**
 * `ownPast` is our own count of the organizer's past events (networking.events, one row per
 * deduped event). It and the source's count describe the same events, so the larger is used.
 */
export function trackRecordTerm(event: TrackSignals, ownPast = 0): { points: number; detail: string | null; known: boolean } {
  const source = event.organizerEventCount ?? 0;
  const past = Math.max(source, ownPast);
  const byCount = past > 0 ? Math.min(1, Math.log2(1 + past) / Math.log2(1 + TRACK_RECORD_FULL_AT)) : 0;
  const rating = event.organizerRating;
  const ratings = event.organizerRatingCount ?? 0;
  const byRating = rating != null && rating >= TRACK_RECORD_MIN_RATING && ratings >= TRACK_RECORD_MIN_RATINGS ? 1 : 0;
  const known = past > 0 || (rating != null && ratings > 0);
  if (!known) return { points: 0, detail: null, known: false };
  const detail =
    byRating > byCount
      ? `${rating!.toFixed(1)} rating over ${ratings}`
      : past > 0
        ? `${past} past events${ownPast > source ? ' (our records)' : ''}`
        : `${rating!.toFixed(1)} rating over ${ratings}`;
  return { points: TRACK_RECORD_POINTS * Math.max(byCount, byRating), detail, known };
}

export function codeTerms(
  event: StoredNetworkingEvent,
  context: { localDay: string; anchors: readonly EventAnchor[]; roster?: AnchorRosterNumber; ownPast?: number },
): CodeTerms {
  const { going, fromCapacity } = goingCount(event);
  const demand = demandTerm(event);
  const roster = rosterTerm(event, context.roster);
  const anchor = nearbyAnchor(event.metro, context.localDay, context.anchors);
  const track = trackRecordTerm(event, context.ownPast ?? 0);
  const missing: ImputedTerm[] = [];
  if (going == null) missing.push('attendance');
  if (!demand.known) missing.push('demand');
  if (!track.known) missing.push('trackRecord');
  return {
    going,
    ...(fromCapacity ? { goingFromCapacity: true } : {}),
    attendance: attendanceTerm(going),
    demand: demand.points,
    demandReason: demand.reason,
    roster: roster.points,
    rosterMatch: roster.match,
    satellite: anchor ? SATELLITE_POINTS : 0,
    anchor,
    trackRecord: track.points,
    trackRecordDetail: track.detail,
    missing,
  };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The median of each imputed term over the terms where it is known (0 when none is). */
export function termMedians(all: readonly CodeTerms[]): Record<ImputedTerm, number> {
  const out = {} as Record<ImputedTerm, number>;
  for (const t of IMPUTED_TERMS) out[t] = median(all.filter((x) => !x.missing?.includes(t)).map((x) => x[t]));
  return out;
}

/** AE-31: each missing term takes the given median; returns new objects. */
export function imputeTerms<T extends CodeTerms>(terms: T, medians: Record<ImputedTerm, number>): T {
  const missing = terms.missing ?? [];
  if (!missing.length) return terms;
  const out = { ...terms, imputed: [...missing] };
  for (const t of missing) out[t] = medians[t];
  return out;
}
