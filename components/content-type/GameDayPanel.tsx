'use client';

import { useCallback, useEffect, useState } from 'react';

type Q = { key: string; payload: { q: { question: string; options: { letter: string; text: string }[]; correct: string }; opponent?: { label: string; picked: string } } };
type Day = { day_number: number; ny_date: string; status: 'draft' | 'locked'; questions: Q[]; log: { at: string; kind: string; detail: string }[] };
type View = { launch: string | null; today: string; days: Day[] };

/**
 * "Are you Smarter Than AI?" web game (HUB-PLAN.md): the launch date (Day 1), tomorrow's draft with Pull until it
 * locks at 11 pm New York, and the locked days the website imports.
 */
export function GameDayPanel() {
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
    <section className="rh-card" style={{ margin: '16px 0', padding: 16 }} aria-labelledby="game-days-title">
      <h2 id="game-days-title" style={{ margin: '0 0 8px' }}>Web game</h2>
      <p className="rh-muted" style={{ margin: '0 0 12px' }}>
        Five questions a day for the website. Tomorrow&apos;s day is built after 3:30 am; pull any question until it locks at 11 pm New York.
      </p>
      <form style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}
        onSubmit={(e) => { e.preventDefault(); void post({ action: 'launch', date: launch || null }, 'Change the launch date? Drafts are rebuilt from it.'); }}>
        <label htmlFor="game-launch">Day 1 (launch date)</label>
        <input id="game-launch" type="date" value={launch} onChange={(e) => setLaunch(e.target.value)} disabled={busy} />
        <button type="submit" className="rh-btn" disabled={busy || launch === (view?.launch ?? '')}>Save</button>
      </form>
      {error ? <p className="rh-muted" role="alert" style={{ color: 'var(--rh-danger, #b42318)' }}>{error}</p> : null}
      {!view ? <p className="rh-muted">Loading…</p> : !view.days.length ? <p className="rh-muted">{view.launch ? 'No game day built yet.' : 'No launch date set: the game is off.'}</p> : null}
      {view?.days.slice().reverse().map((d) => (
        <div key={d.ny_date} style={{ borderTop: '1px solid var(--rh-line, #e5e5e5)', paddingTop: 12, marginTop: 12 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>
            Day {d.day_number} · {d.ny_date} · {d.status === 'locked' ? 'locked' : `draft (${d.questions.length} of 5)`}
          </h3>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {d.questions.map((q) => {
              const right = q.payload.opponent?.picked === q.payload.q.correct;
              return (
                <li key={q.key} style={{ marginBottom: 8 }}>
                  <div>{q.payload.q.question}</div>
                  <div className="rh-muted" style={{ fontSize: 13 }}>
                    {q.payload.q.options.map((o) => `${o.letter}. ${o.text}${o.letter === q.payload.q.correct ? ' ✓' : ''}`).join('   ')}
                    {q.payload.opponent ? ` · ${q.payload.opponent.label} picked ${q.payload.opponent.picked} (${right ? 'right' : 'wrong'})` : ''}
                  </div>
                  {d.status === 'draft' ? (
                    <button type="button" className="rh-btn" style={{ marginTop: 4 }} disabled={busy}
                      onClick={() => void post({ action: 'pull', date: d.ny_date, key: q.key }, 'Pull this question? It is archived and the builder replaces it.')}>
                      Pull
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {d.log.length ? <p className="rh-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Last: {d.log[d.log.length - 1]!.detail}</p> : null}
        </div>
      ))}
    </section>
  );
}
