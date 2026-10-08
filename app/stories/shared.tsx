'use client';

import { useCallback, useEffect, useState } from 'react';

export const SERIES_LABEL: Record<string, string> = { morning_download: 'Morning Download', guess_the_number: 'Guess the Number', free_vs_paid: 'Free vs. Paid' };
export const STATUS_LABEL: Record<string, string> = {
  requested: 'Requested', building: 'Building', ready: 'Ready for review', approved: 'Approved', scheduled: 'Scheduled', publishing: 'Publishing',
  published: 'Published', rejected: 'Rejected', failed: 'Failed', skipped: 'Skipped',
};

export type SetRow = {
  id: string; series: string; ny_date: string; status: string; trigger: string; style: string; flagged: boolean; error: string | null; spend_usd: number; publish_at: string | null;
  frames: Array<{ id: string; seq: number; role: string; backdrop: string; flagged: boolean; storage_path: string | null }>;
  insights: { completion: number | null; exitsFirst3: number; replies: number; reachFirst: number | null } | null;
};

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export function useLoad<T>(path: string, everyMs = 15_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<T>(path).then((d) => (setData(d), setError(null))).catch((e: Error) => setError(e.message)), [path]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);
  return { data, error, reload: load };
}

export const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '');

/** The set's frames as phone-sized previews (plan §8). */
export function FrameStrip({ set }: { set: SetRow }) {
  return (
    <div className="sh-strip">
      {set.frames.map((f) => (
        <figure key={f.id} className={`sh-phone${f.flagged ? ' sh-phone--flagged' : ''}`}>
          {f.storage_path ? <img src={`/api/stories/frames/${f.id}`} alt={`${f.role} frame`} loading="lazy" /> : <div className="sh-phone__empty">{f.role}</div>}
          <figcaption>
            {f.seq}. {f.role}
            {f.flagged ? ' · flagged' : ''}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
