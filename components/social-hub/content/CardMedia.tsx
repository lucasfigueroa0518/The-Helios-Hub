'use client';

import { ChevronLeft, ChevronRight, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { PostLink } from '@/components/social-hub/nav/PostLink';
import { TYPE_ICON, typeStyle } from '@/components/social-hub/ui/marks';
import { thumbOf } from '@/components/social-hub/ui/Thumb';
import type { HubPost } from '@/lib/social-hub/types';
import { mediaFrames } from '@/lib/social-hub/views/card-media';

/**
 * A Today's Content card's media (spec 2026-10-13 §2). Video plays muted on
 * hover and resets on leave; the speaker turns sound on. Slides and story
 * frames get arrows and dots on hover. Clicking the media opens the post. On
 * touch screens a tap plays or pauses a video, and a swipe changes the slide.
 */
export function CardMedia({ post }: { post: HubPost }) {
  const tall = post.format !== 'feed';
  const art = `sh-strip__art sh-gallery__art${tall ? ' is-tall' : ''}`;
  if (post.media.kind === 'video' && post.media.src) return <VideoPreview post={post} src={post.media.src} poster={post.media.poster ?? null} className={art} />;
  if (mediaFrames(post.media).length) return <SlidesPreview post={post} className={art} />;
  return (
    <PostLink id={post.id} className={art} decorative>
      <StillArt post={post} />
    </PostLink>
  );
}

const touchOnly = () => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

function VideoPreview({ post, src, poster, className }: { post: HubPost; src: string; poster: string | null; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);
  const play = () => void ref.current?.play().catch(() => undefined);
  const stop = () => {
    const v = ref.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  };
  return (
    <div
      className={`${className} sh-cardmedia`}
      style={typeStyle(post.vertical)}
      // Touch browsers emulate mouseenter before click; ignore hover there so only the tap handler controls playback.
      onMouseEnter={() => { if (!touchOnly()) play(); }}
      onMouseLeave={() => { if (!touchOnly()) stop(); }}
      onClickCapture={(e) => {
        // Touch: a tap plays or pauses instead of opening the post. Next's Link skips a prevented click.
        if (!touchOnly() || (e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        const v = ref.current;
        if (v) v.paused ? play() : v.pause();
      }}
    >
      <PostLink id={post.id} className="sh-cardmedia__open" decorative>
        <video ref={ref} src={poster ? src : `${src}#t=0.5`} poster={poster ?? undefined} muted playsInline loop preload="metadata" />
      </PostLink>
      <button type="button" className="sh-cardmedia__sound" aria-label={muted ? 'Turn sound on' : 'Turn sound off'} onClick={() => setMuted((m) => !m)}>
        {muted ? <VolumeX size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}

function SlidesPreview({ post, className }: { post: HubPost; className: string }) {
  const frames = mediaFrames(post.media);
  const [i, setI] = useState(0);
  const start = useRef<number | null>(null);
  const go = (d: number) => setI((n) => Math.min(frames.length - 1, Math.max(0, n + d)));
  const frame = frames[Math.min(i, frames.length - 1)]!;
  return (
    <div
      className={`${className} sh-cardmedia`}
      style={typeStyle(post.vertical)}
      onTouchStart={(e) => { start.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        const s = start.current;
        start.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (s != null && end != null && Math.abs(end - s) > 40) go(end < s ? 1 : -1);
      }}
    >
      <PostLink id={post.id} className="sh-cardmedia__open" decorative>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={frame.src} alt="" loading="lazy" decoding="async" {...(frame.remote ? { referrerPolicy: 'no-referrer' as const } : {})} />
      </PostLink>
      {frames.length > 1 ? (
        <>
          {i > 0 ? <button type="button" className="sh-cardmedia__arrow sh-cardmedia__arrow--prev" aria-label="Previous slide" onClick={() => go(-1)}><ChevronLeft size={16} aria-hidden="true" /></button> : null}
          {i < frames.length - 1 ? <button type="button" className="sh-cardmedia__arrow sh-cardmedia__arrow--next" aria-label="Next slide" onClick={() => go(1)}><ChevronRight size={16} aria-hidden="true" /></button> : null}
          <span className="sh-thumb__count">{i + 1}/{frames.length}</span>
          <span className="sh-cardmedia__dots" aria-hidden="true">
            {frames.map((f, n) => <i key={`${n}-${f.src}`} className={n === i ? 'is-on' : undefined} />)}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** No video or slides to step through: the poster or first image, else the type's icon. */
function StillArt({ post }: { post: HubPost }) {
  const { src, remote } = thumbOf(post.media);
  const Icon = TYPE_ICON[post.vertical];
  return (
    <span className="sh-gallery__frame" style={typeStyle(post.vertical)} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" {...(remote ? { referrerPolicy: 'no-referrer' as const } : {})} />
      ) : (
        <span className="sh-gallery__empty"><Icon size={22} />{post.status === 'generating' ? 'Being made' : 'No preview'}</span>
      )}
    </span>
  );
}
