'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Truth = 'real' | 'ai';
type Item = { imageKey: string; url: string | null };
type Batch = { batchId: string; items: Item[]; viewMs: number; pass: number };
type Result = { imageKey: string; truth: Truth; guess: Truth; correct: boolean; ms: number };
type Score = { batchId: string; total: number; correct: number; accuracy: number | null; passes: boolean; verdict: string | null; pass: number; results: Result[] };

/**
 * idle → loading (the image) → look (shown for viewMs) → guess (image hidden, Real / AI) → … → done (score).
 * `ms` is the time from the image appearing to the guess.
 */
type Phase = 'idle' | 'starting' | 'loading' | 'look' | 'guess' | 'sending' | 'done';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const label = (t: Truth) => (t === 'real' ? 'Real' : 'AI');

export function RoaLab({ batchSize, viewMs, pass }: { batchSize: number; viewMs: number; pass: number }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [batch, setBatch] = useState<Batch | null>(null);
  const [at, setAt] = useState(0);
  const [score, setScore] = useState<Score | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setScore(null);
    setPhase('starting');
    try {
      const res = await fetch('/api/stories/roa-lab', { cache: 'no-store' });
      const body = (await res.json()) as Batch & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // Warm the cache so each look starts when its image is ready, not while it downloads.
      for (const it of body.items) if (it.url) new Image().src = it.url;
      setBatch(body);
      setAt(0);
      setPhase(body.items.length ? 'loading' : 'idle');
      if (!body.items.length) setError('The Real or AI? pool is empty: nothing to test yet.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  }, []);

  const finish = useCallback(async (batchId: string) => {
    try {
      const res = await fetch(`/api/stories/roa-lab?batch=${encodeURIComponent(batchId)}`, { cache: 'no-store' });
      const body = (await res.json()) as Score & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setScore(body);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('done');
    }
  }, []);

  /** The image is on screen: the look starts now and lasts viewMs. */
  const onShown = useCallback(() => {
    shownAt.current = performance.now();
    setPhase('look');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPhase('guess'), viewMs);
  }, [viewMs]);

  const guess = useCallback(
    async (g: Truth) => {
      if (!batch || phase !== 'guess') return;
      const item = batch.items[at]!;
      setPhase('sending');
      try {
        const res = await fetch('/api/stories/roa-lab', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchId: batch.batchId, imageKey: item.imageKey, guess: g, ms: Math.round(performance.now() - shownAt.current) }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('guess');
        return;
      }
      setError(null);
      if (at + 1 >= batch.items.length) return void finish(batch.batchId);
      setAt(at + 1);
      setPhase('loading');
    },
    [batch, phase, at, finish],
  );

  // R / A on the keyboard, once the buttons are up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== 'guess') return;
      if (e.key === 'r' || e.key === 'R') void guess('real');
      if (e.key === 'a' || e.key === 'A') void guess('ai');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, guess]);

  const item = batch?.items[at];
  const showImage = phase === 'loading' || phase === 'look';

  return (
    <main className="rl">
      <header className="rl-head">
        <h1>Real or AI? lab</h1>
        <p className="rl-sub">
          A blind sample of up to {batchSize} pool images, {viewMs / 1000} s each. Your accuracy grades the engine: {pct(pass)} or less and the engine passes;
          above it, the selection is too easy. Nothing here changes the pool.
        </p>
      </header>

      {error ? <p className="rl-error" role="alert">{error}</p> : null}

      {phase === 'idle' || phase === 'starting' ? (
        <section className="rl-card rl-center">
          <button type="button" className="rl-primary" onClick={() => void start()} disabled={phase === 'starting'}>
            {phase === 'starting' ? 'Drawing a sample…' : 'Start a batch'}
          </button>
        </section>
      ) : null}

      {batch && item && phase !== 'done' && phase !== 'idle' && phase !== 'starting' ? (
        <section className="rl-play" aria-live="polite">
          <div className="rl-progress">
            {at + 1} / {batch.items.length}
          </div>
          <div className="rl-stage">
            {showImage && item.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={item.imageKey} className={`rl-img${phase === 'look' ? ' on' : ''}`} src={item.url} alt="Pool image under test" onLoad={onShown} onError={onShown} />
            ) : null}
            {showImage && !item.url ? <p className="rl-note">This image could not be signed. Guess anyway or start over.</p> : null}
            {phase === 'guess' || phase === 'sending' ? <p className="rl-ask">Real or AI?</p> : null}
          </div>
          {!item.url && phase === 'loading' ? (
            <div className="rl-actions">
              <button type="button" onClick={onShown}>Continue</button>
            </div>
          ) : null}
          {phase === 'guess' || phase === 'sending' ? (
            <div className="rl-actions">
              <button type="button" className="rl-btn rl-real" onClick={() => void guess('real')} disabled={phase === 'sending'}>
                Real <kbd>R</kbd>
              </button>
              <button type="button" className="rl-btn rl-ai" onClick={() => void guess('ai')} disabled={phase === 'sending'}>
                AI <kbd>A</kbd>
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {phase === 'done' ? (
        <section className="rl-card">
          {score && score.accuracy !== null ? (
            <>
              <div className={`rl-score ${score.passes ? 'ok' : 'bad'}`}>
                <span className="rl-score-n">{pct(score.accuracy)}</span>
                <span className="rl-score-v">{score.verdict}</span>
              </div>
              <p className="rl-sub">
                {score.correct} of {score.total} right. The engine passes at {pct(score.pass)} or less.
              </p>
              <ol className="rl-results">
                {score.results.map((r) => (
                  <li key={r.imageKey} className={r.correct ? 'ok' : 'bad'}>
                    <code>{r.imageKey}</code> was {label(r.truth)}, you said {label(r.guess)} ({(r.ms / 1000).toFixed(1)} s)
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="rl-sub">No guesses were recorded for this batch.</p>
          )}
          <div className="rl-actions">
            <button type="button" className="rl-primary" onClick={() => void start()}>
              New batch
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
