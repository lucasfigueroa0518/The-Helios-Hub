import { notFound, redirect } from 'next/navigation';

import { LoadError } from '@/components/social-hub/LoadError';
import { RefreshNote } from '@/components/social-hub/RefreshNote';
import { calendarView, CalendarScreen, type CalendarWeek } from '@/components/social-hub/calendar/CalendarScreen';
import { liveHubQuery } from '@/lib/social-hub/db';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, type HubParams, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { loadSlots, readSlotSource, readTemplate } from '@/lib/social-hub/slots/load';
import { readSeedInputs, seedTemplate } from '@/lib/social-hub/slots/seed';
import type { SlotQuery } from '@/lib/social-hub/slots/types';
import { addDays, isDayKey, nyDateOf, weekdayOf } from '@/lib/social-hub/time';
import { datedWeek, mondayOf, templateWeek } from '@/lib/social-hub/views/week';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Calendar · Social Hub', robots: { index: false, follow: false } };

const q: SlotQuery = (text, params) => liveHubQuery(text, params) as Promise<{ rows: any[] }>;

/** The week view's slots: the template, the live calendar, or (before the switch) today's pattern, read only. */
async function loadWeek(params: HubParams, now: Date): Promise<CalendarWeek> {
  const source = await readSlotSource(q);
  const monday = mondayOf(isDayKey(params.week) ? params.week : nyDateOf(now)!);
  if (params.scope === 'template') {
    const template = source === 'template' ? await readTemplate(q) : seedTemplate(await readSeedInputs(q));
    return { mode: 'template', monday, days: templateWeek(template, monday), source };
  }
  if (source === 'template') {
    const map = await loadSlots(q, monday, addDays(monday, 6));
    return { mode: 'week', monday, days: [...map].map(([nyDate, slots]) => ({ nyDate, weekday: weekdayOf(nyDate), slots })), source };
  }
  // Legacy: show today's pattern so the view isn't empty before the switch; editing waits for it.
  return { mode: 'week', monday, days: datedWeek(seedTemplate(await readSeedInputs(q)), monday), source };
}

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.calendar) notFound();
  const session = await getSession();
  if (!session) redirect('/');
  const params = toParams(await searchParams);
  const now = new Date();
  const [loaded, week] = await Promise.all([
    loadForPage(session.email),
    calendarView(params) === 'week' ? loadWeek(params, now).catch(() => null) : Promise.resolve(null),
  ]);
  if ('error' in loaded) return <LoadError message={loaded.error} />;
  return (
    <>
      <RefreshNote refresh={loaded.refresh} />
      <CalendarScreen dataset={loaded} base={HUB_BASE} params={params} now={now} week={week} />
    </>
  );
}
