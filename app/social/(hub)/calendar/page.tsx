import { notFound, redirect } from 'next/navigation';

import { LoadError } from '@/components/social-hub/LoadError';
import { RefreshNote } from '@/components/social-hub/RefreshNote';
import { calendarView, CalendarScreen, type CalendarWeek } from '@/components/social-hub/calendar/CalendarScreen';
import { readLfdSettings } from '@/lib/lfd/settings';
import { liveHubQuery } from '@/lib/social-hub/db';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, type HubParams, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { loadSlots, readCaps, readSlotSource, readTemplate } from '@/lib/social-hub/slots/load';
import { readSeedInputs, seedTemplate } from '@/lib/social-hub/slots/seed';
import type { SlotQuery } from '@/lib/social-hub/slots/types';
import { addDays, isDayKey, nyDateOf, weekdayOf } from '@/lib/social-hub/time';
import { datedWeek, lfdWeekdays, mondayOf, standardByWeekday, templateWeek } from '@/lib/social-hub/views/week';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Calendar · Social Hub', robots: { index: false, follow: false } };

const q: SlotQuery = (text, params) => liveHubQuery(text, params) as Promise<{ rows: any[] }>;

/** Last Few Days paused (auto_run off); unreadable reads as not paused, so the confirm doesn't warn on a guess. */
async function lfdPaused(): Promise<boolean> {
  try {
    return !(await readLfdSettings(q)).autoRun;
  } catch {
    return false;
  }
}

/** The week view's slots: the template, the live calendar, or (before the switch) today's pattern, read only. */
async function loadWeek(params: HubParams, now: Date): Promise<CalendarWeek> {
  const source = await readSlotSource(q);
  const monday = mondayOf(isDayKey(params.week) ? params.week : nyDateOf(now)!);
  // In legacy mode an unreadable template is null (unknown), so the confirm doesn't promise "copied in" on a guess.
  const [read, paused, caps] = await Promise.all([source === 'template' ? readTemplate(q) : readTemplate(q).catch(() => null), lfdPaused(), readCaps(q)]);
  const saved = read ?? [];
  // Legacy shows today's pattern; switching on brings back a saved template, or copies today's pattern into an empty one.
  const shown = source === 'template' ? saved : seedTemplate(await readSeedInputs(q));
  const standard = standardByWeekday(shown);
  const switchFacts = { templateEmpty: read ? read.length === 0 : null, lfdPaused: paused, lfdDays: lfdWeekdays(saved.length ? saved : shown) };
  const common = { monday, source, standard, caps, switchFacts };
  if (params.scope === 'template') return { mode: 'template', days: templateWeek(shown, monday), ...common };
  if (source === 'template') {
    const map = await loadSlots(q, monday, addDays(monday, 6));
    return { mode: 'week', days: [...map].map(([nyDate, slots]) => ({ nyDate, weekday: weekdayOf(nyDate), slots })), ...common };
  }
  // Legacy: show today's pattern so the view isn't empty before the switch; editing waits for it.
  return { mode: 'week', days: datedWeek(shown, monday), ...common };
}

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.calendar) notFound();
  const session = await getSession();
  if (!session) redirect('/');
  const params = toParams(await searchParams);
  const now = new Date();
  const wantsWeek = calendarView(params) === 'week';
  const [loaded, week] = await Promise.all([
    loadForPage(session.email),
    wantsWeek
      ? loadWeek(params, now).catch((err: unknown) => {
          console.error('[social-hub] calendar week failed to load', err);
          return null;
        })
      : Promise.resolve(null),
  ]);
  if ('error' in loaded) return <LoadError message={loaded.error} />;
  return (
    <>
      <RefreshNote refresh={loaded.refresh} />
      <CalendarScreen dataset={loaded} base={HUB_BASE} params={params} now={now} week={week} weekFailed={wantsWeek && !week} />
    </>
  );
}
