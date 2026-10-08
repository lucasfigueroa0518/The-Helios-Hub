'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The single-post view as a drawer (spec §3): right side on desktop, full
 * screen on a phone. A native modal <dialog> keeps focus inside, makes the
 * page behind inert, and closes on Escape. The URL holds `?post=<id>`, so it
 * deep-links; closing goes back when the drawer was opened in the app.
 */
export function PostDrawer({ closeHref, fullHref, title, children }: { closeHref: string; fullHref: string | null; title: string; children: ReactNode }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  const close = () => {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const deepLinked = entry?.name === window.location.href;
    if (deepLinked || window.history.length < 2) router.replace(closeHref, { scroll: false });
    else router.back();
  };

  return (
    <dialog
      ref={dialog}
      className="sh-drawer"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <div className="sh-drawer__panel">
        <div className="sh-drawer__bar">
          <button type="button" className="sh-btn" onClick={close} autoFocus>Close</button>
          {fullHref ? <Link href={fullHref} className="sh-link sh-subtle">Open as a page</Link> : null}
        </div>
        {children}
      </div>
    </dialog>
  );
}
