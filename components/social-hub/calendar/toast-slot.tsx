'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * One toast place for the week page. The board and the Schedules dropdown
 * each have a toast; both render into the same host (bottom, or top while a
 * panel is open), which stacks them, so they never overlap. Without a host
 * (or before mount) the toast renders in place, as the board's always did.
 */

export function ToastHosts() {
  return (
    <>
      <div className="sh-board__toasts sh-toast-host" data-toast-host="bottom" aria-live="polite" />
      <div className="sh-board__toasts sh-toast-host is-top" data-toast-host="top" aria-live="polite" />
    </>
  );
}

export function ToastSlot({ top, children }: { top: boolean; children: ReactNode }) {
  const [hosts, setHosts] = useState<{ top: Element | null; bottom: Element | null } | null>(null);
  useEffect(() => {
    setHosts({ top: document.querySelector('[data-toast-host="top"]'), bottom: document.querySelector('[data-toast-host="bottom"]') });
  }, []);
  const host = hosts ? (top ? hosts.top : hosts.bottom) : null;
  if (host) return createPortal(children, host);
  return <div className={`sh-board__toasts${top ? ' is-top' : ''}`} aria-live="polite">{children}</div>;
}
