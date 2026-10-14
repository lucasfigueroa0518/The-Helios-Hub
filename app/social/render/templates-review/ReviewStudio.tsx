'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { CATALOG, TEMPLATE_FAMILIES } from '@/lib/social/render/drafts/catalog';
import { RATIONALES } from '@/lib/social/render/drafts/rationales';
import { isBusy, type ReviewChoice, type ReviewStore, type TemplateReview } from '@/lib/social/render/drafts/reviews';
import { eyePathForSlide, SlideTemplatePremium } from '@/lib/social/render/drafts/SlideTemplatePremium';
import { SlideTemplate } from '@/lib/social/render/SlideTemplate';
import type { SlideCanvas } from '@/lib/social/render/types';

const CANVASES: { id: SlideCanvas; label: string }[] = [
  { id: 'black', label: 'Black' },
  { id: 'green', label: 'Green' },
  { id: 'orange', label: 'Orange' },
  { id: 'white', label: 'White' },
];

const STORAGE_KEY = 'helios-template-reviews';

const CHOICE_LABEL: Record<ReviewChoice, string> = {
  old: 'Kept current',
  new: 'Took premium',
  revise: 'Revision requested',
};

const STEPS = ['Request received', 'Reading your notes', 'Redesigning the slide', 'Serving the draft'] as const;

function readLocal(): Record<string, TemplateReview> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ReviewStore;
    return parsed.reviews ?? {};
  } catch {
    return {};
  }
}

function writeLocal(reviews: Record<string, TemplateReview>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ reviews }));
  } catch {
    // private mode
  }
}

function statusLine(review: TemplateReview | undefined): string | null {
  if (!review) return null;
  if (review.work === 'working' || review.work === 'queued') return review.step ?? 'Working on your revision…';
  if (review.work === 'ready' && review.choice === 'revise') return 'Draft updated';
  if (review.work === 'error') return review.step ?? 'Revision failed';
  return CHOICE_LABEL[review.choice];
}

export function ReviewStudio() {
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get('id');
  const [activeId, setActiveId] = useState(CATALOG.some((item) => item.id === fromUrl) ? fromUrl! : CATALOG[0]!.id);
  const [canvas, setCanvas] = useState<SlideCanvas>('black');
  const [showPath, setShowPath] = useState(false);
  const [blur, setBlur] = useState(false);
  const [reviews, setReviews] = useState<Record<string, TemplateReview>>({});
  const [notes, setNotes] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entry = useMemo(() => CATALOG.find((item) => item.id === activeId) ?? CATALOG[0]!, [activeId]);
  const path = eyePathForSlide(entry.post, 0);
  const current = reviews[entry.id];
  const busy = isBusy(current?.work);
  const activeJob = Object.values(reviews).find((item) => isBusy(item.work));
  const activeJobName = CATALOG.find((item) => item.id === activeJob?.id)?.name;
  const decided = Object.values(reviews).filter((item) => item.choice === 'old' || item.choice === 'new' || item.work === 'ready').length;

  useEffect(() => {
    setReviews(readLocal());
    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch('/api/social/template-reviews', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ReviewStore;
        const remote = data.reviews ?? {};
        if (cancelled) return;
        setReviews(remote);
        writeLocal(remote);
      } catch {
        // keep local
      }
    }
    void pull();
    const tick = window.setInterval(() => void pull(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    setNotes(reviews[entry.id]?.notes ?? '');
  }, [entry.id, reviews[entry.id]?.notes]);

  useEffect(() => {
    if (!fromUrl || fromUrl === activeId || !CATALOG.some((item) => item.id === fromUrl)) return;
    setActiveId(fromUrl);
  }, [fromUrl, activeId]);

  function openTemplate(id: string) {
    setActiveId(id);
    setFlash(null);
    setError(null);
    window.history.replaceState(null, '', `/social/render/templates-review?id=${id}`);
  }

  async function save(choice: ReviewChoice, nextNotes = notes) {
    const next: TemplateReview = {
      id: entry.id,
      choice,
      notes: nextNotes,
      updatedAt: new Date().toISOString(),
      work: choice === 'revise' ? 'queued' : 'idle',
      step: choice === 'revise' ? 'Request received' : undefined,
      generation: current?.generation ?? 0,
    };
    setReviews((prev) => {
      const merged = { ...prev, [entry.id]: next };
      writeLocal(merged);
      return merged;
    });
    setFlash(choice === 'revise' ? `Revision started — ${entry.name}` : `${CHOICE_LABEL[choice]} — ${entry.name}`);
    setError(null);
    try {
      const res = await fetch('/api/social/template-reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Save failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as ReviewStore;
      setReviews(data.reviews ?? {});
      writeLocal(data.reviews ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  const live = statusLine(current);
  const activeStep = current?.step ?? (current?.work === 'queued' ? 'Request received' : '');

  return (
    <div className="tpl-studio">
      <header className="tpl-studio__bar">
        <div>
          <h1 className="tpl-studio__title">Carousel templates</h1>
          <p className="tpl-studio__subtitle">
            Click a slide to pick it. {decided} of {CATALOG.length} decided.
          </p>
        </div>
        <div className="tpl-studio__tools">
          <div className="tpl-seg" role="group" aria-label="Canvas">
            {CANVASES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`tpl-seg__item${canvas === item.id ? ' is-on' : ''}`}
                aria-pressed={canvas === item.id}
                onClick={() => setCanvas(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" className={`tpl-toggle${showPath ? ' is-on' : ''}`} aria-pressed={showPath} onClick={() => setShowPath((v) => !v)}>
            Eye path
          </button>
          <button type="button" className={`tpl-toggle${blur ? ' is-on' : ''}`} aria-pressed={blur} onClick={() => setBlur((v) => !v)}>
            Squint
          </button>
        </div>
      </header>
      {(flash || error || activeJob || current?.work === 'ready') && (
        <div className={`tpl-flash${error ? ' is-error' : ''}${activeJob ? ' is-work' : ''}`} role="status" aria-live="polite">
          {error
            ?? (activeJob ? `${activeJob.step ?? 'Working on your revision…'} — ${activeJobName}` : null)
            ?? (current?.work === 'ready' ? `Draft updated — ${entry.name}` : flash)}
        </div>
      )}
      <div className="tpl-studio__body">
        <nav className="tpl-nav" aria-label="Templates">
          {TEMPLATE_FAMILIES.map((family) => (
            <div key={family.id}>
              <div className="tpl-nav__group">{family.name}</div>
              {CATALOG.filter((item) => item.family === family.id).map((item) => {
                const review = reviews[item.id];
                const status = review?.choice;
                const work = review?.work;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`tpl-nav__item${item.id === entry.id ? ' is-on' : ''}`}
                    aria-current={item.id === entry.id ? 'true' : undefined}
                    onClick={() => openTemplate(item.id)}
                  >
                    <span className={`tpl-nav__dot${work && work !== 'idle' ? ` is-${work}` : status ? ` is-${status}` : ''}`} />
                    <span>
                      <span className="tpl-nav__name">{item.name}</span>
                      <span className="tpl-nav__role">{statusLine(review) ?? item.role}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <main className="tpl-main">
          <section className="tpl-compare">
            <button
              type="button"
              className={`tpl-pane${current?.choice === 'old' ? ' is-picked' : ''}`}
              onClick={() => void save('old')}
            >
              <p className="tpl-pane__label">{current?.choice === 'old' ? 'Current · selected' : 'Current · click to keep'}</p>
              <div className={`tpl-pane__stage${blur ? ' is-blur' : ''}`} style={{ ['--slide-scale' as string]: '0.38' }}>
                <SlideTemplate post={entry.post} position={0} canvas={canvas} />
              </div>
            </button>
            <button
              type="button"
              className={`tpl-pane${current?.choice === 'new' || current?.work === 'ready' ? ' is-picked is-picked--new' : ''}`}
              onClick={() => void save('new')}
              disabled={busy}
            >
              <p className="tpl-pane__label">
                {busy ? 'Premium · revising' : current?.work === 'ready' ? 'Premium · updated' : current?.choice === 'new' ? 'Premium · selected' : 'Premium · click to take'}
              </p>
              <div className={`tpl-pane__stage${blur ? ' is-blur' : ''}${busy ? ' is-working' : ''}`} style={{ ['--slide-scale' as string]: '0.38' }}>
                <SlideTemplatePremium key={`${entry.id}-${current?.generation ?? 0}`} post={entry.post} position={0} canvas={canvas} />
                {showPath && !busy && (
                  <div className="tpl-path" aria-hidden="true">
                    {path.map((stop) => (
                      <div key={stop.id} className="tpl-path__stop" style={{ left: `${stop.x}%`, top: `${stop.y}%` }}>
                        <span className="tpl-path__n">{stop.id}</span>
                        <span className="tpl-path__l">{stop.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {busy && (
                  <div className="tpl-work" aria-hidden="true">
                    <span className="tpl-work__pulse" />
                    <span className="tpl-work__copy">{current?.step ?? 'Working'}</span>
                  </div>
                )}
              </div>
            </button>
          </section>
          <section className="tpl-actions">
            <div>
              <div className="tpl-picks">
                <button
                  type="button"
                  className={`tpl-pick${current?.choice === 'old' ? ' is-on' : ''}`}
                  aria-pressed={current?.choice === 'old'}
                  onClick={() => void save('old')}
                >
                  Keep current
                </button>
                <button
                  type="button"
                  className={`tpl-pick tpl-pick--new${current?.choice === 'new' || current?.work === 'ready' ? ' is-on' : ''}`}
                  aria-pressed={current?.choice === 'new' || current?.work === 'ready'}
                  onClick={() => void save('new')}
                  disabled={busy}
                >
                  Take premium
                </button>
                {live && <span className="tpl-status">{live}</span>}
              </div>
              {current?.choice === 'revise' && (
                <ol className="tpl-steps">
                  {STEPS.map((step) => {
                    const done = STEPS.indexOf(step) < STEPS.indexOf(activeStep as typeof STEPS[number]) || current.work === 'ready';
                    const on = step === activeStep && busy;
                    return (
                      <li key={step} className={`tpl-steps__item${done ? ' is-done' : ''}${on ? ' is-on' : ''}`}>
                        {step}
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="tpl-rationale">
                <h3>Why this draft</h3>
                <p>{RATIONALES[entry.family]}</p>
              </div>
            </div>
            <form
              className="tpl-notes"
              onSubmit={(event) => {
                event.preventDefault();
                if (!notes.trim() || busy) return;
                void save('revise', notes);
              }}
            >
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="A couple of notes if you want this draft revised…"
                aria-label="Revision notes"
                disabled={busy}
              />
              <div className="tpl-notes__row">
                <span className="tpl-nav__role">{busy ? current?.step : current?.work === 'ready' ? 'Draft updated — send more notes anytime' : 'Notes stay with this slide'}</span>
                <button type="submit" className="tpl-notes__save" disabled={busy || !notes.trim()}>
                  {busy ? 'Revising…' : 'Request revision'}
                </button>
              </div>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}
