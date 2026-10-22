import { notFound, redirect } from 'next/navigation';

import { LoadError } from '@/components/social-hub/LoadError';
import { RefreshNote } from '@/components/social-hub/RefreshNote';
import { calendarView, CalendarScreen, type CalendarWeek } from '@/components/social-hub/calendar/CalendarScreen';
import { readLfdSettings } from '@/lib/lfd/settings';
import { liveHubQuery } from '@/lib/social-hub/db';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { HUB_BASE, toParams, withParams, type HubParams, type RawSearchParams } from '@/lib/social-hub/links';
import { loadForPage } from '@/lib/social-hub/live';
import { readCaps, readOverrides, readSlotSource, readTemplate } from '@/lib/social-hub/slots/load';
import { SCHEDULE_ENTRIES, scheduleFromTemplate } from '@/lib/social-hub/slots/schedule';
import { readSeedInputs, seedTemplate } from '@/lib/social-hub/slots/seed';
import type { SlotQuery } from '@/lib/social-hub/slots/types';
import { addDays, isDayKey, nyDateOf } from '@/lib/social-hub/time';
import { datedWeek, lfdWeekdays, mondayOf, standardByWeekday, weekFromOverrides } from '@/lib/social-hub/views/week';
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
  // Each type's schedule from the template the board shows (today's pattern before the switch, where the form is read-only).
  const schedules = SCHEDULE_ENTRIES.map((e) => scheduleFromTemplate(shown, e));
  const common = { monday, source, standard, caps, switchFacts, schedules };
  if (source === 'template') {
    // The overrides' set_by marks the person's own edits: "Edited" and Reset day follow them.
    const overrides = await readOverrides(q, monday, addDays(monday, 6));
    return { days: weekFromOverrides(saved, overrides, monday), ...common };
  }
  // Legacy: show today's pattern so the view isn't empty before the switch; editing waits for it.
  return { days: datedWeek(shown, monday), ...common };
}

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.calendar) notFound();
  const session = await getSession();
  if (!session) redirect('/');
  const params = toParams(await searchParams);
  // Old links to the removed standing-week tab (?scope=template; Schedules replace it) open the week.
  if (params.scope === 'template') redirect(withParams(`${HUB_BASE}/calendar`, '', params, { scope: null }));
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
