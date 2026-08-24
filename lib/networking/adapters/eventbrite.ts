import { cleanLocation } from '@/lib/networking/cities';
import { fetchText } from '@/lib/networking/http';
import type { AdapterFetchResult, CandidateEvent } from '@/lib/networking/types';

const BASE_URL = 'https://www.eventbrite.com/d/';
const CITY_SLUGS = {
  boston: 'ma--boston',
  miami: 'fl--miami',
  fort_lauderdale: 'fl--fort-lauderdale',
} as const;
const CATEGORIES = ['science--tech', 'tech', 'business--professional', 'networking'] as const;

const JSONLD_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

type EbLocation = {
  name?: string;
  address?: {
    addressLocality?: string;
    addressRegion?: string;
    streetAddress?: string;
  };
};

type EbOffer = {
  price?: string | number;
  availability?: string;
};

type EbEvent = {
  name?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  description?: string;
  location?: EbLocation;
  organizer?: { name?: string };
  offers?: EbOffer | EbOffer[];
  eventAttendanceMode?: string;
};

export function parseJsonLdEvents(html: string): EbEvent[] {
  const events: EbEvent[] = [];
  JSONLD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JSONLD_RE.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as {
        '@type'?: string;
        itemListElement?: Array<{ item?: EbEvent & { '@type'?: string } }>;
      };
      if (parsed?.['@type'] === 'ItemList' && Array.isArray(parsed.itemListElement)) {
        for (const item of parsed.itemListElement) {
          if (item?.item?.['@type'] === 'Event') events.push(item.item);
        }
      } else if (parsed?.['@type'] === 'Event') {
        events.push(parsed as EbEvent);
      }
    } catch {
      // skip malformed JSON-LD
    }
  }
  return events;
}

function offerPrice(offers: EbEvent['offers']): { isFree?: boolean; priceAmount?: number; priceText?: string } {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  if (list.length === 0) return {};
  const first = list[0];
  const amount = first.price != null ? Number(first.price) : undefined;
  if (amount === 0) return { isFree: true, priceAmount: 0, priceText: '0' };
  if (amount != null && Number.isFinite(amount)) {
    return { isFree: false, priceAmount: amount, priceText: String(first.price) };
  }
  return {};
}

export function normalizeEventbriteEvent(raw: EbEvent, cityFallback: string): CandidateEvent | null {
  if (!raw.name || !raw.startDate) return null;
  const eventUrl = raw.url || '';
  const attendance = (raw.eventAttendanceMode || '').toLowerCase();
  const isOnline =
    attendance.includes('online') ||
    (!raw.location?.name && !raw.location?.address);
  const isHybrid = attendance.includes('mixed');
  const venueName = raw.location?.name || '';
  const streetAddr = raw.location?.address?.streetAddress || '';
  const cleaned = cleanLocation(venueName || streetAddr, streetAddr, false);
  const pricing = offerPrice(raw.offers);
  const idMatch = eventUrl.match(/\/e\/[^/]*-(\d+)/) || eventUrl.match(/(\d{10,})/);
  return {
    source: 'eventbrite',
    sourceEventId: idMatch?.[1] || eventUrl,
    title: raw.name,
    description: raw.description || '',
    url: eventUrl,
    startAt: new Date(raw.startDate),
    endAt: raw.endDate ? new Date(raw.endDate) : undefined,
    venueName: cleaned.name || undefined,
    address: cleaned.address || undefined,
    city: raw.location?.address?.addressLocality || cityFallback,
    isOnline: isOnline && !isHybrid,
    isHybrid,
    hostName: raw.organizer?.name,
    trusted: false,
    ...pricing,
  };
}

async function fetchCityCategory(citySlug: string, category: string, cityFallback: string) {
  const url = `${BASE_URL}${citySlug}/${category}/`;
  const { ok, text } = await fetchText(url);
  if (!ok) throw new Error(`Eventbrite HTTP ${url}`);
  return parseJsonLdEvents(text)
    .map((raw) => normalizeEventbriteEvent(raw, cityFallback))
    .filter((event): event is CandidateEvent => Boolean(event));
}

export async function fetchEventbriteEvents(): Promise<AdapterFetchResult> {
  const seen = new Set<string>();
  const events: CandidateEvent[] = [];
  const errors: string[] = [];
  const jobs: Array<{ slug: string; category: string; city: string }> = [];
  for (const category of CATEGORIES) {
    jobs.push({ slug: CITY_SLUGS.boston, category, city: 'Boston' });
    jobs.push({ slug: CITY_SLUGS.miami, category, city: 'Miami' });
    jobs.push({ slug: CITY_SLUGS.fort_lauderdale, category, city: 'Fort Lauderdale' });
  }
  for (const job of jobs) {
    try {
      const batch = await fetchCityCategory(job.slug, job.category, job.city);
      for (const event of batch) {
        if (seen.has(event.sourceEventId)) continue;
        seen.add(event.sourceEventId);
        events.push(event);
      }
    } catch (err) {
      errors.push(`${job.slug}/${job.category}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { source: 'eventbrite', events, error: errors.length ? errors.join('; ') : undefined };
}
