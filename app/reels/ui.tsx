'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/* Shared Trial Reels pieces: the hub and the SFX review page use the same player, drawer, and sections. */

/**
 * A reel in its frame. Hover players autoplay muted; a player with controls
 * autoplays with sound when `sound` is set (D-128), so the browser may still
 * hold it muted until the viewer presses play.
 *
 * `track` plays a song alongside the video, synced from 0:00 (D-154): it
 * follows the video's play, pause, seek, and mute, at the given volumes
 * (0–1, the publish mix), so the preview sounds like the post.
 */
export function ReelVideo({
  src,
  poster,
  playing,
  controls,
  sound,
  autoPlay,
  track,
}: {
  src: string;
  poster?: string | null;
  playing?: boolean;
  controls?: boolean;
  sound?: boolean;
  autoPlay?: boolean;
  track?: { src: string; songVolume: number; videoVolume: number } | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || controls) return;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing, controls]);
  useEffect(() => {
    const video = ref.current;
    const song = audio.current;
    if (!video || !song || !track) return undefined;
    video.volume = track.videoVolume;
    song.volume = track.songVolume;
    const align = () => {
      if (Math.abs(song.currentTime - video.currentTime) > 0.25) song.currentTime = video.currentTime;
    };
    const play = () => {
      song.currentTime = video.currentTime;
      void song.play().catch(() => undefined);
    };
    const pause = () => song.pause();
    const mute = () => {
      song.muted = video.muted;
    };
    const events: Array<[string, () => void]> = [
      ['play', play],
      ['pause', pause],
      ['ended', pause],
      ['seeked', align],
      ['timeupdate', align],
      ['volumechange', mute],
    ];
    for (const [name, handler] of events) video.addEventListener(name, handler);
    if (!video.paused) play();
    return () => {
      for (const [name, handler] of events) video.removeEventListener(name, handler);
      song.pause();
    };
  }, [track]);
  return (
    <>
      <video
        ref={ref}
        className="rh-media__fill"
        src={src}
        poster={poster ?? undefined}
        muted={!sound}
        loop={!sound}
        playsInline
        controls={controls}
        autoPlay={autoPlay ?? controls}
        preload="metadata"
      />
      {track && <audio ref={audio} src={track.src} preload="auto" />}
    </>
  );
}

export function Drawer({
  label,
  onClose,
  wide,
  children,
}: {
  label: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <div className="rh-drawer" role="presentation">
      <button type="button" className="rh-drawer__scrim" aria-label="Close" onClick={onClose} />
      <div
        ref={panel}
        className={`rh-drawer__panel${wide ? ' rh-drawer__panel--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <button type="button" className="rh-drawer__close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

export function Section({ title, open, children, count }: { title: ReactNode; open?: boolean; count?: number; children: ReactNode }) {
  return (
    <details className="rh-section" open={open}>
      <summary>
        {title}
        {count != null && count > 0 && <span className="rh-section__count">{count}</span>}
      </summary>
      <div className="rh-section__body">{children}</div>
    </details>
  );
}
