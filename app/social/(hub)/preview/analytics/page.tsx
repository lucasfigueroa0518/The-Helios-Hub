import { AnalyticsScreen } from '@/components/social-hub/screens/AnalyticsScreen';
import { compareIds, PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { FIXTURE_NOW, previewDataset, previewDatasetWithAccount } from '@/tests/fixtures/social-hub/preview-dataset';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const raw = await searchParams;
  const params = toParams(raw);
  // ?fixture=account previews the Profile tab as it will look once the social_hub tables exist.
  return <AnalyticsScreen dataset={params.fixture === 'account' ? previewDatasetWithAccount() : previewDataset()} base={PREVIEW_BASE} params={params} compare={compareIds(raw)} now={FIXTURE_NOW} />;
}
