'use client';

import { useRouter } from 'next/navigation';
import { Maximize2, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A post over the list it was opened from (REVISIONS G10). It's an
 * intercepted route, so the list behind stays mounted and keeps its scroll;
 * the URL is the post's own and survives a refresh as the full page. A
 * native modal <dialog> traps focus and closes on Escape; closing goes back,
 * and focus returns to the row that opened it.
 */
export function PostDrawer({ title, crumbs, fullHref, children }: { title: string; crumbs: ReactNode; fullHref: string; children: ReactNode }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  // In a ref, not the effect: StrictMode runs the effect twice, and the second
  // run must not take the drawer's own focused button for the row that opened it.
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const w = window as Window & { __shOpener?: HTMLElement };
    opener.current ??= w.__shOpener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    w.__shOpener = undefined;
    const el = dialog.current;
    if (el && !el.open) {
      el.showModal();
      // React's autoFocus fires before the dialog opens; focus Close once it can take focus.
      el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    return () => {
      const back = opener.current;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  const close = () => router.back();

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
          <div className="sh-drawer__crumbs">{crumbs}</div>
          <div className="sh-drawer__tools">
            {/* A plain link: a soft one would be intercepted into the drawer again. */}
            <a href={fullHref} className="sh-btn sh-btn--quiet" title="Open as a page">
              <Maximize2 size={14} aria-hidden="true" />
              <span className="sh-drawer__tool-label">Open as a page</span>
            </a>
            <button type="button" className="sh-btn" onClick={close} data-autofocus>
              <X size={14} aria-hidden="true" />
              Close
            </button>
          </div>
        </div>
        <div className="sh-drawer__body">{children}</div>
      </div>
    </dialog>
  );
}
