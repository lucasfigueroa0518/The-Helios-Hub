'use client';

import { useState } from 'react';

import { SERIES_LABEL, api, useLoad } from '@/app/stories/shared';

type Settings = { series: Record<string, { enabled: boolean; auto: boolean; style: string; window: { start: string; end: string; days: number[] } }>; monthlyWatchUsd: number; models: { copy: string; review: string } };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Settings (plan §8): per series enabled and the auto switch (S-05: confirmation to turn on). */
export default function StoriesSettings() {
  const { data, error, reload } = useLoad<Settings>('/api/stories/settings', 60_000);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (series: string, patch: Record<string, unknown>) => {
    try {
      await api('/api/stories/settings', { series, ...patch });
      setMsg('Saved.');
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <main className="sh-main">
      <header className="sh-head">
        <h1>Settings</h1>
        {data && <p className="sh-muted">Monthly watch: ${data.monthlyWatchUsd}. Copy: {data.models.copy}. Review: {data.models.review}. Times are New York.</p>}
      </header>
      {msg && <p className="sh-notice">{msg}</p>}
      {error && <p className="sh-error">{error}</p>}
      {data &&
        Object.entries(data.series).map(([id, s]) => (
          <section key={id} className="sh-card">
            <div className="sh-card__head">
              <h2>{SERIES_LABEL[id]}</h2>
              <span className="sh-muted">
                {s.window.days.map((d) => DAYS[d]).join(', ')} · {s.window.start}–{s.window.end} · {s.style}
              </span>
            </div>
            <label className="sh-switch">
              <input type="checkbox" checked={s.enabled} onChange={(e) => save(id, { enabled: e.target.checked })} /> Enabled
            </label>
            <label className="sh-switch">
              <input
                type="checkbox"
                checked={s.auto}
                onChange={(e) => {
                  if (e.target.checked && !confirm(`Turn on auto for ${SERIES_LABEL[id]}? Sets will build, pass the review, and post in their window without you clicking. Each build makes live model and web calls.`)) return;
                  void save(id, { auto: e.target.checked, confirm: e.target.checked });
                }}
              />{' '}
              Auto: build and post on its own
            </label>
          </section>
        ))}
    </main>
  );
}
