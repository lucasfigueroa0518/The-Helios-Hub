'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { useRunProgress } from '@/components/content-type/run-progress';
import { elapsedSeconds, runStatusText, type RunSnapshot } from '@/lib/content-type/run-status';
import type { ProgressItem } from '@/lib/content-type/progress';

export { PROGRESS_EVENT } from '@/components/content-type/run-progress';

const rough = (secs: number) => (secs < 90 ? `${Math.max(10, Math.round(secs / 10) * 10)} sec` : `${Math.round(secs / 60)} min`);

function asRun(item: ProgressItem): RunSnapshot {
  return { state: item.state, stage: item.stage, error: item.error, requestedAt: item.requestedAt, startedAt: item.startedAt };
}

/**
 * "It's working": the same status sentence the row and the sidebar use, plus
 * a rough time-left while a run is actually going.
 */
export function GenerationProgress() {
  // Failures belong on the idea's own row and card, not in a list above the page.
  const items = useRunProgress().filter((item) => item.state !== 'failed');
  const [now, setNow] = useState(() => Date.now());
  const live = items.length > 0;

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  if (!items.length) return null;
  return (
    <section className="rh-progress" aria-live="polite" aria-label="Generating">
      {items.map((item) => {
        const run = asRun(item);
        const elapsed = elapsedSeconds(run, now);
        const left = item.state === 'running' && item.typicalSeconds != null && elapsed != null ? item.typicalSeconds - elapsed : null;
        const pct = item.typicalSeconds && item.state === 'running' && elapsed != null ? Math.min(95, Math.max(4, (elapsed / item.typicalSeconds) * 100)) : null;
        const extra = item.state === 'running' && left != null ? (left > 15 ? ` · about ${rough(left)} left` : ' · finishing up, longer than usual') : '';
        const since = item.startedAt ? new Date(item.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' }) : null;
        const picked = item.state === 'running' && since ? ` · worker picked it up at ${since} ET` : '';
        const history = item.state === 'running' && item.typicalSeconds == null ? ' · no history yet to estimate the time left' : '';
        return (
          <div key={item.id} className={`rh-progress__row${item.state === 'failed' ? ' is-failed' : ''}`}>
            {item.state === 'failed' ? <AlertTriangle size={16} aria-hidden="true" /> : <Loader2 size={16} className="rh-spin" aria-hidden="true" />}
            <div className="rh-progress__main">
              <strong>{item.label}</strong>
              <span className="rh-muted">{runStatusText(run, now)}{picked}{extra}{history}</span>
              {item.state === 'failed' ? null : pct != null ? <span className="rh-progress__bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span> : <span className="rh-progress__bar rh-progress__bar--wait" aria-hidden="true"><span /></span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
