import { notFound } from 'next/navigation';

import { NightDetail } from '@/components/social-hub/health/NightDetail';
import { LoadError } from '@/components/social-hub/LoadError';
import { PREVIEW_BASE } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { nightsEnding } from '@/lib/social-hub/health/time';
import { NIGHT_LOOKBACK } from '@/lib/social-hub/health/view';
import { isDayKey } from '@/lib/social-hub/time';
import { previewHealth } from '@/tests/fixtures/social-hub/health-fixture';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Night · Health · Preview · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ date: string }> }) {
  assertPreviewAllowed();
  const { date } = await params;
  if (!isDayKey(date)) notFound();
  const nights = new Set(nightsEnding(date, NIGHT_LOOKBACK));
  const history = previewHealth().stored.filter((r) => nights.has(r.night));
  const report = history.find((r) => r.night === date);
  if (!report) return <LoadError message="No report for that night." />;
  return <NightDetail report={report} history={history} base={PREVIEW_BASE} />;
}
