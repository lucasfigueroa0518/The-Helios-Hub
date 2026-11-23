import { PhotosScreen, photoBankSection } from '@/components/social-hub/content/PhotosScreen';
import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { FIXTURE_NOW } from '@/tests/fixtures/social-hub/preview-dataset';
import { previewFieldNotesPool, previewPhotos } from '@/tests/fixtures/social-hub/preview-libraries';

import '@/components/field-notes/field-notes.css';
import '@/components/social-hub/library/field-notes-photos.css';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Photo bank · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const params = toParams(await searchParams);
  if (photoBankSection(params) === 'field-notes') {
    // Fixture photos, read-only: no uploads and no grid actions in preview.
    return <PhotosScreen fieldNotes={{ pool: previewFieldNotesPool(), error: null, readOnly: true }} base={PREVIEW_BASE} params={params} now={FIXTURE_NOW} />;
  }
  const { page, summary } = previewPhotos({
    tag: params.tag ?? null,
    lane: params.lane ?? null,
    used: params.used === 'used' ? true : params.used === 'unused' ? false : null,
  });
  return <PhotosScreen page={page} summary={summary} base={PREVIEW_BASE} params={params} now={FIXTURE_NOW} />;
}
