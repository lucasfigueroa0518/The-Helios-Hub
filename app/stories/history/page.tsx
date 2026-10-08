'use client';

import { FrameStrip, SERIES_LABEL, STATUS_LABEL, usd, useLoad, type SetRow } from '@/app/stories/shared';

/** History (plan §8): published sets with completion and early exits (plan §7). */
export default function StoriesHistory() {
  const { data, error } = useLoad<{ sets: SetRow[] }>('/api/stories/sets?view=history', 60_000);
  return (
    <main className="sh-main">
      <header className="sh-head">
        <h1>History</h1>
      </header>
      {error && <p className="sh-error">{error}</p>}
      {data && !data.sets.length && <p className="sh-muted">Nothing published yet.</p>}
      {data?.sets.map((s) => (
        <section key={s.id} className="sh-card">
          <div className="sh-card__head">
            <h2>
              {SERIES_LABEL[s.series]} <span className="sh-muted">· {s.ny_date}</span>
            </h2>
            <span className={`sh-status sh-status--${s.status}`}>{STATUS_LABEL[s.status]}</span>
            <span className="sh-muted">{usd(s.spend_usd)}</span>
          </div>
          {s.insights ? (
            <p className="sh-metrics">
              Reach {s.insights.reachFirst ?? '–'} · completion {s.insights.completion == null ? '–' : `${Math.round(s.insights.completion * 100)}%`} · exits on frames 1–3: {s.insights.exitsFirst3} · replies {s.insights.replies}
            </p>
          ) : (
            s.status === 'published' && <p className="sh-muted">No insights yet (Instagram reports a story's numbers for 24 hours; under 5 viewers it reports none).</p>
          )}
          {s.error && <p className="sh-error">{s.error}</p>}
          <FrameStrip set={s} />
        </section>
      ))}
    </main>
  );
}
