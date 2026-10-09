import { redirect } from 'next/navigation';

import { PhotosScreen } from '@/components/social-hub/content/PhotosScreen';
import { listLibrary, librarySummary, type LibraryPage, type LibrarySummary } from '@/lib/media-library/read';
import { liveHubQuery } from '@/lib/social-hub/db';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Photo bank · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  if (!session) redirect('/');
  const params = toParams(await searchParams);
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
