import { notFound } from 'next/navigation';

import { TypeScreen } from '@/components/social-hub/analytics/TypeScreen';
import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { isVertical } from '@/lib/social-hub/verticals';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Analytics · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const { type } = await params;
  if (!isVertical(type)) notFound();
  return <TypeScreen dataset={previewDataset()} base={PREVIEW_BASE} vertical={type} params={toParams(await searchParams)} now={FIXTURE_NOW} />;
}
