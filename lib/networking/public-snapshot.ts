import { createHash } from 'node:crypto';

import { cleanEventTitle } from '@/lib/ai-events/title';
import { maybeFireDeployHook, type DeployHookOutcome } from '@/lib/networking/deploy-hook';
import {
  EVENTS_FEED_OBJECT,
  livePublicFeedStorageConfig,
  publicFeedUrl,
  uploadPublicFeed,
  type PublicFeedStorageConfig,
} from '@/lib/networking/public-feed-storage';
import { listKeptEvents, liveNetworkingQuery, type NetworkingQuery } from '@/lib/networking/repository';
import { isoWeekKey } from '@/lib/networking/schedule';
import { METROS, type Metro, type StoredNetworkingEvent } from '@/lib/networking/types';

/**
 * Public events snapshot (AI Events plan M3): the JSON heliosgroup.ai/free-tools/ai-networking-events
 * reads, schemaVersion 1. The contract is mirrored on the website in
 * src/app/components/events/types.ts; change both together.
 *
 * What is published: scheduled tech or both-bucket events in the four metros from now to +60 days
 * (AE-10), with a cleaned title, a short plain-text summary, public organizer and host names and
 * the RSVP link. Never published: access evidence, raw payloads, database ids or fingerprints,
 * host bios or LinkedIn handles, Luma featured guests (never stored, AE-21), or any score.
 *
 * Reads networking.* (and ai_events.pool for the picks, when that table exists) and writes only
 * networking.publish_state. No model calls.
 */

export const PUBLIC_FEED_METROS = ['miami', 'boston', 'nyc', 'sf'] as const satisfies readonly Metro[];
export const PUBLIC_METRO_INFO: Record<Metro, { label: string; shortLabel: string; timezone: string }> = {
  miami: { label: 'Miami', shortLabel: 'Miami', timezone: 'America/New_York' },
  boston: { label: 'Boston', shortLabel: 'Boston', timezone: 'America/New_York' },
  nyc: { label: 'New York', shortLabel: 'NYC', timezone: 'America/New_York' },
  sf: { label: 'SF Bay Area', shortLabel: 'SF', timezone: 'America/Los_Angeles' },
};

export const SNAPSHOT_WINDOW_DAYS = 60;
export const SUMMARY_MAX_CHARS = 280;
export const MAX_PUBLIC_HOSTS = 8;
export const MAX_PUBLIC_TAGS = 6;
/** Ranked events per city that get a badge on the site: #1 gold, #2 silver, #3 bronze (AE-32). */
export const MAX_PICKS_PER_METRO = 3;
/** `networking.publish_state` row of this feed. */
export const EVENTS_FEED_STATE_ID = 'events.v1';
/** The zone that decides which Mon-Sun is "this week" (the post is Sunday evening ET, AE-08). */
const WEEK_TIMEZONE = 'America/New_York';

// ---------- Contract (schemaVersion 1) ----------

export type PublicMetroId = (typeof PUBLIC_FEED_METROS)[number];
export type PublicEventAccess = 'open' | 'approval' | 'apply';

export type PublicEvent = {
  id: string;
  title: string;
  summary: string | null;
  start: string;
  end: string | null;
  timezone: string;
  metro: PublicMetroId;
  city: string | null;
  venue: string | null;
  address: string | null;
  price: { free: boolean | null; minCents: number | null; maxCents: number | null; currency: string | null };
  access: PublicEventAccess;
  demand: { soldOut: boolean; waitlist: boolean; going: number | null };
  organizer: string | null;
  hosts: string[];
  tags: string[];
  rsvpUrl: string;
  pick: { rank: number; week: string } | null;
};

export type PublicFeedWeek = { key: string; start: string; end: string; picksPublished: boolean };

export type PublicEventsFeed = {
  schemaVersion: 1;
  generatedAt: string;
  metros: { id: PublicMetroId; label: string; shortLabel: string; timezone: string }[];
  week: PublicFeedWeek | null;
  events: PublicEvent[];
};

/**
 * One picked row of ai_events.pool, as the snapshot needs it. `pickRank` is the pick's place in
 * its city (pins first, as on the carousel); `rank` is the pool's score order, the fallback.
 */
export type PoolPick = { weekKey: string; eventId: string; metro: Metro; rank: number | null; pickRank?: number | null };

// ---------- Weeks ----------

/** YYYY-MM-DD of `now` in `timeZone`. */
function zonedDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekFrom(monday: string): Omit<PublicFeedWeek, 'picksPublished'> {
  const [y, m, d] = monday.split('-').map(Number);
  return { key: isoWeekKey(new Date(y, m - 1, d, 12)), start: monday, end: addDays(monday, 6) };
}

/**
 * The week the Sunday post covers (`coming`: the next Monday after today, ET; on a Sunday that is
 * tomorrow) and the week in progress (`current`), whose picks stay on the site until it ends.
 */
export function snapshotWeeks(now: Date): { coming: Omit<PublicFeedWeek, 'picksPublished'>; current: Omit<PublicFeedWeek, 'picksPublished'> } {
  const today = zonedDate(now, WEEK_TIMEZONE);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const sinceMonday = (weekday + 6) % 7;
  const currentMonday = addDays(today, -sinceMonday);
  return { coming: weekFrom(addDays(currentMonday, 7)), current: weekFrom(currentMonday) };
}

// ---------- Field mappers ----------

/** Stable opaque id: no fingerprint or database id leaves the hub. */
export function publicEventId(fingerprint: string): string {
  return createHash('sha256').update(`events.v1:${fingerprint}`).digest('hex').slice(0, 16);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/**
 * Plain text from a listing description (HTML, Markdown or ProseMirror text), at most 280
 * characters, cut at a word boundary with an ellipsis. Links, images, emoji and formatting go.
 */
export function plainSummary(description: string | null | undefined, max = SUMMARY_MAX_CHARS): string | null {
  let s = description ?? '';
  s = s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      const key = name.toLowerCase();
      if (ENTITIES[key] !== undefined) return ENTITIES[key];
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16) || 32);
      if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)) || 32);
      return whole;
    })
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+•]|\d+[.)])\s+/gm, '')
    .replace(/\*{1,3}|_{2,}|`+|~{2,}/g, '')
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  const head = space >= Math.floor(max * 0.6) ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,;:.\-–—]+$/, '')}…`;
}

/** Invitation or application wording: "Apply to attend" on the site (AE-11). */
const APPLY_CUES = /\b(invite[- ]only|invitation[- ]only|by invitation|invitation required|application required|apply to attend|apply to join|request (an )?invit(e|ation)|members[- ]only)\b/i;
/** Approval wording alone: the host confirms each RSVP, which is an approval, not an application. */
const APPROVAL_CUES = /\b(approval required|requires approval|require approval|guest list)\b/i;

/**
 * `apply` for invite or application events (stored `invite_only`, or the cues in the listing),
 * `approval` when the host approves each RSVP, else `open`. An `invite_only` row whose only cue
 * is approval wording is an approval.
 */
export function publicAccess(
  e: Pick<StoredNetworkingEvent, 'access' | 'requiresApproval' | 'title' | 'description'>,
): PublicEventAccess {
  const text = `${e.title ?? ''} ${e.description ?? ''}`;
  if (APPLY_CUES.test(text)) return 'apply';
  if (e.access === 'invite_only' && !(APPROVAL_CUES.test(text) || e.requiresApproval === true)) return 'apply';
  if (e.requiresApproval === true || e.access === 'invite_only') return 'approval';
  return 'open';
}

/** Topic tags from the source's own filing (Luma categories and calendar tags, Meetup topics). */
export function publicTags(sourceTags: readonly string[]): string[] {
  const out: string[] = [];
  for (const tag of sourceTags) {
    const match = /^(category|calendar_tag|topic):(.+)$/.exec(tag);
    if (!match) continue;
    const value = match[2].replace(/[-_]+/g, ' ').trim().toLowerCase();
    if (value && value.length <= 40 && !out.includes(value)) out.push(value);
    if (out.length >= MAX_PUBLIC_TAGS) break;
  }
  return out;
}

/** Only http(s) links are published. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function hostNames(e: StoredNetworkingEvent): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const host of e.hosts ?? []) {
    const name = typeof host?.name === 'string' ? host.name.replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > 120 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
    if (names.length >= MAX_PUBLIC_HOSTS) break;
  }
  return names;
}

function isPublicMetro(metro: string): metro is PublicMetroId {
  return (PUBLIC_FEED_METROS as readonly string[]).includes(metro);
}

/** One stored event as the site shows it, or null when it has no usable RSVP link or title. */
export function toPublicEvent(e: StoredNetworkingEvent, pick: PublicEvent['pick']): PublicEvent | null {
  if (!isPublicMetro(e.metro)) return null;
  const rsvpUrl = safeHttpUrl(e.canonicalUrl) ?? e.listings.map((l) => safeHttpUrl(l.url)).find(Boolean) ?? null;
  const title = cleanEventTitle(e.title ?? '');
  if (!rsvpUrl || !title) return null;
  const minCents = e.priceMinCents ?? null;
  const maxCents = e.priceMaxCents ?? null;
  const paid = e.access === 'paid' || (minCents ?? 0) > 0;
  return {
    id: publicEventId(e.fingerprint),
    title,
    summary: plainSummary(e.description),
    start: new Date(e.startAt).toISOString(),
    end: e.endAt ? new Date(e.endAt).toISOString() : null,
    timezone: e.timezone || PUBLIC_METRO_INFO[e.metro].timezone,
    metro: e.metro,
    city: e.city || null,
    venue: e.venueName || null,
    address: e.address || null,
    price: {
      free: e.isFree ?? (paid ? false : null),
      minCents,
      maxCents,
      currency: e.priceCurrency || null,
    },
    access: publicAccess(e),
    demand: { soldOut: e.isSoldOut === true, waitlist: e.waitlistActive === true, going: e.guestCount ?? null },
    organizer: e.organizerName || e.hostName || null,
    hosts: hostNames(e),
    tags: publicTags(e.sourceTags ?? []),
    rsvpUrl,
    pick,
  };
}

// ---------- The feed ----------

/**
 * The week whose picks the feed carries: the coming week once its pool has picks, else the week in
 * progress while its picks last, else the coming week with `picksPublished: false`.
 */
export function chooseWeek(picks: readonly PoolPick[], now: Date): PublicFeedWeek {
  const { coming, current } = snapshotWeeks(now);
  for (const week of [coming, current]) {
    if (picks.some((p) => p.weekKey === week.key)) return { ...week, picksPublished: true };
  }
  return { ...coming, picksPublished: false };
}

/**
 * Pick ranks 1..3 per city for `weekKey`, keyed by event id: the carousel's pick order
 * (`pickRank`, pins first), then pool rank, then event id.
 */
export function pickRanks(picks: readonly PoolPick[], weekKey: string): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const metro of METROS) {
    const inMetro = picks
      .filter((p) => p.weekKey === weekKey && p.metro === metro)
      .sort(
        (a, b) =>
          (a.pickRank ?? Infinity) - (b.pickRank ?? Infinity) ||
          (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
          a.eventId.localeCompare(b.eventId),
      );
    inMetro.slice(0, MAX_PICKS_PER_METRO).forEach((p, i) => ranks.set(p.eventId, i + 1));
  }
  return ranks;
}

/** Pure: stored events and pool picks to the public feed at `now`. */
export function buildPublicFeed(rows: readonly StoredNetworkingEvent[], picks: readonly PoolPick[], now: Date): PublicEventsFeed {
  const from = now.getTime();
  const to = from + SNAPSHOT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const week = chooseWeek(picks, now);
  const ranks = week.picksPublished ? pickRanks(picks, week.key) : new Map<string, number>();

  const events: PublicEvent[] = [];
  const seen = new Set<string>();
  for (const e of rows) {
    const start = Date.parse(e.startAt);
    if (e.status !== 'scheduled' || !(start >= from && start <= to)) continue;
    if (e.bucket !== 'tech' && e.bucket !== 'both') continue;
    const rank = ranks.get(e.id);
    const event = toPublicEvent(e, rank ? { rank, week: week.key } : null);
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    metros: PUBLIC_FEED_METROS.map((id) => ({ id, ...PUBLIC_METRO_INFO[id] })),
    week,
    events,
  };
}

/** Hash of the feed's content: `generatedAt` alone never counts as a change. */
export function feedContentHash(feed: PublicEventsFeed): string {
  const { generatedAt: _generatedAt, ...content } = feed;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

export function serializeFeed(feed: PublicEventsFeed): string {
  return JSON.stringify(feed);
}

// ---------- Load and publish ----------

/**
 * Picked rows of ai_events.pool for the given weeks. The table belongs to the AI Events type and
 * may not exist yet: then there are no picks. Excluded rows never count, whatever `picked` says.
 */
export async function loadPoolPicks(q: NetworkingQuery, weekKeys: readonly string[]): Promise<PoolPick[]> {
  const { rows: present } = await q<{ reg: string | null }>(`SELECT to_regclass('ai_events.pool')::text AS reg`);
  if (!present[0]?.reg) return [];
  const { rows } = await q<Record<string, unknown>>(
    `SELECT p.*
       FROM ai_events.pool p
      WHERE p.week_key = ANY ($1::text[])
        AND p.picked IS TRUE`,
    [[...weekKeys]],
  );
  return rows
    .filter((r) => r.excluded_at == null && r.excluded_by == null)
    .map((r) => ({
      weekKey: String(r.week_key),
      eventId: String(r.event_id),
      metro: r.metro as Metro,
      rank: r.rank == null || !Number.isFinite(Number(r.rank)) ? null : Number(r.rank),
      pickRank: r.pick_rank == null || !Number.isFinite(Number(r.pick_rank)) ? null : Number(r.pick_rank),
    }));
}

export async function loadPublicFeedInputs(
  q: NetworkingQuery,
  now: Date,
): Promise<{ rows: StoredNetworkingEvent[]; picks: PoolPick[] }> {
  const { coming, current } = snapshotWeeks(now);
  const [rows, picks] = await Promise.all([
    listKeptEvents(
      { metros: PUBLIC_FEED_METROS, bucket: 'tech', from: now, to: new Date(now.getTime() + SNAPSHOT_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
      q,
    ),
    loadPoolPicks(q, [coming.key, current.key]),
  ]);
  return { rows, picks };
}

export type PublishSnapshotResult = {
  url: string;
  events: number;
  picks: number;
  weekKey: string | null;
  picksPublished: boolean;
  contentHash: string;
  /** False when the content matches the last publish (the upload still refreshes `generatedAt`). */
  changed: boolean;
  hook: DeployHookOutcome;
};

type SnapshotLog = (level: 'info' | 'warn', message: string, fields?: Record<string, unknown>) => void;

const defaultLog: SnapshotLog = (level, message, fields = {}) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, component: 'networking-snapshot', message, ...fields });
  if (level === 'warn') console.warn(line);
  else console.log(line);
};

/**
 * Builds the feed, uploads it to public-feeds/networking/events.v1.json, records the hash on
 * networking.publish_state and, when due, fires the Vercel deploy hook. Called after the
 * networking details job, by the AI Events run and publish step, and from the internal /events
 * "Publish to website" button. Throws when the load or the upload fails (callers decide whether
 * that fails their own work); a failed deploy hook is recorded, never thrown.
 *
 * An empty feed is refused once something has been published, so a broken ingest cannot blank
 * the public calendar; pass `allowEmpty` to publish one anyway.
 */
export async function publishSnapshot(input: {
  q?: NetworkingQuery;
  now?: Date;
  reason: string;
  allowEmpty?: boolean;
  storage?: PublicFeedStorageConfig;
  hookUrl?: string | null;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: SnapshotLog;
}): Promise<PublishSnapshotResult> {
  const q = input.q ?? liveNetworkingQuery;
  const now = input.now ?? new Date();
  const log = input.log ?? defaultLog;
  const storage = input.storage ?? livePublicFeedStorageConfig();

  const { rows, picks } = await loadPublicFeedInputs(q, now);
  const feed = buildPublicFeed(rows, picks, now);
  const contentHash = feedContentHash(feed);

  const { rows: stateRows } = await q<{ last_hash: string | null }>(
    `SELECT last_hash FROM networking.publish_state WHERE id = $1`,
    [EVENTS_FEED_STATE_ID],
  );
  const previousHash = stateRows[0]?.last_hash ?? null;
  if (feed.events.length === 0 && previousHash && !input.allowEmpty) {
    throw new Error('refusing to publish an empty events feed over a published one (pass allowEmpty to force)');
  }

  await uploadPublicFeed(EVENTS_FEED_OBJECT, serializeFeed(feed), { ...storage, fetch: input.fetch ?? storage.fetch, sleep: input.sleep ?? storage.sleep });
  await q(
    `INSERT INTO networking.publish_state (id, last_hash, last_published_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE
       SET last_hash = EXCLUDED.last_hash,
           last_published_at = EXCLUDED.last_published_at`,
    [EVENTS_FEED_STATE_ID, contentHash, now],
  );

  const hook = await maybeFireDeployHook({
    q,
    stateId: EVENTS_FEED_STATE_ID,
    contentHash,
    now,
    hookUrl: input.hookUrl,
    fetch: input.fetch,
    sleep: input.sleep,
  });

  const picked = feed.events.filter((e) => e.pick).length;
  log('info', 'events feed published', {
    reason: input.reason,
    events: feed.events.length,
    picks: picked,
    weekKey: feed.week?.key ?? null,
    changed: previousHash !== contentHash,
  });
  if (!hook.fired) {
    log('info', `deploy hook skipped: ${hook.reason}`, { reason: input.reason, retryAfterMs: hook.retryAfterMs ?? null });
  } else if (!hook.ok) {
    log('warn', 'deploy hook failed', { reason: input.reason, status: hook.status, error: hook.error ?? null });
  } else {
    log('info', 'deploy hook fired', { reason: input.reason, status: hook.status });
  }

  return {
    url: publicFeedUrl(storage.baseUrl),
    events: feed.events.length,
    picks: picked,
    weekKey: feed.week?.key ?? null,
    picksPublished: feed.week?.picksPublished ?? false,
    contentHash,
    changed: previousHash !== contentHash,
    hook,
  };
}
