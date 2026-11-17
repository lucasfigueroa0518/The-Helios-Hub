import { notFound } from 'next/navigation';

import { poolPageData } from '@/components/content-type/pool/pool-data';
import { TypeHub } from '@/components/content-type/TypeHub';
import { typeHubModel } from '@/lib/content-type/model';
import { PREVIEW_BASE } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { isVertical, verticalInfo } from '@/lib/social-hub/verticals';
import { FIXTURE_NOW, previewDataset, previewDatasetWithAiEvents } from '@/tests/fixtures/social-hub/preview-dataset';

import '@/app/reels/reels.css';
import '@/components/content-type/type-hub.css';
import '@/components/content-type/pool/pool.css';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Content type · Social Hub', robots: { index: false, follow: false } };

/** The fixture mirror of a content type's page (development only): the pool screen and its panels, read-only (no buttons that write). */
export default async function Page({ params }: { params: Promise<{ type: string }> }) {
  assertPreviewAllowed();
  const { type } = await params;
  if (!isVertical(type) || type === 'reels') notFound();
  // AI Events has its own fixture (its post and weekly pool) so the other preview screens' counts stay put.
  const dataset = type === 'ai_events' ? previewDatasetWithAiEvents() : previewDataset();
  return <TypeHub model={typeHubModel(dataset, type, FIXTURE_NOW)} pool={poolPageData(dataset, type, FIXTURE_NOW)} title={verticalInfo(type).label} fullPostBase={PREVIEW_BASE} readOnly />;
}
