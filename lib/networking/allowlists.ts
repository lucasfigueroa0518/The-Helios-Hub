import type { Metro } from '@/lib/networking/types';

export type LumaCalendarAllowlist = {
  slug: string;
  name: string;
  metro?: Metro;
  /** Luma calendar api id. When set, the adapter skips the /url resolve call. */
  apiId?: string;
};

export type MeetupGroupAllowlist = {
  urlname: string;
  name: string;
  metro: Metro;
};

export type IcsFeedAllowlist = {
  url: string;
  name: string;
  metro: Metro;
};

// Api ids resolved via https://api.luma.com/url?url=<slug> (metros audit, 2026-10-21).
export const LUMA_CALENDARS: LumaCalendarAllowlist[] = [
  { slug: 'masstechleadershipcouncil', name: 'MassTLC', metro: 'boston', apiId: 'cal-Uwyi1cBynmUIPe0' },
  { slug: 'emergeamericas', name: 'eMerge Americas', metro: 'miami', apiId: 'cal-NaTxODBGpCazh1w' },
  { slug: 'fal', name: 'fal', apiId: 'cal-u3vVIuSFJd7RqNB' },
  { slug: 'localhost-nyc', name: 'localhost:nyc', metro: 'nyc', apiId: 'cal-EgB2GR8mpTeEXG1' },
  { slug: 'startupgrindnyc', name: 'Startup Grind NYC', metro: 'nyc', apiId: 'cal-UAliCb7j5QccLrn' },
  { slug: 'nymlr', name: 'AI/ML Lecture & Networking @ NYC', metro: 'nyc', apiId: 'cal-m38PCKUwiKmJuxP' },
  { slug: 'nyaiengineers', name: 'Fonzi, NYC AI Engineers', metro: 'nyc', apiId: 'cal-UJKx9AKCHIKyu7R' },
  { slug: 'frontiertower', name: 'Frontier Tower SF', metro: 'sf', apiId: 'cal-Sl7q1nHTRXQzjP2' },
  { slug: 'techequity-ai', name: 'TechEquity Ai - Silicon Valley', metro: 'sf', apiId: 'cal-OwLywRAFub0sFge' },
  { slug: 'build-with-ai-club', name: 'Build with AI Club', metro: 'sf', apiId: 'cal-Ye2z2kKHbdGvR3y' },
  { slug: 'southparkcommons-events', name: 'South Park Commons', metro: 'sf', apiId: 'cal-Ve0M7LoDOpdnF3z' },
];

// Urlnames are lowercase: isAllowlistedUrl compares against the lowercased URL path.
export const MEETUP_GROUPS: MeetupGroupAllowlist[] = [
  { urlname: 'boston-ai', name: 'Boston AI', metro: 'boston' },
  { urlname: 'bostonpython', name: 'Boston Python', metro: 'boston' },
  { urlname: 'gdg-boston', name: 'GDG Boston', metro: 'boston' },
  { urlname: 'miami-ai', name: 'Miami AI', metro: 'miami' },
  { urlname: 'miami-python', name: 'Miami Python', metro: 'miami' },
  { urlname: 'nyhackr', name: 'NYHackR', metro: 'nyc' },
  { urlname: 'pydatanyc', name: 'PyData NYC', metro: 'nyc' },
  { urlname: 'aws-nyc', name: 'AWS NYC', metro: 'nyc' },
  { urlname: 'nyc-generative-and-agentic-ai', name: 'NYC Generative and Agentic AI', metro: 'nyc' },
  { urlname: 'hackerdojo', name: 'Hacker Dojo', metro: 'sf' },
  { urlname: 'sf-bay-acm', name: 'SF Bay ACM', metro: 'sf' },
  { urlname: 'hackers-and-founders', name: 'Hackers/Founders', metro: 'sf' },
  {
    urlname: 'usf-data-science-and-ai-speaker-series',
    name: 'USF Data Science & Artificial Intelligence Speaker Series',
    metro: 'sf',
  },
  { urlname: 'bay-area-research-in-nlp-and-ml', name: 'Bay Area Research in NLP and ML', metro: 'sf' },
];

export const ICS_FEEDS: IcsFeedAllowlist[] = [];

function firstPathSegment(url: string): { host: string; segment: string } | null {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    return {
      host: parsed.hostname.toLowerCase().replace(/^www\./, ''),
      segment: decodeURIComponent(segment).toLowerCase(),
    };
  } catch {
    return null;
  }
}

/** True only for a page of an allowlisted calendar or group: the first path segment must equal the slug. */
export function isAllowlistedUrl(url: string): boolean {
  const parts = firstPathSegment(url);
  if (parts?.segment) {
    if (
      (parts.host === 'luma.com' || parts.host === 'lu.ma') &&
      LUMA_CALENDARS.some((cal) => cal.slug === parts.segment)
    ) {
      return true;
    }
    if (parts.host === 'meetup.com' && MEETUP_GROUPS.some((group) => group.urlname === parts.segment)) {
      return true;
    }
  }
  const lower = url.toLowerCase();
  return ICS_FEEDS.some((feed) => lower.startsWith(feed.url.toLowerCase()));
}

function normalizeHost(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Exact normalized match on a calendar's or group's name or slug. A substring never counts ("fal" is not "Buffalo"). */
export function isAllowlistedHost(hostName: string | undefined): boolean {
  if (!hostName) return false;
  const host = normalizeHost(hostName);
  if (!host) return false;
  return (
    LUMA_CALENDARS.some((cal) => normalizeHost(cal.name) === host || normalizeHost(cal.slug) === host) ||
    MEETUP_GROUPS.some(
      (group) => normalizeHost(group.name) === host || normalizeHost(group.urlname) === host,
    )
  );
}
