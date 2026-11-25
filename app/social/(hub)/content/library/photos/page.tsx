import { redirect } from 'next/navigation';

import { PhotosScreen, photoBankSection, type FieldNotesPhotos } from '@/components/social-hub/content/PhotosScreen';
import { listPool } from '@/lib/field-notes/photos/read';
import { listLibrary, librarySummary, type LibraryPage, type LibrarySummary } from '@/lib/media-library/read';
import { liveHubQuery } from '@/lib/social-hub/db';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { getSession } from '@/lib/session';

import '@/components/field-notes/field-notes.css';
import '@/components/social-hub/library/field-notes-photos.css';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Photo bank · Social Hub', robots: { index: false, follow: false } };

/** The Field Notes pool, read only when that section is open (UI-REWORK-CONTRACT C3). */
async function loadFieldNotes(): Promise<FieldNotesPhotos> {
  try {
    return { pool: await listPool(liveHubQuery), error: null, readOnly: false };
  } catch (e) {
    return { pool: null, error: e instanceof Error ? e.message : String(e), readOnly: false };
  }
}

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  if (!session) redirect('/');
  const params = toParams(await searchParams);
  if (photoBankSection(params) === 'field-notes') {
    return <PhotosScreen fieldNotes={await loadFieldNotes()} base={HUB_BASE} params={params} now={new Date()} />;
  }
  const [page, summary] = await Promise.all([
    listLibrary(liveHubQuery, {
      tag: params.tag ?? null,
      lane: params.lane ?? null,
      used: params.used === 'used' ? true : params.used === 'unused' ? false : null,
      page: Number(params.page) > 0 ? Number(params.page) : 1,
    }).catch((): LibraryPage => ({ absent: true })),
    librarySummary(liveHubQuery).catch((): LibrarySummary => ({ absent: true })),
  ]);
  return <PhotosScreen page={page} summary={summary} base={HUB_BASE} params={params} now={new Date()} />;
}
