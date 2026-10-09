import { Music2 } from 'lucide-react';

import { Breadcrumbs } from '@/components/social-hub/nav/Breadcrumbs';
import { HubLink } from '@/components/social-hub/nav/HubNav';
import { PageHead } from '@/components/social-hub/ui/PageHead';
import { withParams, type HubParams } from '@/lib/social-hub/links';
import type { MusicRead } from '@/lib/social-hub/queries/music';
import { plural, relative } from '@/lib/social-hub/views/format';
import { crumbsFor } from '@/lib/social-hub/views/nav';

const SHOW = [
  { id: 'all', label: 'All' },
  { id: 'music', label: 'Licensed music' },
  { id: 'original_sound', label: 'Original sounds' },
] as const;

function seconds(ms: number | null): string {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The Meta trending-audio pool Text on Screen reels pick from (reels.songs): up to
 * 50 sounds, refreshed at 12:30 AM, each matched to a reel by vibe.
 */
export function MusicScreen({ music, base, params, now, playable }: { music: MusicRead; base: string; params: HubParams; now: Date; playable: boolean }) {
  const path = `${base}/content/library/music`;
  const show = SHOW.some((s) => s.id === params.show) ? params.show! : 'all';
  if (!music.present) {
    return (
      <>
        <Breadcrumbs crumbs={crumbsFor(base, path)} />
        <PageHead title="Music pool" />
        <div className="sh-panel sh-empty"><strong>Not set up on this database yet</strong>The pool fills from Instagram’s trending audio once the Text on Screen song ingest runs.</div>
      </>
    );
  }
  const songs = music.songs.filter((s) => show === 'all' || s.type === show);
  const used = music.songs.filter((s) => s.uses > 0).length;
  return (
    <>
      <Breadcrumbs crumbs={crumbsFor(base, path)} />
      <PageHead
        title="Music pool"
        meta={`${plural(music.songs.length, 'sound')} · ${used} used in a reel${music.lastIngest?.finishedAt ? ` · refreshed ${relative(music.lastIngest.finishedAt, now)}${music.lastIngest.added ? `, ${music.lastIngest.added} new` : ''}` : ''}`}
      />
      <p className="sh-note">Instagram’s trending audio, cleared for third-party use. Each reel gets the sound whose vibe best matches its copy; the oldest unused sounds leave first once the pool holds 50.</p>
      <div className="sh-pills" role="group" aria-label="Show">
        {SHOW.map((s) => (
          <HubLink key={s.id} className="sh-pill" href={withParams(path, '', params, { show: s.id === 'all' ? null : s.id })} history="replace" aria-current={show === s.id ? 'page' : undefined}>{s.label}</HubLink>
        ))}
      </div>
      <div className="sh-panel">
        <div className="sh-table-wrap">
          <table className="sh-table sh-table--stack">
            <thead>
              <tr>
                <th scope="col">Sound</th>
                <th scope="col">Feel</th>
                <th scope="col" className="sh-num">Trending</th>
                <th scope="col" className="sh-num">Used</th>
                <th scope="col">Added</th>
              </tr>
            </thead>
            <tbody>
              {songs.map((s) => (
                <tr key={s.audioId}>
                  <td className="sh-stack-lead">
                    <span className="sh-audio">
                      <span className="sh-audio__cover" aria-hidden="true">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {s.cover ? <img src={s.cover} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Music2 size={18} />}
                      </span>
                      <span className="sh-cell-post__text">
                        <span className="sh-cell-post__name">{s.title}</span>
                        <span className="sh-subtle">{[s.artist, seconds(s.durationMs)].filter(Boolean).join(' · ')}</span>
                        {playable ? <audio controls preload="none" src={`/api/reels/songs/preview/${encodeURIComponent(s.audioId)}`} aria-label={`Preview ${s.title}`} /> : null}
                      </span>
                    </span>
                  </td>
                  <td>
                    {s.tagged ? (
                      <span className="sh-chips">
                        {[s.genre, s.bpm ? `${Math.round(s.bpm)} bpm` : null, ...s.vibes.slice(0, 2)].filter(Boolean).map((t) => <span key={t} className="sh-chip">{t}</span>)}
                      </span>
                    ) : <span className="sh-subtle">Not tagged yet</span>}
                  </td>
                  <td className="sh-num" data-prefix="Trending">#{s.trendingRank}</td>
                  <td className="sh-num" data-label={s.uses === 1 ? 'use' : 'uses'}>{s.uses || 0}</td>
                  <td className="sh-nowrap sh-muted" data-prefix="Added">{relative(s.firstIngestedAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
