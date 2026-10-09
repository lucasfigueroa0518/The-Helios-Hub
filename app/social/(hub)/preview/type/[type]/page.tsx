import { notFound } from 'next/navigation';

import { TypeHub } from '@/components/content-type/TypeHub';
import { typeHubModel } from '@/lib/content-type/model';
import { PREVIEW_BASE } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { isVertical, verticalInfo } from '@/lib/social-hub/verticals';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

import '@/app/reels/reels.css';
import '@/components/content-type/type-hub.css';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Content type · Social Hub', robots: { index: false, follow: false } };

/** The fixture mirror of a content type's page (development only): the days, cards, bench and drawers, without the buttons that write. */
export default async function Page({ params }: { params: Promise<{ type: string }> }) {
  assertPreviewAllowed();
  const { type } = await params;
  if (!isVertical(type) || type === 'reels') notFound();
  return <TypeHub model={typeHubModel(previewDataset(), type, FIXTURE_NOW)} title={verticalInfo(type).label} fullPostBase={PREVIEW_BASE} />;
}
