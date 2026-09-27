'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/* Shared Trial Reels pieces: the hub and the SFX review page use the same player, drawer, and sections. */

/**
 * A reel in its frame. Hover players autoplay muted; a player with controls
 * autoplays with sound when `sound` is set (D-128), so the browser may still
 * hold it muted until the viewer presses play.
 */
export function ReelVideo({
  src,
  poster,
  playing,
  controls,
  sound,
  autoPlay,
}: {
  src: string;
  poster?: string | null;
  playing?: boolean;
  controls?: boolean;
  sound?: boolean;
  autoPlay?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || controls) return;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing, controls]);
  return (
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
