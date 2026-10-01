'use client';

import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { requestJson } from '@/lib/client-request';
import type { HealthPage, HealthSource } from '@/lib/reels/health';
import { formatNy } from '@/lib/reels/health-status';

const TONE: Record<HealthSource['tone'], string> = {
  fresh: 'Fresh',
  stale: 'Stale',
  failed: 'Failed',
  never: 'No success yet',
};

export function HealthView({ data }: { data: HealthPage }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const flight = [
    data.inFlight.copy > 0 && `${data.inFlight.copy} copy`,
    data.inFlight.frame > 0 && `${data.inFlight.frame} frame`,
    data.inFlight.video > 0 && `${data.inFlight.video} video`,
    data.inFlight.song > 0 && `${data.inFlight.song} song`,
    data.inFlight.publish > 0 && `${data.inFlight.publish} publish`,
  ].filter((item): item is string => Boolean(item));

  async function runNow() {
    setBusy(true);
    try {
      const result = await requestJson<{ queued: boolean; note?: string }>('/api/reels/run', { method: 'POST' });
      setNote(result.queued ? 'Run queued.' : result.note ?? 'A run is already pending.');
      router.refresh();
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className={`rh-verdict rh-verdict--${data.verdict.tone}`}>{data.verdict.sentence}</p>

      <div className="rh-strips">
        <section className="rh-card">
          <div className="rh-card__row">
            <h2 className="rh-card__title rh-card__title--flush">Night</h2>
            <button type="button" className="rh-btn rh-btn--xs" onClick={() => void runNow()} disabled={busy}>
              {busy ? <Loader2 size={12} className="rh-spin" /> : <Play size={12} />} {busy ? 'Running' : 'Run now'}
            </button>
          </div>
          <dl className="rh-facts">
            <div>
              <dt>Last run</dt>
              <dd>{data.night.status ?? 'None yet'}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{formatNy(data.night.finishedAt)}</dd>
            </div>
            <div>
              <dt>Ideas scored</dt>
              <dd>{data.night.ideasScored}</dd>
            </div>
            <div>
              <dt>Reels finished</dt>
              <dd>{data.night.reelsFinished}</dd>
            </div>
            <div>
              <dt>Reels published</dt>
              <dd>{data.night.reelsPublished}</dd>
            </div>
          </dl>
        </section>

        <section className="rh-card">
          <h2 className="rh-card__title">In flight</h2>
          <p>{flight.length > 0 ? flight.join(' · ') : 'Nothing in flight'}</p>
        </section>

        <section className="rh-card">
          <h2 className="rh-card__title">Publish path</h2>
          <dl className="rh-facts">
            <div>
              <dt>Live</dt>
              <dd>{data.publishPath.live ? 'On' : 'Off'}</dd>
            </div>
            <div>
              <dt>Meta</dt>
              <dd>{data.publishPath.meta ? 'Ready' : 'Missing'}</dd>
            </div>
            <div>
              <dt>Song pick</dt>
              <dd>{data.publishPath.songPick ? 'Approved' : 'Waiting'}</dd>
            </div>
            <div>
              <dt>Mix</dt>
              <dd>{data.publishPath.mix}</dd>
            </div>
          </dl>
        </section>
      </div>

      {note && <p className="rh-muted">{note}</p>}

      <section className="rh-card">
        <div className="rh-card__row">
          <h2 className="rh-card__title rh-card__title--flush">Sources</h2>
          <div className="segmented" role="tablist" aria-label="Source window">
            <a href="/reels/health?days=7" role="tab" aria-selected={data.windowDays === 7} className={`segmented__item${data.windowDays === 7 ? ' segmented__item--active' : ''}`}>
              7 days
            </a>
            <a href="/reels/health?days=30" role="tab" aria-selected={data.windowDays === 30} className={`segmented__item${data.windowDays === 30 ? ' segmented__item--active' : ''}`}>
              30 days
            </a>
          </div>
        </div>
        <p className="rh-muted">Bar is items kept. The thin mark is how many of those items sit on a published post.</p>
        <ul className="rh-sources">
          {data.sources.map((source) => {
            const expanded = open === source.id;
            return (
              <li key={source.id}>
                <button type="button" className="rh-source" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : source.id)}>
                  <span className={`rh-dot rh-dot--${source.tone === 'fresh' ? 'ok' : source.tone === 'failed' ? 'bad' : source.tone === 'stale' ? 'warn' : 'idle'}`} />
                  <span className="rh-source__name">
                    {source.name}
                    <span className="rh-muted">{TONE[source.tone]}</span>
                  </span>
                  <span className="rh-source__track" aria-hidden="true">
                    <span className="rh-source__ingested" style={{ width: `${(source.ingested / data.peak) * 100}%` }} />
                    <span className="rh-source__published" style={{ width: `${(source.published / data.peak) * 100}%` }} />
                  </span>
                  <span className="rh-source__count">
                    {source.ingested}
                    <span className="rh-muted"> / {source.published}</span>
                  </span>
                </button>
                {expanded && (
                  <p className="rh-source__detail">
                    Last success {formatNy(source.lastSuccessAt)}
                    {source.lastError ? ` · ${source.lastError}` : ''}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
