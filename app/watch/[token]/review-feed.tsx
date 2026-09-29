'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Volume2, VolumeX } from 'lucide-react';

import type { ReviewClip } from '@/lib/reels/review';
import { reviewSlideIndex } from '@/lib/reels/review-scroll';

import '../review.css';

export function ReviewFeed({ clips }: { clips: ReviewClip[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  activeRef.current = active;
  const [soundOn, setSoundOn] = useState(true);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const unlock = useCallback(() => setNeedsGesture(false), []);
  const blockSound = useCallback(() => setNeedsGesture(true), []);
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

  /** Review links should open with sound; retry once the browser allows playback. */
  useEffect(() => {
    const unlockFromGesture = () => setNeedsGesture(false);
    window.addEventListener('pointerdown', unlockFromGesture, { once: true, capture: true });
    window.addEventListener('keydown', unlockFromGesture, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlockFromGesture, { capture: true });
      window.removeEventListener('keydown', unlockFromGesture, { capture: true });
    };
  }, []);

  useEffect(() => {
    setSheetOpen(false);
  }, [active]);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = reviewSlideIndex(root.scrollTop, root.clientHeight, clips.length, activeRef.current);
      activeRef.current = next;
      setActive((current) => (current === next ? current : next));
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    update();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
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
          startSlideAudible(slide);
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
        <p>Nothing is ready to watch.</p>
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
                near={Math.abs(index - active) <= 1}
                ahead={index === active + 1}
                soundOn={soundOn}
                audible={soundOn && !needsGesture}
                onSound={toggleSound}
                onUnlock={unlock}
                onBlocked={blockSound}
                onSheet={setSheetOpen}
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function startSlideAudible(slide: HTMLElement | null | undefined) {
  if (!slide) return;
  const video = slide.querySelector('video');
  const song = slide.querySelector('audio');
  if (!video) return;
  video.muted = false;
  video.currentTime = 0;
  if (song) {
    song.muted = false;
    song.currentTime = 0;
  }
  void video.play().catch(() => undefined);
  if (song) void song.play().catch(() => undefined);
}

function ReviewSlide({
  clip,
  index,
  count,
  active,
  near,
  ahead,
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
  near: boolean;
  ahead: boolean;
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
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;
  const down = useRef<{ x: number; y: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [buffering, setBuffering] = useState(false);

  useEffect(() => {
    if (!active) {
      setPaused(false);
      setExpanded(false);
    }
  }, [active]);

  useEffect(() => {
    if (expanded) return;
    const el = captionRef.current;
    if (!el) return;
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [clip.caption, expanded, active]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      setFrameReady(false);
      setBuffering(false);
      return undefined;
    }
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      if (!active || paused || video.readyState >= 3) {
        setBuffering(false);
        return;
      }
      timer = window.setTimeout(() => {
        if (video.readyState < 3) setBuffering(true);
      }, 220);
    };
    const ready = () => {
      if (video.readyState >= 2) setFrameReady(true);
      if (video.readyState >= 3) {
        window.clearTimeout(timer);
        setBuffering(false);
      }
    };
    if (video.readyState >= 2) setFrameReady(true);
    else setFrameReady(false);
    arm();
    video.addEventListener('loadeddata', ready);
    video.addEventListener('canplay', ready);
    video.addEventListener('playing', ready);
    const failed = () => {
      window.clearTimeout(timer);
      setBuffering(false);
    };
    video.addEventListener('waiting', arm);
    video.addEventListener('stalled', arm);
    video.addEventListener('error', failed);
    return () => {
      window.clearTimeout(timer);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('playing', ready);
      video.removeEventListener('waiting', arm);
      video.removeEventListener('stalled', arm);
      video.removeEventListener('error', failed);
    };
  }, [active, paused, near, clip.videoSrc]);

  useEffect(() => {
    const video = videoRef.current;
    const song = audioRef.current;
    if (!video) {
      wasActive.current = false;
      return undefined;
    }
    video.volume = clip.videoVolume;
    video.setAttribute('fetchpriority', active ? 'high' : ahead ? 'auto' : 'low');
    if (song) song.volume = clip.songVolume;

    let seeking = false;
    let seekTimer = 0;
    const syncSong = (force: boolean) => {
      if (!song || !active || video.muted || video.paused) return;
      const drift = song.readyState >= 1 ? Math.abs(song.currentTime - video.currentTime) : 0;
      if (!seeking && song.readyState >= 1 && (force || drift > 0.35)) {
        seeking = true;
        try {
          song.currentTime = video.currentTime;
        } catch {
          // Not seekable yet. loadedmetadata tries once more.
        }
        window.clearTimeout(seekTimer);
        seekTimer = window.setTimeout(() => {
          seeking = false;
        }, 500);
      }
      if (!song.paused) return;
      const pending = song.play();
      if (!pending) return;
      pending.catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : '';
        if (name === 'NotAllowedError') onBlockedRef.current();
      });
    };
    const onPlay = () => syncSong(false);
    const onTime = () => syncSong(false);
    const onSongReady = () => syncSong(true);
    video.addEventListener('play', onPlay);
    video.addEventListener('timeupdate', onTime);
    song?.addEventListener('loadedmetadata', onSongReady);

    const becameActive = active && !wasActive.current;
    wasActive.current = active;

    if (!active || paused) {
      video.pause();
      song?.pause();
    } else {
      if (becameActive) {
        try {
          if (video.currentTime > 0.08) video.currentTime = 0;
          if (song && song.currentTime > 0.08) song.currentTime = 0;
        } catch {
          // The file is still opening. Playback starts at the beginning anyway.
        }
      }
      const wantSound = audible;
      video.muted = !wantSound;
      if (song) song.muted = !wantSound;
      // Call both in this turn so one tap can start the video and the song.
      const videoStart = video.play();
      if (wantSound) syncSong(true);
      void videoStart?.catch(() => {
        if (!wantSound) return;
        video.muted = true;
        if (song) song.muted = true;
        onBlockedRef.current();
        void video.play().catch(() => undefined);
      });
    }

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('timeupdate', onTime);
      song?.removeEventListener('loadedmetadata', onSongReady);
      window.clearTimeout(seekTimer);
    };
  }, [active, paused, audible, near, ahead, clip.videoVolume, clip.songVolume, clip.song, clip.videoSrc]);

  const closeCaption = () => {
    setExpanded(false);
    onSheet(false);
  };

  const openCaption = () => {
    setExpanded(true);
    onSheet(true);
  };

  const startAudible = () => {
    const video = videoRef.current;
    const song = audioRef.current;
    if (!video) return;
    video.muted = false;
    if (song) song.muted = false;
    video.currentTime = 0;
    if (song) song.currentTime = 0;
    void video.play().catch(() => undefined);
    if (song) void song.play().catch(() => undefined);
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
      {near ? (
        <video
          ref={videoRef}
          className={frameReady ? 'ig-video is-ready' : 'ig-video'}
          src={clip.videoSrc}
          muted={!active || !audible}
          playsInline
          loop
          preload={active || ahead ? 'auto' : 'metadata'}
          disablePictureInPicture
        />
      ) : null}
      {(active || ahead) && clip.song ? (
        <audio ref={audioRef} src={clip.song.src} preload="auto" muted={!active || !audible} />
      ) : null}
      <button
        type="button"
        className="ig-hit"
        aria-label={expanded ? 'Close caption' : paused ? 'Play' : 'Pause'}
        onPointerDown={(event) => {
          down.current = { x: event.clientX, y: event.clientY };
        }}
        onClick={(event) => {
          const start = down.current;
          down.current = null;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return;
          onSurface();
        }}
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
      {buffering && active && !paused ? <div className="ig-wait" aria-hidden="true" /> : null}
      <div className={expanded ? 'ig-meta ig-meta--open' : 'ig-meta'}>
        <div className="ig-user">
          <img className="ig-avatar" src="/icon.png" alt="" />
          <span className="ig-handle">helios</span>
          <button
            type="button"
            className={`ig-sound${audible ? '' : ' is-waiting'}`}
            aria-pressed={audible}
            aria-label={audible ? 'Mute' : 'Play with sound'}
            onClick={onSoundClick}
          >
            {audible ? <Volume2 size={18} /> : <VolumeX size={18} />}
            {audible ? null : <span>Sound</span>}
          </button>
        </div>
        {clip.caption ? (
          <>
            <p
              ref={captionRef}
              className={expanded ? 'ig-cap ig-cap--open' : 'ig-cap ig-cap--clamp'}
              role={expanded ? undefined : 'button'}
              tabIndex={expanded ? undefined : 0}
              aria-expanded={expanded}
              onClick={() => {
                if (!expanded) openCaption();
              }}
              onKeyDown={(event) => {
                if (expanded || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                openCaption();
              }}
            >
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
