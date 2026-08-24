import { fetchBevyEvents } from '@/lib/networking/adapters/bevy';
import { fetchConferenceEvents } from '@/lib/networking/adapters/conferences';
import { fetchEventbriteEvents } from '@/lib/networking/adapters/eventbrite';
import { fetchIcsEvents } from '@/lib/networking/adapters/ics';
import { fetchLumaEvents } from '@/lib/networking/adapters/luma';
import { fetchMeetupEvents } from '@/lib/networking/adapters/meetup';
import type { AdapterFetchResult } from '@/lib/networking/types';

export async function fetchAllSources(): Promise<AdapterFetchResult[]> {
  const tasks: Array<Promise<AdapterFetchResult>> = [
    fetchLumaEvents(),
    fetchMeetupEvents(),
    fetchEventbriteEvents(),
    fetchIcsEvents(),
    fetchBevyEvents(),
    fetchConferenceEvents(),
  ];
  const settled = await Promise.allSettled(tasks);
  return settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    const names = ['luma', 'meetup', 'eventbrite', 'ics', 'bevy', 'conferences'];
    return {
      source: names[index] || 'unknown',
      events: [],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}
