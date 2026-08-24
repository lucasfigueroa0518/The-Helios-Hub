import { parseJsonLdEvents, normalizeEventbriteEvent } from '@/lib/networking/adapters/eventbrite';
import { parseIcsEvents, icsEventToCandidate } from '@/lib/networking/adapters/ics';
import { normalizeLumaEvent } from '@/lib/networking/adapters/luma';
import { parseNextData, extractMeetupEventsFromApollo, normalizeMeetupEvent } from '@/lib/networking/adapters/meetup';
import { fetchJson, fetchText } from '@/lib/networking/http';
import type { CandidateEvent } from '@/lib/networking/types';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export async function importEventFromUrl(rawUrl: string): Promise<CandidateEvent> {
  const url = rawUrl.trim();
  if (!url) throw new Error('URL is required');
  const host = hostOf(url);

  if (host.includes('luma.com') || host.includes('lu.ma')) {
    const slug = new URL(url).pathname.replace(/^\//, '').split('/')[0];
    const { json } = await fetchJson<{ event?: { api_id?: string }; entries?: never } & {
      event?: Record<string, unknown>;
    }>(`https://api.luma.com/event/get?event_api_id=${encodeURIComponent(slug)}`, {
      headers: { Origin: 'https://luma.com', Referer: url },
    });
    const { text } = await fetchText(url, {
      headers: { Origin: 'https://luma.com', Referer: url },
    });
    const fromPage = parseJsonLdEvents(text);
    if (fromPage[0]) {
      const eb = normalizeEventbriteEvent(fromPage[0], '');
      if (eb) {
        eb.source = 'luma';
        eb.trusted = true;
        eb.url = url;
        return eb;
      }
    }
    const apiEvent = (json as { event?: Record<string, unknown> } | null)?.event;
    if (apiEvent) {
      const candidate = normalizeLumaEvent(
        { event: apiEvent as never },
        { trusted: true },
      );
      if (candidate) return candidate;
    }
    throw new Error('Could not parse Luma event');
  }

  if (host.includes('meetup.com')) {
    const { ok, text } = await fetchText(url);
    if (!ok) throw new Error('Meetup page was not reachable');
    const nextData = parseNextData(text);
    const apollo = (
      nextData?.props as { pageProps?: { __APOLLO_STATE__?: Record<string, unknown> } } | undefined
    )?.pageProps?.__APOLLO_STATE__;
    if (apollo) {
      const events = extractMeetupEventsFromApollo(apollo)
        .map((raw) => normalizeMeetupEvent(raw, { cityFallback: '', trusted: true }))
        .filter((event): event is CandidateEvent => Boolean(event));
      const match = events.find((event) => event.url === url) || events[0];
      if (match) {
        match.trusted = true;
        match.url = url;
        return match;
      }
    }
    throw new Error('Could not parse Meetup event');
  }

  if (host.includes('eventbrite.com')) {
    const { ok, text } = await fetchText(url);
    if (!ok) throw new Error('Eventbrite page was not reachable');
    const parsed = parseJsonLdEvents(text);
    const event = parsed[0] ? normalizeEventbriteEvent(parsed[0], '') : null;
    if (!event) throw new Error('Could not parse Eventbrite event');
    event.trusted = true;
    event.url = url;
    return event;
  }

  if (url.toLowerCase().includes('.ics') || host.includes('calendar')) {
    const { ok, text } = await fetchText(url);
    if (ok && /BEGIN:VEVENT/.test(text)) {
      const parsed = parseIcsEvents(text)[0];
      const candidate = parsed
        ? icsEventToCandidate(parsed, { feedUrl: url, name: host, metro: 'boston' })
        : null;
      if (candidate) {
        candidate.trusted = true;
        return candidate;
      }
    }
  }

  const { ok, text } = await fetchText(url);
  if (ok) {
    const parsed = parseJsonLdEvents(text);
    const event = parsed[0] ? normalizeEventbriteEvent(parsed[0], '') : null;
    if (event) {
      event.source = 'url';
      event.trusted = true;
      event.url = url;
      return event;
    }
  }

  throw new Error('Unsupported URL. Use a Luma, Meetup, or Eventbrite event page.');
}
