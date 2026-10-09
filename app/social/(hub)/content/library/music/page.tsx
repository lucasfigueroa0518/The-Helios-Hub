import { redirect } from 'next/navigation';

import { MusicScreen } from '@/components/social-hub/content/MusicScreen';
import { liveHubQuery } from '@/lib/social-hub/db';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { readMusic, type MusicRead } from '@/lib/social-hub/queries/music';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Music pool · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  if (!session) redirect('/');
  const music = await readMusic(liveHubQuery).catch((): MusicRead => ({ present: false }));
  return <MusicScreen music={music} base={HUB_BASE} params={toParams(await searchParams)} now={new Date()} playable />;
}
