'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { requestJson } from '@/lib/client-request';
import type { HealthPage, HealthSource } from '@/lib/reels/health';
import { barsInView, chartYMax, formatNy, visibleIndexRange } from '@/lib/reels/health-status';

const TONE: Record<HealthSource['tone'], string> = {
  fresh: 'Fresh',
  stale: 'Stale',
  failed: 'Failed',
  never: 'No success yet',
};

export function HealthView({ data }: { data: HealthPage }) {
  const router = useRouter();
  const [page, setPage] = useState(data);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const watching =
    page.activity != null || page.night.status === 'running' || page.night.status === 'requested';

  useEffect(() => {
    setPage(data);
  }, [data]);

  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    const tick = () => {
      void requestJson<HealthPage>(`/api/reels/health?days=${page.windowDays}`)
        .then((next) => {
          if (!cancelled) setPage(next);
        })
        .catch(() => undefined);
    };
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [watching, page.windowDays]);

  const flight = [
    page.inFlight.copy > 0 && `${page.inFlight.copy} copy`,
    page.inFlight.frame > 0 && `${page.inFlight.frame} frame`,
    page.inFlight.video > 0 && `${page.inFlight.video} video`,
    page.inFlight.song > 0 && `${page.inFlight.song} song`,
    page.inFlight.publish > 0 && `${page.inFlight.publish} publish`,
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

  const stage =
    page.activity && page.activity !== page.verdict.sentence ? page.activity : null;

  return (
    <>
      <p className={`rh-verdict rh-verdict--${page.verdict.tone}`} aria-live="polite">
        {page.verdict.sentence}
      </p>

      <div className="rh-strips">
        <section className="rh-card">
          <div className="rh-card__row">
            <h2 className="rh-card__title rh-card__title--flush">Night</h2>
            <button type="button" className="rh-btn rh-btn--xs" onClick={() => void runNow()} disabled={busy}>
              {busy ? <Loader2 size={12} className="rh-spin" /> : <Play size={12} />} {busy ? 'Running' : 'Run now'}
            </button>
          </div>
          {stage && <p className="rh-activity">{stage}</p>}
          <dl className="rh-facts">
            <div>
              <dt>Last run</dt>
              <dd>{page.night.status ?? 'None yet'}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{formatNy(page.night.finishedAt)}</dd>
            </div>
            <div>
              <dt>Ideas scored</dt>
              <dd>{page.night.ideasScored}</dd>
            </div>
            <div>
              <dt>Reels finished</dt>
              <dd>{page.night.reelsFinished}</dd>
            </div>
            <div>
              <dt>Reels published</dt>
              <dd>{page.night.reelsPublished}</dd>
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
              <dd>{page.publishPath.live ? 'On' : 'Off'}</dd>
            </div>
            <div>
              <dt>Meta</dt>
              <dd>{page.publishPath.meta ? 'Ready' : 'Missing'}</dd>
            </div>
            <div>
              <dt>Song pick</dt>
              <dd>{page.publishPath.songPick ? 'Approved' : 'Waiting'}</dd>
            </div>
            <div>
              <dt>Mix</dt>
              <dd>{page.publishPath.mix}</dd>
            </div>
          </dl>
        </section>
      </div>

      {note && <p className="rh-muted">{note}</p>}

      <section className="rh-card">
        <div className="rh-card__row">
          <h2 className="rh-card__title rh-card__title--flush">Sources</h2>
          <div className="segmented" role="tablist" aria-label="Source window">
            <a href="/reels/health?days=7" role="tab" aria-selected={page.windowDays === 7} className={`segmented__item${page.windowDays === 7 ? ' segmented__item--active' : ''}`}>
              7 days
            </a>
            <a href="/reels/health?days=30" role="tab" aria-selected={page.windowDays === 30} className={`segmented__item${page.windowDays === 30 ? ' segmented__item--active' : ''}`}>
              30 days
            </a>
          </div>
        </div>
        <p className="rh-muted">
          Bars are items kept, highest first. Scroll sideways. The scale follows the sources in view. Green is how many of those kept items sit on a published post.
        </p>
        <SourceChart sources={page.sources} />
      </section>
    </>
  );
}

function SourceChart({ sources }: { sources: HealthSource[] }) {
  const ranked = useMemo(
    () => [...sources].sort((a, b) => b.ingested - a.ingested || a.name.localeCompare(b.name)),
    [sources],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setViewport(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const shown = barsInView(viewport);
  const slot = viewport > 0 ? viewport / shown : 0;
  const range = visibleIndexRange(ranked.length, scrollLeft, viewport, slot);
  const yMax = chartYMax(ranked.slice(range.start, range.end).map((source) => source.ingested));
  const ticks = [yMax, 0];
  const selected = ranked.find((source) => source.id === open) ?? null;

  return (
    <>
      <div className="rh-vol">
        <div className="rh-vol__axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>
        <div className="rh-vol__viewport">
          <div className="rh-vol__grid" aria-hidden="true">
            {ticks.map((tick) => (
              <span key={tick} />
            ))}
          </div>
          <div
            className="rh-vol__scroll"
            ref={scrollRef}
            onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
          >
            <div className="rh-vol__row" style={{ width: slot > 0 ? ranked.length * slot : undefined }}>
              {ranked.map((source) => {
                const publishedShare =
                  source.ingested > 0 ? Math.min(1, source.published / source.ingested) : 0;
                const expanded = open === source.id;
                return (
                  <button
                    key={source.id}
                    type="button"
                    className={`rh-vol__item${expanded ? ' is-selected' : ''}`}
                    style={{ width: slot > 0 ? slot : undefined }}
                    aria-pressed={expanded}
                    aria-label={`${source.name}, ${source.ingested} kept of ${source.seen}, ${TONE[source.tone]}`}
                    onClick={() => setOpen(expanded ? null : source.id)}
                  >
                    <span className="rh-vol__value">
                      {source.ingested}
                      <span className="rh-muted"> / {source.seen}</span>
                    </span>
                    <span className="rh-vol__plot">
                      <span
                        className={`rh-vol__bar${source.ingested === 0 ? ' rh-vol__bar--empty' : ''}`}
                        style={{ height: source.ingested === 0 ? 2 : `${(source.ingested / yMax) * 100}%` }}
                      >
                        {publishedShare > 0 && (
                          <span
                            className="rh-vol__published"
                            style={{ height: `max(6px, ${publishedShare * 100}%)` }}
                          />
                        )}
                      </span>
                    </span>
                    <span className="rh-vol__name">
                      <span className={`rh-dot rh-dot--${source.tone === 'fresh' ? 'ok' : source.tone === 'failed' ? 'bad' : source.tone === 'stale' ? 'warn' : 'idle'}`} />
                      <span className="rh-vol__label">{source.name}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {selected && (
        <p className="rh-source__detail">
          {selected.name}: {selected.ingested} kept of {selected.seen}. {selected.published} on a published post. Last success {formatNy(selected.lastSuccessAt)}. {TONE[selected.tone]}
          {selected.lastError ? `. ${selected.lastError}` : ''}
        </p>
      )}
    </>
  );
}
