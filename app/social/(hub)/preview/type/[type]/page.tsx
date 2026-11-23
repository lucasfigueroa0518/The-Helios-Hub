import Link from 'next/link';
import { notFound } from 'next/navigation';

import { poolPageData } from '@/components/content-type/pool/pool-data';
import { FieldNotesReadOnlyHub } from '@/components/content-type/FieldNotesReadOnlyHub';
import { TypeHub } from '@/components/content-type/TypeHub';
import { typeHubModel } from '@/lib/content-type/model';
import { PREVIEW_BASE } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { isVertical, verticalInfo } from '@/lib/social-hub/verticals';
import { FIXTURE_NOW, previewDataset, previewDatasetWithAiEvents, previewDatasetWithFieldNotes } from '@/tests/fixtures/social-hub/preview-dataset';

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
  const dataset = type === 'ai_events' ? previewDatasetWithAiEvents() : type === 'field_notes' ? previewDatasetWithFieldNotes() : previewDataset();
  if (type === 'field_notes') {
    // Field Notes' own bits, read-only: the Photos link (to the preview Photo Bank) and the tip notes under a post's slides.
    const photos = <Link className="rh-btn" href={`${PREVIEW_BASE}/content/library/photos?section=field-notes`}>Photos</Link>;
    return <FieldNotesReadOnlyHub model={typeHubModel(dataset, type, FIXTURE_NOW)} pool={poolPageData(dataset, type, FIXTURE_NOW)} title={verticalInfo(type).label} headerActions={photos} fullPostBase={PREVIEW_BASE} readOnly />;
  }
  return <TypeHub model={typeHubModel(dataset, type, FIXTURE_NOW)} pool={poolPageData(dataset, type, FIXTURE_NOW)} title={verticalInfo(type).label} fullPostBase={PREVIEW_BASE} readOnly />;
}
