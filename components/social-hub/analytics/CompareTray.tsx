'use client';

import { usePathname } from 'next/navigation';
import { GitCompare, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { HubLink } from '@/components/social-hub/nav/HubNav';
import { hubBaseOf } from '@/lib/social-hub/links';

/**
 * Picking posts to compare (BRIEFS.md §3): checkboxes on any analytics table
 * feed one tray that follows you across type pages (kept for the browser
 * session), and opens the comparison once 2–6 are picked.
 */

const KEY = 'sh-compare';
const MAX = 6;

type Picked = { id: string; name: string };

const Ctx = createContext<{ picked: Picked[]; toggle: (p: Picked) => void; clear: () => void } | null>(null);

function read(): Picked[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Picked[]) : [];
    return Array.isArray(list) ? list.filter((p) => typeof p?.id === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function CompareProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<Picked[]>([]);
  useEffect(() => setPicked(read()), []);
  const save = (next: Picked[]) => {
    setPicked(next);
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private mode: the tray still works for this page.
    }
  };
  const toggle = useCallback((p: Picked) => {
    setPicked((current) => {
      const next = current.some((x) => x.id === p.id) ? current.filter((x) => x.id !== p.id) : current.length >= MAX ? current : [...current, p];
      try {
        window.sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);
  const value = useMemo(() => ({ picked, toggle, clear: () => save([]) }), [picked, toggle]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Tray />
    </Ctx.Provider>
  );
}

export function ComparePick({ id, name }: { id: string; name: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const on = ctx.picked.some((p) => p.id === id);
  const full = !on && ctx.picked.length >= MAX;
  return (
    <label className="sh-pick" title={full ? `Up to ${MAX} posts` : undefined}>
      <input type="checkbox" checked={on} disabled={full} onChange={() => ctx.toggle({ id, name })} />
      <span className="sh-sr">Compare {name}</span>
    </label>
  );
}

function Tray() {
  const ctx = useContext(Ctx);
  const path = usePathname() ?? '/social/analytics';
  if (!ctx || ctx.picked.length === 0 || path.includes('/analytics/compare')) return null;
  const base = hubBaseOf(path);
  const ready = ctx.picked.length >= 2;
  return (
    <div className="sh-tray" role="region" aria-label="Posts to compare">
      <span className="sh-tray__count"><strong>{ctx.picked.length}</strong> selected</span>
      <span className="sh-tray__names">{ctx.picked.map((p) => p.name).join(' · ')}</span>
      <button type="button" className="sh-btn sh-btn--quiet" onClick={ctx.clear}><X size={14} aria-hidden="true" />Clear</button>
      {ready ? (
        <HubLink className="sh-btn sh-btn--primary" href={`${base}/analytics/compare?ids=${encodeURIComponent(ctx.picked.map((p) => p.id).join(','))}`}>
          <GitCompare size={14} aria-hidden="true" />Compare
        </HubLink>
      ) : (
        <span className="sh-subtle">Pick one more to compare</span>
      )}
    </div>
  );
}

export function useCompare() {
  return useContext(Ctx);
}
