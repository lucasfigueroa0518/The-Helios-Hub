'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Volume2, VolumeX } from 'lucide-react';

import type { ReviewClip } from '@/lib/reels/review';

import '../review.css';

export function ReviewFeed({ clips }: { clips: ReviewClip[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const unlock = useCallback(() => setNeedsGesture(false), []);
  const block = useCallback(() => setNeedsGesture(true), []);
  const toggleSound = useCallback(() => {
    setSoundOn((on) => !on);
    setNeedsGesture(false);
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return undefined;
    const slides = [...root.querySelectorAll<HTMLElement>('[data-index]')];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        setActive(Number((visible.target as HTMLElement).dataset.index));
      },
      { root, threshold: [0.6, 0.85] },
    );
    for (const slide of slides) observer.observe(slide);
    return () => observer.disconnect();
  }, [clips.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== ' ') return;
      const root = scroller.current;
      if (!root) return;
      if (event.target instanceof HTMLElement && event.target.closest('button, a, input, textarea')) return;
      if (event.key === ' ') {
        if (!soundOn || needsGesture) {
          event.preventDefault();
          setSoundOn(true);
          setNeedsGesture(false);
          const slide = root.querySelector<HTMLElement>(`[data-index="${active}"]`);
          const video = slide?.querySelector('video');
          const song = slide?.querySelector('audio');
          if (video) {
            video.muted = false;
            void video.play().catch(() => undefined);
          }
          if (song && video) {
            song.muted = false;
            song.currentTime = video.currentTime;
            void song.play().catch(() => undefined);
          }
        }
        return;
      }
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? root.clientHeight : -root.clientHeight;
      root.scrollTo({ top: root.scrollTop + delta, behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [soundOn, needsGesture, active]);

  if (clips.length === 0) {
    return (
      <main className="ig-missing">
        <p>Nothing is ready to watch for today or yesterday.</p>
      </main>
    );
  }

  return (
    <main className="ig">
      <h1 className="ig-sr">Helios reels</h1>
      <div className="ig-stage">
        <div className="ig-phone">
          <div className={`ig-scroller${sheetOpen ? ' is-locked' : ''}`} ref={scroller}>
            {clips.map((clip, index) => (
              <ReviewSlide
                key={clip.id}
                clip={clip}
                index={index}
                count={clips.length}
                active={index === active}
                warm={index === active || index === active + 1}
                soundOn={soundOn}
                audible={soundOn && !needsGesture}
                onSound={toggleSound}
                onUnlock={unlock}
                onBlocked={block}
                onSheet={setSheetOpen}
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function ReviewSlide({
  clip,
  index,
  count,
  active,
  warm,
  soundOn,
  audible,
  onSound,
  onUnlock,
  onBlocked,
  onSheet,
}: {
  clip: ReviewClip;
  index: number;
  count: number;
  active: boolean;
  warm: boolean;
  soundOn: boolean;
  audible: boolean;
  onSound: () => void;
  onUnlock: () => void;
  onBlocked: () => void;
  onSheet: (open: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const wasActive = useRef(false);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    if (!active) {
      setPaused(false);
      setExpanded(false);
      onSheet(false);
    }
  }, [active, onSheet]);

  useEffect(() => {
    if (expanded) return;
    const el = captionRef.current;
    if (!el) return;
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [clip.caption, expanded, active]);

  useEffect(() => {
    const video = videoRef.current;
    const song = audioRef.current;
    if (!video) return undefined;
    video.volume = clip.videoVolume;
    if (song) song.volume = clip.songVolume;

    const align = () => {
      if (!song) return;
      if (Math.abs(song.currentTime - video.currentTime) > 0.25) song.currentTime = video.currentTime;
    };
    const playSong = () => {
      if (!song || video.muted) return;
      song.currentTime = video.currentTime;
      void song.play().catch(() => undefined);
    };
    const pauseSong = () => song?.pause();
    const mute = () => {
      if (song) song.muted = video.muted;
    };
    const events: Array<[string, () => void]> = [
      ['play', playSong],
      ['pause', pauseSong],
      ['seeked', align],
      ['timeupdate', align],
      ['volumechange', mute],
    ];
    for (const [name, handler] of events) video.addEventListener(name, handler);

    if (active && !wasActive.current) {
      video.currentTime = 0;
      if (song) song.currentTime = 0;
    }
    wasActive.current = active;

    if (!active || paused) {
      video.pause();
      pauseSong();
    } else {
      video.muted = !audible;
      if (song) song.muted = !audible;
      void video.play().then(() => {
        if (!song || video.muted || video.paused) return;
        song.currentTime = video.currentTime;
        void song.play().catch(() => undefined);
      }).catch(() => {
        if (!audible) return;
        video.muted = true;
        if (song) song.muted = true;
        onBlocked();
        void video.play().catch(() => undefined);
      });
    }

    return () => {
      for (const [name, handler] of events) video.removeEventListener(name, handler);
      pauseSong();
    };
  }, [active, paused, audible, onBlocked, clip.videoVolume, clip.songVolume, clip.song]);

  const closeCaption = () => {
    setExpanded(false);
    onSheet(false);
  };

  const startAudible = () => {
    const video = videoRef.current;
    const song = audioRef.current;
    if (!video) return;
    video.muted = false;
    if (song) song.muted = false;
    void video.play().then(() => {
      if (!song || video.paused) return;
      song.currentTime = video.currentTime;
      void song.play().catch(() => undefined);
    }).catch(() => undefined);
  };

  const onSurface = () => {
    const unlocking = soundOn && !audible;
    if (unlocking) {
      startAudible();
      onUnlock();
    }
    if (expanded) {
      closeCaption();
      return;
    }
    if (unlocking) {
      setPaused(false);
      return;
    }
    setPaused((value) => !value);
  };

  const onSoundClick = () => {
    if (soundOn && !audible) {
      startAudible();
      onUnlock();
      return;
    }
    if (!soundOn) startAudible();
    onSound();
  };

  const audioLabel = clip.song
    ? clip.song.artist
      ? `${clip.song.title} · ${clip.song.artist}`
      : clip.song.title
    : null;

  return (
    <article className="ig-slide" data-index={index} aria-label={`${clip.label}, reel ${index + 1} of ${count}`}>
      <video
        ref={videoRef}
        className="ig-video"
        src={clip.videoSrc}
        muted={!audible}
        playsInline
        loop
        preload={warm ? 'auto' : 'metadata'}
      />
      {clip.song ? <audio ref={audioRef} src={clip.song.src} preload={warm ? 'auto' : 'none'} /> : null}
      <button
        type="button"
        className="ig-hit"
        aria-label={expanded ? 'Close caption' : paused ? 'Play' : 'Pause'}
        onClick={onSurface}
      />
      <div className="ig-topshade" />
      <div className="ig-shade" />
      <p className="ig-day">{clip.label}</p>
      <p className="ig-count">
        {index + 1} / {count}
      </p>
      {paused && active ? (
        <div className="ig-play" aria-hidden="true">
          <Play size={32} fill="currentColor" />
        </div>
      ) : null}
      <div className={expanded ? 'ig-meta ig-meta--open' : 'ig-meta'}>
        <div className="ig-user">
          <img className="ig-avatar" src="/icon.png" alt="" />
          <span className="ig-handle">helios</span>
          <button
            type="button"
            className={`ig-sound${soundOn ? '' : ' is-waiting'}`}
            aria-pressed={soundOn}
            aria-label={soundOn ? 'Mute' : 'Play with sound'}
            onClick={onSoundClick}
          >
            {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
            {soundOn ? null : <span>Sound</span>}
          </button>
        </div>
        {clip.caption ? (
          <>
            <p ref={captionRef} className={expanded ? 'ig-cap ig-cap--open' : 'ig-cap ig-cap--clamp'}>
              {clip.caption}
            </p>
            {clamped || expanded ? (
              <button
                type="button"
                className="ig-more"
                onClick={() => {
                  const next = !expanded;
                  setExpanded(next);
                  onSheet(next);
                }}
              >
                {expanded ? 'less' : 'more'}
              </button>
            ) : null}
          </>
        ) : null}
        {audioLabel ? (
          <div className="ig-audio">
            <Volume2 size={14} aria-hidden="true" />
            <span>{audioLabel}</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}
