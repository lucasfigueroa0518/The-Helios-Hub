/**
 * RSVP click tracking (Resource Tracker RT-2). The public events feed on heliosgroup.ai carries each event's RSVP
 * link as a hub link, /api/public/go/rsvp/<public id>. That route counts the click and redirects to the real URL,
 * which the hub stored at publish time (networking.rsvp_links), so the route never redirects anywhere it was not told.
 * Counting starts at the first publish after deploy; the website needs no change.
 */
import type { NetworkingQuery } from '@/lib/networking/repository';
import type { PublicEvent, PublicEventsFeed } from '@/lib/networking/public-snapshot';

/** Production hub origin, used when HELIOS_PUBLIC_URL is unset (the GCP workers publish the feed too). */
export const DEFAULT_HUB_ORIGIN = 'https://www.heliosgroup.tech';
export const RSVP_PATH = '/api/public/go/rsvp/';
/** Where an unknown or expired id lands: the public calendar. */
export const CALENDAR_URL = 'https://heliosgroup.ai/free-tools/ai-networking-events';

const isLocal = (origin: string) => /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(origin);

export function rsvpOrigin(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.HELIOS_PUBLIC_URL?.trim();
  return explicit && !isLocal(explicit) ? explicit.replace(/\/$/, '') : DEFAULT_HUB_ORIGIN;
}

export function trackedRsvpUrl(origin: string, publicId: string): string {
  return `${origin}${RSVP_PATH}${encodeURIComponent(publicId)}`;
}

export type RsvpLink = { publicId: string; url: string; title: string; metro: string; start: string };

/** The feed with every rsvpUrl swapped for its tracked hub link, and the links the redirect needs. */
export function withTrackedRsvp(feed: PublicEventsFeed, origin: string): { feed: PublicEventsFeed; links: RsvpLink[] } {
  const links: RsvpLink[] = [];
  const events: PublicEvent[] = feed.events.map((e) => {
    links.push({ publicId: e.id, url: e.rsvpUrl, title: e.title, metro: e.metro, start: e.start });
    return { ...e, rsvpUrl: trackedRsvpUrl(origin, e.id) };
  });
  return { feed: { ...feed, events }, links };
}

export async function saveRsvpLinks(q: NetworkingQuery, links: readonly RsvpLink[], now: Date): Promise<void> {
  if (!links.length) return;
  await q(
    `INSERT INTO networking.rsvp_links (public_id, url, title, metro, start_at, updated_at)
     SELECT x.public_id, x.url, x.title, x.metro, x.start_at, $2::timestamptz
       FROM jsonb_to_recordset($1::jsonb) AS x(public_id text, url text, title text, metro text, start_at timestamptz)
     ON CONFLICT (public_id) DO UPDATE
       SET url = EXCLUDED.url, title = EXCLUDED.title, metro = EXCLUDED.metro, start_at = EXCLUDED.start_at, updated_at = EXCLUDED.updated_at`,
    [JSON.stringify(links.map((l) => ({ public_id: l.publicId, url: l.url, title: l.title, metro: l.metro, start_at: l.start }))), now.toISOString()],
  );
}

/** Crawlers, link unfurlers and uptime checks: their hits are stored but never counted. */
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|slack|discord|skype|curl|wget|python-requests|httpclient|headless|lighthouse|monitor|vercel-screenshot/i;

export function isBotAgent(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT_UA.test(userAgent);
}

export function referrerHost(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).hostname.slice(0, 200) || null;
  } catch {
    return null;
  }
}

const PUBLIC_ID = /^[0-9a-f]{16}$/;

/** The redirect: count the click (best effort) and return where to send the person. */
export async function followRsvp(q: NetworkingQuery, publicId: string, req: { userAgent: string | null; referer: string | null }): Promise<string> {
  if (!PUBLIC_ID.test(publicId)) return CALENDAR_URL;
  const { rows } = await q<{ url: string }>(`SELECT url FROM networking.rsvp_links WHERE public_id = $1`, [publicId]);
  const url = rows[0]?.url;
  if (!url) return CALENDAR_URL;
  try {
    await q(`INSERT INTO networking.rsvp_clicks (public_id, bot, referrer_host) VALUES ($1, $2, $3)`, [publicId, isBotAgent(req.userAgent), referrerHost(req.referer)]);
  } catch {
    // Counting must never stop the person reaching the event.
  }
  return url;
}
