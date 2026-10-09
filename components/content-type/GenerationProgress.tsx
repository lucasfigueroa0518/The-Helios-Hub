'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import type { ProgressItem } from '@/lib/content-type/progress';

/** Pressing a generate button tells the strip to look now, instead of waiting for the next poll. */
export const PROGRESS_EVENT = 'content-type:progress';

const fmt = (secs: number) => {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const rough = (secs: number) => (secs < 90 ? `${Math.max(10, Math.round(secs / 10) * 10)} sec` : `${Math.round(secs / 60)} min`);

/**
 * "It's working": what this type is making right now, how long it has been
 * running, and about how much is left (from how long the same kind of job
 * usually takes). Looks every few seconds while anything is in flight, and
 * refreshes the page's posts when something finishes.
 */
export function GenerationProgress({ type }: { type: 'carousels' | 'stories' | 'explainers' }) {
  const router = useRouter();
  const [items, setItems] = useState<ProgressItem[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const had = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/content-type/progress?type=${type}`, { cache: 'no-store' });
      const json = (await res.json()) as { items?: ProgressItem[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Could not read progress.');
      const next = json.items ?? [];
      // Something that was running is gone: it finished or stopped. Show its new post.
      if (had.current > 0 && next.length < had.current) router.refresh();
      had.current = next.length;
      setItems(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [type, router]);

  useEffect(() => {
    void load();
    const onEvent = () => void setTimeout(() => void load(), 1200);
    window.addEventListener(PROGRESS_EVENT, onEvent);
    return () => window.removeEventListener(PROGRESS_EVENT, onEvent);
  }, [load]);
  // Poll quickly while something is making; slowly otherwise, to catch a run that starts on its own.
  useEffect(() => {
    const t = setInterval(() => void load(), items.length ? 4000 : 20000);
    return () => clearInterval(t);
  }, [load, items.length]);
  useEffect(() => {
    if (!items.length) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [items.length]);

  if (error && !items.length) return null;
  if (!items.length) return null;
  return (
    <section className="rh-progress" aria-live="polite" aria-label="Generating">
      {items.map((item) => {
        const since = Date.parse(item.startedAt ?? item.requestedAt);
        const elapsed = (now - since) / 1000;
        const left = item.typicalSeconds != null ? item.typicalSeconds - elapsed : null;
        const pct = item.typicalSeconds && item.state === 'running' ? Math.min(95, Math.max(4, (elapsed / item.typicalSeconds) * 100)) : null;
        return (
          <div key={item.id} className="rh-progress__row">
            <Loader2 size={16} className="rh-spin" aria-hidden="true" />
            <div className="rh-progress__main">
              <strong>{item.label}</strong>
              <span className="rh-muted">
                {item.state === 'queued' ? `Queued · waiting for the worker · ${fmt(elapsed)}` : `${item.stage ? `${item.stage.replaceAll('_', ' ')} · ` : 'Running · '}${fmt(elapsed)} so far`}
                {item.state === 'running' && left != null ? (left > 15 ? ` · about ${rough(left)} left` : ' · finishing up, longer than usual') : ''}
                {item.state === 'running' && item.typicalSeconds == null ? ' · no history yet to estimate the time left' : ''}
              </span>
              {pct != null ? <span className="rh-progress__bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span> : <span className="rh-progress__bar rh-progress__bar--wait" aria-hidden="true"><span /></span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
