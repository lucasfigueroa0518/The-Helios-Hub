import { notFound } from 'next/navigation';

import { PoolScreen } from '@/components/social-hub/content/PoolScreen';
import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { isVertical } from '@/lib/social-hub/verticals';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Pool · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const { type } = await params;
  if (!isVertical(type)) notFound();
  return <PoolScreen dataset={previewDataset()} base={PREVIEW_BASE} vertical={type} params={toParams(await searchParams)} now={FIXTURE_NOW} />;
}
