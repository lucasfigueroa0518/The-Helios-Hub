import { calendarView, CalendarScreen, type CalendarWeek } from '@/components/social-hub/calendar/CalendarScreen';
import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import { isDayKey, nyDateOf } from '@/lib/social-hub/time';
import { carouselsByWeekday, datedWeek, lfdWeekdays, mondayOf, templateWeek } from '@/lib/social-hub/views/week';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Calendar · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const params = toParams(await searchParams);
  // The fixture week: today's default pattern, shown as if the calendar were on, read only.
  const template = seedTemplate(DEFAULT_SEED_INPUTS);
  const monday = mondayOf(isDayKey(params.week) ? params.week : nyDateOf(FIXTURE_NOW)!);
  // Fixture facts for the Switch on confirm: a first switch with Last Few Days paused.
  const switchFacts = { templateEmpty: true, lfdPaused: true, lfdDays: lfdWeekdays(template) };
  const week: CalendarWeek | null = calendarView(params) !== 'week' ? null : params.scope === 'template'
    ? { mode: 'template', monday, days: templateWeek(template, monday), source: 'template', readOnly: true, templateCarousels: carouselsByWeekday(template), switchFacts }
    : { mode: 'week', monday, days: datedWeek(template, monday), source: 'template', readOnly: true, templateCarousels: carouselsByWeekday(template), switchFacts };
  return <CalendarScreen dataset={previewDataset()} base={PREVIEW_BASE} params={params} now={FIXTURE_NOW} week={week} />;
}
