import { CalendarScreen } from '@/components/social-hub/calendar/CalendarScreen';
import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Calendar · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  return <CalendarScreen dataset={previewDataset()} base={PREVIEW_BASE} params={toParams(await searchParams)} now={FIXTURE_NOW} />;
}
