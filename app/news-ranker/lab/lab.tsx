'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { LabState, VariantResult } from '@/lib/news-ranker/lab/results';
import type { RunPlan } from '@/lib/news-ranker/lab/runner';
import type { LabTag, VariantMetrics } from '@/lib/news-ranker/types';

type View = 'tag' | 'run' | 'results';
const API = '/api/news-ranker/lab';

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

const usd = (x: number) => `$${x.toFixed(4)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const n2 = (x: number | null) => (x == null ? '–' : x.toFixed(2));

const css = {
  root: { font: '13px/1.35 ui-sans-serif, system-ui, sans-serif', color: '#111', background: '#fff', padding: 12, maxWidth: 1400, margin: '0 auto' },
  tab: (on: boolean) => ({ padding: '3px 10px', marginRight: 4, border: '1px solid #999', background: on ? '#111' : '#fff', color: on ? '#fff' : '#111', cursor: 'pointer' }),
  table: { borderCollapse: 'collapse' as const, width: '100%' },
  td: { borderBottom: '1px solid #e3e3e3', padding: '3px 6px', verticalAlign: 'top' as const },
  th: { borderBottom: '1px solid #999', padding: '3px 6px', textAlign: 'left' as const, fontWeight: 600 },
  pill: (on: boolean, color: string) => ({ padding: '1px 8px', border: `1px solid ${color}`, background: on ? color : '#fff', color: on ? '#fff' : color, cursor: 'pointer', marginRight: 4 }),
  muted: { color: '#666' },
};

export function NewsRankerLab() {
  const [state, setState] = useState<LabState | null>(null);
  const [view, setView] = useState<View>('tag');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [setId, setSetId] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(setId ? `${API}?set=${encodeURIComponent(setId)}` : API);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setState(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [setId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const tags = useMemo(() => new Map((state?.tags ?? []).map((t) => [t.storyId, t])), [state]);

  return (
    <div style={css.root}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <strong>News Ranker lab</strong>
        {(['tag', 'run', 'results'] as View[]).map((v) => (
          <button key={v} style={css.tab(view === v)} onClick={() => setView(v)}>{v}</button>
        ))}
        <span style={css.muted}>
          set {state?.set?.id ?? 'none'} · {state?.set?.stories.length ?? 0} stories · tagged {state?.set ? state.set.stories.filter((s) => tags.has(s.storyId)).length : 0} · spent {usd(state?.spentUsd ?? 0)} of ${state?.capUsd.toFixed(2) ?? '1.00'}
        </span>
        {state?.sets && state.sets.length > 1 && (
          <select value={state.set?.id ?? ''} onChange={(e) => setSetId(e.target.value)}>
            {state.sets.map((s) => <option key={s.id} value={s.id}>{s.id} ({s.n})</option>)}
          </select>
        )}
        {busy && <span>… {busy}</span>}
      </div>
      {error && <div style={{ color: '#b00', marginBottom: 8 }}>{error}</div>}
      {!state ? <div>Loading…</div> : !state.set ? (
        <div>
          No frozen set yet. <button onClick={() => act('freezing', () => post({ action: 'freeze' }))}>Freeze 80 stories from the last 7 NY days</button>
          <span style={css.muted}> (read-only intake read; no model calls)</span>
        </div>
      ) : view === 'tag' ? (
        <TagView state={state} tags={tags} onSaved={load} onError={setError} />
      ) : view === 'run' ? (
        <RunView state={state} act={act} />
      ) : (
        <ResultsView state={state} />
      )}
    </div>
  );
}

/* ── tag view ─────────────────────────────────────────────────────────── */

function TagView({ state, tags, onSaved, onError }: { state: LabState; tags: Map<string, LabTag>; onSaved: () => Promise<void>; onError: (e: string) => void }) {
  const stories = state.set!.stories;
  const [i, setI] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const noteRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

  const [draft, setDraft] = useState<Record<string, { cool?: string; needToKnow?: string }>>({});
  const coolRef = useRef<HTMLInputElement | null>(null);
  const needRef = useRef<HTMLInputElement | null>(null);

  /** Saves once both ratings are set (0–10 integers); a story half-rated stays a draft. */
  const save = useCallback(async (storyId: string, patch: Partial<{ cool: number; needToKnow: number; note: string }>) => {
    const t = tags.get(storyId);
    const d = draft[storyId] ?? {};
    const num = (x: string | undefined) => (x === undefined || x === '' ? undefined : Number(x));
    const cool = patch.cool ?? num(d.cool) ?? t?.cool;
    const needToKnow = patch.needToKnow ?? num(d.needToKnow) ?? t?.needToKnow;
    const ok = (x: number | undefined): x is number => x !== undefined && Number.isInteger(x) && x >= 0 && x <= 10;
    if (!ok(cool) || !ok(needToKnow)) return;
    try {
      await post({ action: 'tag', storyId, cool, needToKnow, note: patch.note ?? notes[storyId] ?? t?.note ?? '' });
      setDraft((x) => { const { [storyId]: _, ...rest } = x; return rest; });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [tags, draft, notes, onSaved, onError]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stories[i];
      if (document.activeElement instanceof HTMLInputElement) {
        if (e.key === 'Escape' || e.key === 'Enter') {
          const field = document.activeElement.dataset.field;
          if (e.key === 'Enter' && s) void save(s.storyId, field === 'note' ? { note: notes[s.storyId] ?? '' } : {});
          if (e.key === 'Enter' && field === 'cool') { needRef.current?.focus(); needRef.current?.select(); e.preventDefault(); return; }
          (document.activeElement as HTMLInputElement).blur();
          if (e.key === 'Enter' && field === 'need') setI((x) => Math.min(stories.length - 1, x + 1));
        }
        return;
      }
      if (!s) return;
      const t = tags.get(s.storyId);
      if (e.key === 'j' || e.key === 'ArrowDown') setI((x) => Math.min(stories.length - 1, x + 1));
      else if (e.key === 'k' || e.key === 'ArrowUp') setI((x) => Math.max(0, x - 1));
      else if (e.key === 'c' || e.key === 'Enter') { e.preventDefault(); coolRef.current?.focus(); coolRef.current?.select(); return; }
      else if (e.key === 'n') { e.preventDefault(); needRef.current?.focus(); needRef.current?.select(); return; }
      else if (e.key === 'x') void save(s.storyId, { cool: 0, needToKnow: 0 });
      else if (e.key === 'u' && t) void post({ action: 'untag', storyId: s.storyId }).then(onSaved);
      else if (e.key === '/') {
        e.preventDefault();
        noteRef.current?.focus();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, stories, tags, notes, save, onSaved]);

  useEffect(() => { rowRefs.current[i]?.scrollIntoView({ block: 'nearest' }); }, [i]);

  return (
    <div>
      <div style={{ ...css.muted, marginBottom: 6 }}>Rate each 0–10 (0 = not at all). Keys: j/k move · Enter or c → Cool box, type, Enter → Value box, type, Enter saves and moves on · n Value box · x both 0 · u clear · / note</div>
      <table style={css.table}>
        <thead>
          <tr><th style={css.th}>#</th><th style={css.th}>Story</th><th style={css.th}>Outlets</th><th style={css.th}>Cool · Value (0–10)</th><th style={css.th}>Note</th></tr>
        </thead>
        <tbody>
          {stories.map((s, idx) => {
            const t = tags.get(s.storyId);
            const on = idx === i;
            return (
              <tr key={s.storyId} ref={(el) => { rowRefs.current[idx] = el; }} onClick={() => setI(idx)} style={{ background: on ? '#fff7d6' : t ? '#f6f6f6' : undefined }}>
                <td style={css.td}>{idx + 1}</td>
                <td style={{ ...css.td, maxWidth: 700 }}>
                  {state.digests?.[s.storyId] ? (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{state.digests[s.storyId]!.headline}</div>
                      <div style={{ fontSize: 14, margin: '2px 0' }}>{state.digests[s.storyId]!.point}</div>
                      <details style={{ ...css.muted, fontSize: 11 }}><summary>original</summary><b>{s.headline}</b> {s.summary}</details>
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600 }}>{s.headline}</div>
                      <div style={css.muted}>{s.summary}</div>
                    </>
                  )}
                </td>
                <td style={{ ...css.td, fontSize: 12, maxWidth: 200 }}>
                  {s.outlets.length ? <b>{s.outlets.join(', ')}</b> : null}
                  <div style={css.muted}>{s.sources.slice(0, 4).join(', ')}{s.sources.length > 4 ? ` +${s.sources.length - 4}` : ''}</div>
                </td>
                <td style={{ ...css.td, whiteSpace: 'nowrap' }}>
                  {(['cool', 'needToKnow'] as const).map((k) => (
                    <input
                      key={k}
                      ref={on ? (k === 'cool' ? coolRef : needRef) : undefined}
                      data-field={k === 'cool' ? 'cool' : 'need'}
                      type="number" min={0} max={10} step={1} placeholder={k === 'cool' ? 'cool' : 'value'}
                      style={{ width: 52, font: 'inherit', marginRight: 4, borderColor: k === 'cool' ? '#0a7' : '#26c' }}
                      value={draft[s.storyId]?.[k] ?? (t ? String(t[k]) : '')}
                      onFocus={() => setI(idx)}
                      onChange={(e) => setDraft((x) => ({ ...x, [s.storyId]: { ...x[s.storyId], [k]: e.target.value } }))}
                      onBlur={() => void save(s.storyId, {})}
                    />
                  ))}
                  <div style={{ ...css.muted, fontSize: 11 }}>{t ? 'rated' : draft[s.storyId] ? 'needs both' : 'unrated'}</div>
                </td>
                <td style={css.td}>
                  <input
                    ref={on ? noteRef : undefined}
                    style={{ width: 180, font: 'inherit' }}
                    value={notes[s.storyId] ?? t?.note ?? ''}
                    onChange={(e) => setNotes((x) => ({ ...x, [s.storyId]: e.target.value }))}
                    onBlur={() => notes[s.storyId] !== undefined && notes[s.storyId] !== (t?.note ?? '') && save(s.storyId, { note: notes[s.storyId] })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── run view ─────────────────────────────────────────────────────────── */

function RunView({ state, act }: { state: LabState; act: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const setId = state.set!.id;
  const [plans, setPlans] = useState<Record<string, RunPlan | string>>({});
  useEffect(() => {
    let live = true;
    void Promise.all(state.variants.map(async (v) => {
      try {
        return [v.variantId, await post<RunPlan>({ action: 'plan', setId, variantId: v.variantId })] as const;
      } catch (e) {
        return [v.variantId, e instanceof Error ? e.message : String(e)] as const;
      }
    })).then((entries) => live && setPlans(Object.fromEntries(entries)));
    return () => {
      live = false;
    };
  }, [state, setId]);
  const remaining = state.capUsd - state.spentUsd;

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        Spend: <b>{usd(state.spentUsd)}</b> of ${state.capUsd.toFixed(2)} (remaining {usd(remaining)}).
        <span style={css.muted}> Each run checks the cap before it starts and before every call.</span>
      </div>
      <table style={css.table}>
        <thead>
          <tr><th style={css.th}>Variant</th><th style={css.th}>Calls</th><th style={css.th}>Estimate</th><th style={css.th}>Last run</th><th style={css.th}></th></tr>
        </thead>
        <tbody>
          {state.variants.map((v) => {
            const p = plans[v.variantId];
            const plan = typeof p === 'object' ? p : null;
            return (
              <tr key={v.variantId}>
                <td style={css.td}><b>{v.variantId}</b><div style={css.muted}>{v.label}</div></td>
                <td style={css.td}>{plan ? `${plan.jevCalls} Jev · ${plan.sonnetCalls} Sonnet` : '–'}</td>
                <td style={css.td}>{plan ? usd(plan.estimateUsd) : typeof p === 'string' ? <span style={{ color: '#b00' }}>{p}</span> : '…'}{plan?.note ? <div style={{ color: '#b60' }}>{plan.note}</div> : null}</td>
                <td style={css.td}>{v.run ? `${v.run.started_at ? new Date(v.run.started_at).toLocaleString() : ''} · ${usd(v.run.cost_usd)}` : '–'}</td>
                <td style={css.td}>
                  <button
                    disabled={!plan?.capOk}
                    onClick={() => plan && window.confirm(`Run ${v.variantId}? Estimate ${usd(plan.estimateUsd)}; spent ${usd(state.spentUsd)} of $${state.capUsd.toFixed(2)}.`) && act(`running ${v.variantId}`, () => post({ action: 'run', setId, variantId: v.variantId }))}
                  >
                    Run
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h4 style={{ margin: '12px 0 4px' }}>Runs on this set</h4>
      <table style={css.table}>
        <tbody>
          {state.runs.map((r) => (
            <tr key={r.id}><td style={css.td}>{r.id}</td><td style={css.td}>{r.status}</td><td style={css.td}>est {usd(r.estimate_usd)} · cost {usd(r.cost_usd)}</td><td style={{ ...css.td, color: '#b00' }}>{r.error}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── results view ─────────────────────────────────────────────────────── */

function MetricCells({ m }: { m: VariantMetrics }) {
  return (
    <>
      <td style={css.td}>{m.meanCool.at5.toFixed(1)} / {m.meanCool.at10.toFixed(1)}</td>
      <td style={css.td}>{m.meanNeed.at5.toFixed(1)} / {m.meanNeed.at10.toFixed(1)}</td>
      <td style={css.td}>{m.meanBlend.at5.toFixed(1)} / {m.meanBlend.at10.toFixed(1)}</td>
      <td style={css.td}>{m.rankCorr.cool.toFixed(2)} · {m.rankCorr.need.toFixed(2)} · {m.rankCorr.blend.toFixed(2)}</td>
      <td style={css.td}>{pct(m.noShareTop5)}</td>
    </>
  );
}

const metricHead = (
  <>
    <th style={css.th}>Your Cool, avg top 5 / 10</th><th style={css.th}>Your Value, avg top 5 / 10</th><th style={css.th}>Blend at w, avg top 5 / 10</th><th style={css.th}>Rank corr. cool · value · blend</th><th style={css.th}>Rated ≤2 both, in top 5</th>
  </>
);

function ResultsView({ state }: { state: LabState }) {
  const ran = state.variants.filter((v) => v.metrics);
  const [open, setOpen] = useState<string | null>(null);
  if (!ran.length) return <div>No finished runs on this set yet.</div>;
  return (
    <div>
      <div style={{ ...css.muted, marginBottom: 6 }}>Averages are your 0–10 ratings over each order's top rated stories (unrated are skipped). Rank corr. runs −1…1: how well the whole order matches your ratings. Rated {state.tags.length}.</div>
      <table style={css.table}>
        <thead><tr><th style={css.th}>Variant</th><th style={css.th}>Mix w</th>{metricHead}</tr></thead>
        <tbody>
          {ran.map((v) => (
            <tr key={v.variantId}><td style={css.td}><b>{v.variantId}</b></td><td style={css.td}>{v.metrics!.mixCool}</td><MetricCells m={v.metrics!} /></tr>
          ))}
        </tbody>
      </table>

      <h4 style={{ margin: '14px 0 4px' }}>Mix sweep: score = w·cool + (1−w)·need (no calls, final order ignored)</h4>
      <table style={css.table}>
        <thead><tr><th style={css.th}>Variant</th><th style={css.th}>w</th>{metricHead}</tr></thead>
        <tbody>
          {ran.flatMap((v) => v.sweep.map((m) => (
            <tr key={`${v.variantId}-${m.mixCool}`}><td style={css.td}>{m.mixCool === 0 ? <b>{v.variantId}</b> : ''}</td><td style={css.td}>{m.mixCool}</td><MetricCells m={m} /></tr>
          )))}
        </tbody>
      </table>

      <h4 style={{ margin: '14px 0 4px' }}>Top 10 side by side ([cool/value] = your ratings, · = unrated). Click a row for where its points came from.</h4>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ran.length}, minmax(220px, 1fr))`, gap: 8, overflowX: 'auto' }}>
        {ran.map((v) => <TopList key={v.variantId} v={v} open={open} setOpen={setOpen} />)}
      </div>
    </div>
  );
}

function TopList({ v, open, setOpen }: { v: VariantResult; open: string | null; setOpen: (k: string | null) => void }) {
  return (
    <div>
      <b>{v.variantId}</b>
      <ol style={{ margin: '4px 0', paddingLeft: 20 }}>
        {v.top10.map((t) => {
          const key = `${v.variantId}:${t.storyId}`;
          const mark = t.tag ? `${t.tag.cool}/${t.tag.needToKnow}` : '·';
          const color = !t.tag ? '#999' : Math.max(t.tag.cool, t.tag.needToKnow) >= 7 ? '#0a7' : Math.max(t.tag.cool, t.tag.needToKnow) <= 2 ? '#b00' : '#a70';
          return (
            <li key={t.storyId} style={{ marginBottom: 4, cursor: 'pointer' }} onClick={() => setOpen(open === key ? null : key)}>
              <span style={{ color, fontWeight: 700, marginRight: 4 }}>[{mark}]</span>
              {t.headline}
              <div style={{ ...css.muted, fontSize: 11 }}>cool {n2(t.cool)} · value {n2(t.needToKnow)} · mixed {n2(t.mixed)}{t.finalPosition ? ` · final #${t.finalPosition}` : ''}</div>
              {open === key && (
                <div style={{ fontSize: 11, background: '#f6f6f6', padding: 4 }}>
                  {Object.entries(t.points).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([q, p]) => (
                    <div key={q}>{q}: {p >= 0 ? '+' : ''}{p.toFixed(3)}</div>
                  ))}
                  {t.gate && <div style={css.muted}>gate: {t.gate}</div>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
