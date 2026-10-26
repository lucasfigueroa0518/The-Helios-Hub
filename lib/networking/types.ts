export const METROS = ['boston', 'miami', 'nyc', 'sf'] as const;
export type Metro = (typeof METROS)[number];
/** Metros shown on the internal /events calendar. NYC and SF feed the public surfaces only. */
export const INTERNAL_METROS = ['boston', 'miami'] as const satisfies readonly Metro[];
export type InternalMetro = (typeof INTERNAL_METROS)[number];

export function isInternalMetro(value: unknown): value is InternalMetro {
  return (INTERNAL_METROS as readonly unknown[]).includes(value);
}

export const ATTENDANCE_MODES = ['in_person', 'hybrid', 'online'] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export const ACCESS_TYPES = ['open', 'paid', 'invite_only'] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];

export const BUCKETS = ['tech', 'vertical', 'both'] as const;
export type Bucket = (typeof BUCKETS)[number];

export const EVENT_STATUSES = ['scheduled', 'cancelled', 'expired'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const REASON_CODES = [
  'outside_metro',
  'online_only',
  'outside_window',
  'format_mismatch',
  'icp_mismatch',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const NETWORKING_SOURCES = [
  'luma',
  'meetup',
  'eventbrite',
  'ics',
  'bevy',
  'conferences',
  'url',
] as const;
export type NetworkingSource = (typeof NETWORKING_SOURCES)[number] | string;

/**
 * Who runs the event. `luma_person` is a personal Luma calendar, named after its first host.
 * Stored as text in `networking.events.organizer_kind`.
 */
export const ORGANIZER_KINDS = ['luma_calendar', 'luma_person', 'meetup_group', 'gdg_chapter', 'conference'] as const;
export type OrganizerKind = (typeof ORGANIZER_KINDS)[number];

/** A listed host or co-host: public organizer information only. Luma `featured_guests` (attendees) are never kept. */
export type EventHost = {
  name: string;
  bioShort?: string;
  /** As the source gives it, e.g. "/in/jane-doe" or "/company/acme". */
  linkedin?: string;
  isVerified?: boolean;
};

/** At most this many hosts are kept per event. */
export const MAX_HOSTS = 8;

/**
 * Source evidence with no column of its own (`networking.events.signals` jsonb). Every key is
 * optional: absent means the source did not say.
 */
export type EventSignalExtras = {
  /** Luma `ticket_info.is_near_capacity`. */
  nearCapacity?: boolean;
  /** Meetup event page WAITLIST count. */
  waitlistCount?: number;
  /** Luma `registration_availability` ("open", "sold-out", ...). */
  registration?: string;
  /** Luma community calendar, resolved once per details run for the organizer track record. */
  lumaCalendarApiId?: string;
  lumaCalendarSlug?: string;
  lumaCalendarVerified?: boolean;
  /** Future events on the organizer's Luma calendar when the details job resolved it. */
  organizerUpcomingCount?: number;
  meetupGroupUrlname?: string;
  /** Meetup `maxTickets` when set (0 means no limit). */
  meetupMaxTickets?: number;
  /** Meetup recurring series description ("Every week on Sunday"). */
  recurrence?: string;
  /** Organizer poster (Luma `cover_url`, Meetup featured photo) for the rank slide. */
  coverUrl?: string;
};

/**
 * Upcoming-event quality signals read straight from the source, no LLM. Optional on candidates:
 * undefined means unknown. Kept flat (not nested) so the copy merge in `adapters/merge.ts` and
 * the cross-source merge in `dedupe.ts` can take each field from the copy that has it.
 */
export type CandidateSignals = {
  organizerName?: string;
  organizerKind?: OrganizerKind;
  organizerUrl?: string;
  hosts?: EventHost[];
  /** Going count. Undefined when the source hides it (Luma `show_guest_list: false` reports 0). */
  guestCount?: number;
  capacity?: number;
  spotsRemaining?: number;
  isSoldOut?: boolean;
  waitlistActive?: boolean;
  requiresApproval?: boolean;
  isFree?: boolean;
  priceMinCents?: number;
  priceMaxCents?: number;
  /** ISO currency code, upper case. */
  priceCurrency?: string;
  /** Past events on the organizer's calendar (Luma). */
  organizerEventCount?: number;
  organizerMemberCount?: number;
  organizerRating?: number;
  organizerRatingCount?: number;
  /** Same organizer or recurring series: `luma:<calendar api id>`, `luma-series:<recurrence id>`, `meetup:<urlname>`. */
  seriesKey?: string;
  /**
   * Where the event was found and how the source files it, lower case: `discover:<slug>`,
   * `luma_calendar:<slug>`, `calendar_tag:<name>`, `category:<slug>`, `topic:<urlkey>`,
   * `conference:<source>`.
   */
  sourceTags?: string[];
  /** The listing sends people elsewhere to RSVP or pay ("PAID EVENT RSVP HERE ==>"). */
  rsvpOffsite?: boolean;
  /** Which fetch produced `description`: `meetup`, `bevy`, `luma_event_get`, `meetup_event_page`, ... */
  descriptionSource?: string;
  signals?: EventSignalExtras;
  /** Trimmed upstream payload for `event_listings.raw`. Never holds attendee lists. */
  raw?: Record<string, unknown>;
};

export type CandidateEvent = CandidateSignals & {
  source: string;
  sourceEventId: string;
  title: string;
  description: string;
  url: string;
  startAt: Date;
  endAt?: Date;
  timezone?: string;
  venueName?: string;
  address?: string;
  city?: string;
  /** State or province from the source (e.g. "NY", "California"). Used only to disambiguate the metro; not persisted. */
  region?: string;
  lat?: number;
  lng?: number;
  isOnline: boolean;
  isHybrid?: boolean;
  hostName?: string;
  priceText?: string;
  /** Dollars, read by `inferAccess`. Cents live in `priceMinCents`/`priceMaxCents`. */
  priceAmount?: number;
  /** Allowlisted calendar/group/ICS — skip ICP/format, still require geo/date/in-person. */
  trusted: boolean;
};

export type ClassifiedEvent = CandidateEvent & {
  metro: Metro;
  attendance: 'in_person' | 'hybrid';
  access: AccessType;
  accessEvidence: string | null;
  bucket: Bucket;
  industries: string[];
};

export type RejectedEvent = {
  candidate: CandidateEvent;
  reasonCodes: ReasonCode[];
};

export type ClassifyResult =
  | { keep: true; event: ClassifiedEvent }
  | { keep: false; reject: RejectedEvent };

export type StoredNetworkingEvent = {
  id: string;
  fingerprint: string;
  title: string;
  description: string;
  canonicalUrl: string;
  listingUrls: string[];
  startAt: string;
  endAt: string | null;
  timezone: string | null;
  venueName: string | null;
  address: string | null;
  city: string | null;
  metro: Metro;
  lat: number | null;
  lng: number | null;
  attendance: 'in_person' | 'hybrid';
  access: AccessType;
  accessEvidence: string | null;
  bucket: Bucket;
  industries: string[];
  hostName: string | null;
  status: EventStatus;
  listings: Array<{ source: string; sourceEventId: string; url: string }>;
  firstSeenAt: string;
  lastSeenAt: string;
  organizerName: string | null;
  organizerKind: OrganizerKind | null;
  organizerUrl: string | null;
  hosts: EventHost[];
  guestCount: number | null;
  capacity: number | null;
  spotsRemaining: number | null;
  isSoldOut: boolean | null;
  waitlistActive: boolean | null;
  requiresApproval: boolean | null;
  isFree: boolean | null;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  priceCurrency: string | null;
  organizerEventCount: number | null;
  organizerMemberCount: number | null;
  organizerRating: number | null;
  organizerRatingCount: number | null;
  seriesKey: string | null;
  sourceTags: string[];
  rsvpOffsite: boolean | null;
  signals: EventSignalExtras;
  descriptionSource: string | null;
  detailsFetchedAt: string | null;
};

/** A conference or tech week that nearby events can be satellites of (`networking.anchors`). */
export type EventAnchor = {
  name: string;
  metro: Metro;
  /** Local calendar day, "YYYY-MM-DD". */
  startsOn: string;
  endsOn: string | null;
  url: string | null;
  source: string;
};

export type IngestSourceResult = {
  source: string;
  fetched: number;
  kept: number;
  rejected: number;
  error?: string;
};

export type IngestRunSummary = {
  id: string;
  weekKey: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  sourceResults: IngestSourceResult[];
  keptCount: number;
  rejectedCount: number;
  error: string | null;
};

export type AdapterFetchResult = {
  source: string;
  events: CandidateEvent[];
  /** Conference rows double as satellite anchors (conferences adapter only). */
  anchors?: EventAnchor[];
  error?: string;
};
