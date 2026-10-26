import { isAllowlistedHost, isAllowlistedUrl } from '@/lib/networking/allowlists';
import { inferAccess } from '@/lib/networking/access';
import { METRO_PROFILES, resolveMetro } from '@/lib/networking/cities';
import {
  FORMAT_DROP_KEYWORDS,
  FORMAT_KEEP_KEYWORDS,
  haystackOf,
  matchesAny,
  matchesTech,
  matchingIndustries,
} from '@/lib/networking/taxonomy';
import type {
  Bucket,
  CandidateEvent,
  ClassifyResult,
  ReasonCode,
} from '@/lib/networking/types';

export const WINDOW_DAYS = 90;

export type ClassifyOptions = {
  now?: Date;
  windowDays?: number;
  /** Force-add: skip ICP and format, still reject online and outside metro. */
  force?: boolean;
};

function isOnlineOnly(candidate: CandidateEvent): boolean {
  if (candidate.isHybrid) return false;
  if (candidate.isOnline) return true;
  const hasPlace =
    Boolean(candidate.venueName?.trim()) ||
    Boolean(candidate.address?.trim()) ||
    Boolean(candidate.city?.trim()) ||
    (candidate.lat != null && candidate.lng != null);
  return !hasPlace;
}

function inWindow(start: Date, now: Date, windowDays: number): boolean {
  if (Number.isNaN(start.getTime())) return false;
  if (start.getTime() < now.getTime() - 60 * 60 * 1000) return false;
  const max = now.getTime() + windowDays * 24 * 60 * 60 * 1000;
  return start.getTime() <= max;
}

function isTrusted(candidate: CandidateEvent): boolean {
  return (
    candidate.trusted ||
    isAllowlistedUrl(candidate.url) ||
    isAllowlistedHost(candidate.hostName)
  );
}

export function classifyCandidate(
  candidate: CandidateEvent,
  options: ClassifyOptions = {},
): ClassifyResult {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? WINDOW_DAYS;
  const reasons: ReasonCode[] = [];
  const trusted = isTrusted(candidate) || Boolean(options.force);

  if (isOnlineOnly(candidate)) reasons.push('online_only');
  if (!inWindow(candidate.startAt, now, windowDays)) reasons.push('outside_window');

  const metro = resolveMetro({
    city: candidate.city,
    address: candidate.address,
    venueName: candidate.venueName,
    region: candidate.region,
    lat: candidate.lat,
    lng: candidate.lng,
  });
  if (!metro) reasons.push('outside_metro');

  // Luma discover gives no description, so the calendar and host names carry most of the ICP
  // evidence ("Tough Tech Week", "The Engine"). Title alone rejected 156 of 275 in W43.
  // Host bios are never read: most say "founder", which kept 151 off-ICP Luma events (a sound
  // bath, a beach party) in the 2026-10-21 dry run.
  const hay = haystackOf([
    candidate.title,
    candidate.description,
    candidate.hostName,
    candidate.organizerName,
    ...(candidate.hosts ?? []).map((host) => host.name),
    candidate.venueName,
    candidate.city,
  ]);

  const tech = matchesTech(hay);
  const industries = matchingIndustries(hay);
  const vertical = industries.length > 0;

  if (!trusted && !options.force) {
    if (matchesAny(hay, FORMAT_DROP_KEYWORDS) && !vertical) {
      reasons.push('format_mismatch');
    } else if (!matchesAny(hay, FORMAT_KEEP_KEYWORDS) && !tech && !vertical) {
      reasons.push('format_mismatch');
    }
    if (!tech && !vertical) reasons.push('icp_mismatch');
  }

  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length > 0) {
    return { keep: false, reject: { candidate, reasonCodes: uniqueReasons } };
  }

  let bucket: Bucket = 'tech';
  if (tech && vertical) bucket = 'both';
  else if (vertical && !tech) bucket = 'vertical';
  else if (!tech && !vertical && trusted) bucket = 'tech';

  const access = inferAccess(candidate);
  return {
    keep: true,
    event: {
      ...candidate,
      // Meetup and conference rows carry no timezone; the metro's zone keeps local dates right.
      timezone: candidate.timezone || METRO_PROFILES[metro!].timezone,
      metro: metro!,
      attendance: candidate.isHybrid ? 'hybrid' : 'in_person',
      access: access.access,
      accessEvidence: access.evidence,
      bucket,
      industries,
    },
  };
}
