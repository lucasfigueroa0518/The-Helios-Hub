'use client';

import { useCallback, useEffect, useState } from 'react';

type Q = { key: string; payload: { q: { question: string; options: { letter: string; text: string }[]; correct: string }; opponent?: { label: string; picked: string } } };
type Day = { day_number: number; ny_date: string; status: 'draft' | 'locked'; questions: Q[]; log: { at: string; kind: string; detail: string }[] };
type View = { launch: string | null; today: string; days: Day[] };

/**
 * "Are you Smarter Than AI?" web game (HUB-PLAN.md): the launch date (Day 1), tomorrow's draft with Pull until it
 * locks at 11 pm New York, and the locked days the website imports. Lives in the Resource Tracker's game view
 * (moved off the content page, 2026-11-19).
 */
export function GameDaysPanel() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [launch, setLaunch] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/stories/trivia-game', { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? `HTTP ${res.status}`);
    setView(body);
    setLaunch(body.launch ?? '');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async (payload: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/stories/trivia-game', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
    await load();
    setBusy(false);
  };

  return (
    <section className="rt-panel" aria-labelledby="game-days-title">
      <header className="rt-panel__head">
        <div>
          <h3 id="game-days-title" className="rt-chart__title">Today and tomorrow</h3>
          <p className="rt-chart__sub">Tomorrow&apos;s game is built after 3:30 am. Pull any question until it locks at 11 pm New York; the builder swaps in the next one.</p>
        </div>
      </header>
      <form className="rt-launch"
        onSubmit={(e) => { e.preventDefault(); void post({ action: 'launch', date: launch || null }, 'Change the launch date? Drafts are rebuilt from it.'); }}>
        <label htmlFor="game-launch">Day 1 (launch date)</label>
        <input id="game-launch" className="helios-field-input" type="date" value={launch} onChange={(e) => setLaunch(e.target.value)} disabled={busy} />
        <button type="submit" className="btn" disabled={busy || launch === (view?.launch ?? '')}>Save</button>
      </form>
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {!view ? <p className="rt-muted">Loading…</p> : !view.days.length ? <p className="rt-muted">{view.launch ? 'No game day built yet.' : 'No launch date set: the game is off.'}</p> : null}
      {view?.days.slice().reverse().map((d) => (
        <div key={d.ny_date} className="rt-gameday">
          <h4 className="rt-gameday__title">
            Day {d.day_number} · {d.ny_date}
            <span className={`rt-pill${d.status === 'locked' ? '' : ' rt-pill--draft'}`}>{d.status === 'locked' ? 'Locked' : `Draft · ${d.questions.length} of 5`}</span>
            <span className="rt-pill rt-pill--ai">AI right on {d.questions.filter((q) => q.payload.opponent?.picked === q.payload.q.correct).length} of {d.questions.length}</span>
          </h4>
          <ol className="rt-qlist">
            {d.questions.map((q) => {
              const right = q.payload.opponent?.picked === q.payload.q.correct;
              return (
                <li key={q.key}>
                  <div className="rt-qlist__q">{q.payload.q.question}</div>
                  <div className="rt-muted rt-qlist__opts">
                    {q.payload.q.options.map((o) => `${o.letter}. ${o.text}${o.letter === q.payload.q.correct ? ' ✓' : ''}`).join('   ')}
                    {q.payload.opponent ? ` · ${q.payload.opponent.label} picked ${q.payload.opponent.picked} (${right ? 'right' : 'wrong'})` : ''}
                  </div>
                  {d.status === 'draft' ? (
                    <button type="button" className="btn" disabled={busy}
                      onClick={() => void post({ action: 'pull', date: d.ny_date, key: q.key }, 'Pull this question? It is archived and the builder replaces it.')}>
                      Pull
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {d.log.length ? <p className="rt-muted rt-small">Last: {d.log[d.log.length - 1]!.detail}</p> : null}
        </div>
      ))}
    </section>
  );
}
