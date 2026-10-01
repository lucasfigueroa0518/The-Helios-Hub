'use client';

import Link from 'next/link';
import { Music2, Volume2 } from 'lucide-react';

import { Section } from '@/app/reels/ui';
import type { MusicStatus } from '@/lib/reels/music/overview';
import type { StoredSong } from '@/lib/reels/music/store';

/*
 * D-174: the song pool. Gate 1 reviews the day-1 tags here (D-182), and after
 * that it stays the pool browser: every song with its preview, tags, age, and
 * where it sits in the eviction order. Listening only; no controls.
 */

function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function seconds(ms: number | null): string {
  return ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`;
}

const LIST_LABEL = { music: 'Music', original_sound: 'Original sound' } as const;

export function SongPoolPage({
  songs,
  music,
  cap,
  vocabVersion,
  margin,
}: {
  songs: StoredSong[];
  music: MusicStatus;
  cap: number;
  vocabVersion: string;
  margin: number;
}) {
  const tagged = songs.filter((song) => song.taggedAt);
  const untagged = songs.filter((song) => !song.taggedAt);
  // Oldest unattached songs go first when the pool passes the cap (D-141, D-164).
  let order = 0;
  const evictionRank = new Map(songs.filter((song) => !song.attached).map((song) => [song.audioId, (order += 1)]));
  const lastIngest = music.ingests[0] ?? null;

  const card = (song: StoredSong) => (
    <article key={song.audioId} className="rh-card rh-pool__song">
      <div className="rh-pool__head">
        {song.coverArtworkThumbnailUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={song.coverArtworkThumbnailUri} alt="" className="rh-song-strip__cover" />
        ) : (
          <span className="rh-song-strip__cover rh-song-strip__cover--blank">
            <Music2 size={14} />
          </span>
        )}
        <span className="rh-song-strip__text">
          <span className="rh-song-strip__title">{song.title ?? 'Untitled sound'}</span>
          <span className="rh-song-strip__artist">{song.displayArtist ?? song.igUsername ?? 'Unknown artist'}</span>
        </span>
      </div>
      <audio controls preload="none" src={`/api/reels/songs/preview/${encodeURIComponent(song.audioId)}`} />
      {song.taggedAt ? (
        <>
          <p className="rh-song-tags">
            <span className="rh-muted">Genre</span> {song.genre} · {song.bpm ?? '—'} BPM
          </p>
          <p className="rh-song-tags">
            <span className="rh-muted">Instruments</span> {song.instruments?.join(', ')}
          </p>
          <p className="rh-song-tags">
            <span className="rh-muted">Vibes</span> {song.vibes?.join(', ')}
          </p>
        </>
      ) : (
        <p className="rh-muted">Not tagged yet.</p>
      )}
      <p className="rh-pool__meta">
        {LIST_LABEL[song.trendingList]} #{song.trendingRank} · in since {formatTime(song.firstIngestedAt)} · preview{' '}
        {seconds(song.previewDurationMs)} of {seconds(song.durationInMs)}
      </p>
      <p className="rh-pool__meta">
        {song.attached ? (
          <span className="rh-pool__attached">On an unpublished reel, so it is not evicted</span>
        ) : (
          `Eviction order ${evictionRank.get(song.audioId)} of ${evictionRank.size}`
        )}
      </p>
    </article>
  );

  return (
    <div className="rh">
      <div className="rh__inner">
        <header className="rh__head">
          <div>
            <p className="rh__kicker">Trial Reels</p>
            <h1 className="rh__title">
              Audio <span className="rh-beta">Beta</span>
            </h1>
          </div>
          <div className="rh__head-actions">
            <Link href="/reels/sfx" className="rh-btn">
              <Volume2 size={15} /> Hook sounds
            </Link>
          </div>
        </header>

        <section className="rh-card">
          <p className="rh-card__title">
            {songs.length} of {cap} songs · {tagged.length} tagged
          </p>
          <p className="rh-muted">
            Trending Instagram sounds, refreshed at 12:30 AM. Tags use {vocabVersion}: every label within {margin} of a
            song&apos;s best CLAP score, 1–3 instruments and 5–10 vibes. Previews play from the cached file.
          </p>
          <p className="rh-muted">
            Last ingest:{' '}
            {lastIngest
              ? `${lastIngest.status} · ${formatTime(lastIngest.startedAt)} · ${lastIngest.added} added, ${lastIngest.evicted} evicted${lastIngest.note ? ` · ${lastIngest.note}` : ''}`
              : 'none yet'}
          </p>
          {!music.metaReady && <p className="rh-muted">The ingest is waiting on Meta credentials.</p>}
          {!music.clapReady && <p className="rh-muted">Tagging is waiting on the CLAP endpoint.</p>}
        </section>

        {songs.length === 0 ? (
          <p className="rh-empty">No songs yet. The first ingest fills the pool with 30.</p>
        ) : (
          <>
            {untagged.length > 0 && (
              <Section title="Untagged" count={untagged.length} open>
                <div className="rh-pool">{untagged.map(card)}</div>
              </Section>
            )}
            <Section title="Tagged, oldest first" count={tagged.length} open>
              <div className="rh-pool">{tagged.map(card)}</div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
