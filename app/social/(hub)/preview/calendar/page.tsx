import { calendarView, CalendarScreen, type CalendarWeek } from '@/components/social-hub/calendar/CalendarScreen';
import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { SCHEDULE_ENTRIES, scheduleFromTemplate } from '@/lib/social-hub/slots/schedule';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import { DEFAULT_CAPS } from '@/lib/social-hub/slots/times';
import { isDayKey, nyDateOf } from '@/lib/social-hub/time';
import { datedWeek, lfdWeekdays, mondayOf, standardByWeekday, templateWeek } from '@/lib/social-hub/views/week';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Calendar · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const params = toParams(await searchParams);
  // The fixture week: today's default pattern, shown as if the calendar were on. The board edits on screen only (sandbox).
  const template = seedTemplate(DEFAULT_SEED_INPUTS);
  const monday = mondayOf(isDayKey(params.week) ? params.week : nyDateOf(FIXTURE_NOW)!);
  // Fixture facts for the Switch on confirm: a first switch with Last Few Days paused.
  const switchFacts = { templateEmpty: true, lfdPaused: true, lfdDays: lfdWeekdays(template) };
  // The Schedules dropdown edits this template on screen; the board recomputes its week from it (no network).
  const schedules = SCHEDULE_ENTRIES.map((e) => scheduleFromTemplate(template, e));
  const common = { monday, source: 'template' as const, sandbox: true, standard: standardByWeekday(template), caps: DEFAULT_CAPS, switchFacts, schedules, template };
  const week: CalendarWeek | null = calendarView(params) !== 'week' ? null : params.scope === 'template'
    ? { mode: 'template', days: templateWeek(template, monday), ...common }
    : { mode: 'week', days: datedWeek(template, monday), ...common };
  return <CalendarScreen dataset={previewDataset()} base={PREVIEW_BASE} params={params} now={FIXTURE_NOW} week={week} />;
}
