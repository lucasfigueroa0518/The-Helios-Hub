import { redirect } from 'next/navigation';

import { SongPoolPage } from '@/app/reels/songs/song-pool';
import { SONG_POOL_CAP } from '@/lib/reels/config';
import { loadMusicStatus } from '@/lib/reels/music/overview';
import { listSongs } from '@/lib/reels/music/store';
import { TAG_MARGIN, SONG_VOCAB_VERSION } from '@/lib/reels/music/vocab';
import { getSession } from '@/lib/session';

import '../reels.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Audio · Trial Reels',
  robots: { index: false, follow: false },
};

export default async function AudioPage() {
  const session = await getSession();
  if (!session) redirect('/');
  const loaded = await Promise.all([listSongs(), loadMusicStatus()]).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  if ('error' in loaded) {
    return (
      <div className="rh">
        <div className="rh__inner">
          <h1 className="rh__title">Audio</h1>
          <p className="rh-empty">Could not load the song pool: {loaded.error}</p>
        </div>
      </div>
    );
  }
  const [songs, music] = loaded;
  return <SongPoolPage songs={songs} music={music} cap={SONG_POOL_CAP} vocabVersion={SONG_VOCAB_VERSION} margin={TAG_MARGIN} />;
}
