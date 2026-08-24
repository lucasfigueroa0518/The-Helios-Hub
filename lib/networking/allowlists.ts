import type { Metro } from '@/lib/networking/types';

export type LumaCalendarAllowlist = {
  slug: string;
  name: string;
  metro?: Metro;
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

export const LUMA_CALENDARS: LumaCalendarAllowlist[] = [
  { slug: 'masstechleadershipcouncil', name: 'MassTLC', metro: 'boston' },
  { slug: 'emergeamericas', name: 'eMerge Americas', metro: 'miami' },
  { slug: 'fal', name: 'fal' },
];

export const MEETUP_GROUPS: MeetupGroupAllowlist[] = [
  { urlname: 'boston-ai', name: 'Boston AI', metro: 'boston' },
  { urlname: 'bostonpython', name: 'Boston Python', metro: 'boston' },
  { urlname: 'gdg-boston', name: 'GDG Boston', metro: 'boston' },
  { urlname: 'miami-ai', name: 'Miami AI', metro: 'miami' },
  { urlname: 'miami-python', name: 'Miami Python', metro: 'miami' },
];

export const ICS_FEEDS: IcsFeedAllowlist[] = [];

export function isAllowlistedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (LUMA_CALENDARS.some((cal) => lower.includes(`/${cal.slug}`) || lower.includes(`luma.com/${cal.slug}`))) {
    return true;
  }
  if (MEETUP_GROUPS.some((group) => lower.includes(`meetup.com/${group.urlname}`))) {
    return true;
  }
  if (ICS_FEEDS.some((feed) => lower.startsWith(feed.url.toLowerCase()))) {
    return true;
  }
  return false;
}

export function isAllowlistedHost(hostName: string | undefined): boolean {
  if (!hostName) return false;
  const hay = hostName.toLowerCase();
  return (
    LUMA_CALENDARS.some((cal) => hay.includes(cal.name.toLowerCase()) || hay.includes(cal.slug)) ||
    MEETUP_GROUPS.some((group) => hay.includes(group.name.toLowerCase()))
  );
}
