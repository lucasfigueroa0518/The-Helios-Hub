'use client';

import { useCallback, useContext, useEffect, useRef, useState, createContext, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import type { ProgressItem } from '@/lib/content-type/progress';

/** Pressing a generate button tells the strip to look now, instead of waiting for the next poll. */
export const PROGRESS_EVENT = 'content-type:progress';

const RunProgressContext = createContext<ProgressItem[]>([]);

/** The latest read of what this type is making, shared by the strip, the rows, and the sidebar. */
export function useRunProgress(): ProgressItem[] {
  return useContext(RunProgressContext);
}

/**
 * Polls the type's runs. While one is in flight the page's other status lines
 * read the same list, so a stage change shows up in the row and the sidebar
 * without waiting for the cached dataset.
 */
export function RunProgressProvider({ type, children }: { type: 'carousels' | 'stories' | 'explainers'; children: ReactNode }) {
  const router = useRouter();
  const [items, setItems] = useState<ProgressItem[]>([]);
  const had = useRef(0);
  const active = items.some((item) => item.state !== 'failed');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/content-type/progress?type=${type}`, { cache: 'no-store' });
      const json = (await res.json()) as { items?: ProgressItem[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Could not read progress.');
      const next = json.items ?? [];
      const inFlight = (list: ProgressItem[]) => list.filter((item) => item.state !== 'failed').length;
      if (had.current > 0 && inFlight(next) < had.current) router.refresh();
      had.current = inFlight(next);
      setItems(next);
    } catch {
      // A missed poll leaves the last status on screen.
    }
  }, [type, router]);

  useEffect(() => {
    void load();
    const onEvent = () => void setTimeout(() => void load(), 1200);
    window.addEventListener(PROGRESS_EVENT, onEvent);
    return () => window.removeEventListener(PROGRESS_EVENT, onEvent);
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => void load(), active ? 4000 : 20000);
    return () => clearInterval(t);
  }, [load, active]);

  return <RunProgressContext.Provider value={items}>{children}</RunProgressContext.Provider>;
}
