import { parseJsonLdEvents, normalizeEventbriteEvent } from '@/lib/networking/adapters/eventbrite';
import { parseIcsEvents, icsEventToCandidate } from '@/lib/networking/adapters/ics';
import { lumaEventDetail, normalizeLumaEvent, type LumaEventDetailResponse } from '@/lib/networking/adapters/luma';
import { apolloStateOf, extractMeetupEventsFromApollo, normalizeMeetupEvent } from '@/lib/networking/adapters/meetup';
import { fetchJson, fetchText } from '@/lib/networking/http';
import { mergeSourceTags } from '@/lib/networking/signals';
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
    const { json } = await fetchJson<LumaEventDetailResponse>(
      `https://api.luma.com/event/get?event_api_id=${encodeURIComponent(slug)}`,
      { headers: { Origin: 'https://luma.com', Referer: url } },
    );
    // event/get answers like a discover entry (hosts, calendar, ticket_info) plus the full description.
    const fromApi = json?.event ? normalizeLumaEvent(json, { trusted: true }) : null;
    if (fromApi && json) {
      const detail = lumaEventDetail(json);
      if (detail.description) {
        fromApi.description = detail.description;
        fromApi.descriptionSource = 'luma_event_get';
      }
      fromApi.capacity = detail.capacity;
      fromApi.sourceTags = mergeSourceTags(fromApi.sourceTags, detail.sourceTags);
      return fromApi;
    }
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
    throw new Error('Could not parse Luma event');
  }

  if (host.includes('meetup.com')) {
    const { ok, text } = await fetchText(url);
    if (!ok) throw new Error('Meetup page was not reachable');
    const apollo = apolloStateOf(text);
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
        ? icsEventToCandidate(parsed, { feedUrl: url, name: host })
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
