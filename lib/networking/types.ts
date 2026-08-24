export const METROS = ['boston', 'miami'] as const;
export type Metro = (typeof METROS)[number];

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

export type CandidateEvent = {
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
  lat?: number;
  lng?: number;
  isOnline: boolean;
  isHybrid?: boolean;
  hostName?: string;
  priceText?: string;
  isFree?: boolean;
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
  error?: string;
};
