import { redirect } from 'next/navigation';

import { ContentScreen } from '@/components/social-hub/content/ContentScreen';
import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { legacyRootRedirect } from '@/lib/social-hub/views/legacy-routes';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';
import { previewLibraries } from '@/tests/fixtures/social-hub/preview-libraries';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const legacy = legacyRootRedirect(PREVIEW_BASE, toParams(await searchParams));
  if (legacy) redirect(legacy);
  return <ContentScreen dataset={previewDataset()} base={PREVIEW_BASE} now={FIXTURE_NOW} libraries={previewLibraries()} />;
}
