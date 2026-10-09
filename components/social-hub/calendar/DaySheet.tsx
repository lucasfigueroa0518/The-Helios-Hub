'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

import { HubLink, useHubParams } from '@/components/social-hub/nav/HubNav';

/**
 * A day of the calendar as a side panel (BRIEFS.md §2), driven by `?day=`:
 * deep-linkable, closes on Escape, Back, or the backdrop, and the month stays
 * behind it. Opened in the app, closing goes back; opened from a link, it
 * removes the day from the URL.
 */
export function DaySheet({ title, sub, prevHref, nextHref, children }: { title: string; sub: ReactNode; prevHref: string; nextHref: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const { hrefWith } = useHubParams();

  useEffect(() => {
    // A ref survives StrictMode's second run, which would otherwise record the sheet's own Close button.
    opener.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = dialog.current;
    if (el && !el.open) {
      el.showModal();
      el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    return () => {
      const back = opener.current;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  const close = () => {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const deepLinked = entry?.name === window.location.href;
    if (deepLinked || window.history.length < 2) router.replace(hrefWith({ day: null }), { scroll: false });
    else router.back();
  };

  return (
    <dialog
      ref={dialog}
      className="sh-drawer sh-drawer--narrow"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="sh-drawer__panel">
        <div className="sh-drawer__bar">
          <div className="sh-day-sheet__title">
            <h2 className="sh-title">{title}</h2>
            <span className="sh-muted">{sub}</span>
          </div>
          <div className="sh-drawer__tools">
            {/* Step through days without closing; replace, so Back still leaves the sheet. */}
            <HubLink className="sh-btn sh-btn--icon" href={prevHref} history="replace" aria-label="Previous day"><ChevronLeft size={16} aria-hidden="true" /></HubLink>
            <HubLink className="sh-btn sh-btn--icon" href={nextHref} history="replace" aria-label="Next day"><ChevronRight size={16} aria-hidden="true" /></HubLink>
            <button type="button" className="sh-btn" onClick={close} data-autofocus>
              <X size={14} aria-hidden="true" />
              Close
            </button>
          </div>
        </div>
        {children}
      </div>
    </dialog>
  );
}
