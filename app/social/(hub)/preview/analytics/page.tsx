import { redirect } from 'next/navigation';

import { OverviewScreen } from '@/components/social-hub/analytics/OverviewScreen';
import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { legacyAnalyticsRedirect } from '@/lib/social-hub/views/legacy-routes';
import { FIXTURE_NOW, previewDataset, previewDatasetWithAccount } from '@/tests/fixtures/social-hub/preview-dataset';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Analytics · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const params = toParams(await searchParams);
  const legacy = legacyAnalyticsRedirect(PREVIEW_BASE, params);
  if (legacy) redirect(legacy);
  const dataset = params.fixture === 'account' ? previewDatasetWithAccount() : previewDataset();
  return <OverviewScreen dataset={dataset} base={PREVIEW_BASE} params={params} now={FIXTURE_NOW} />;
}
