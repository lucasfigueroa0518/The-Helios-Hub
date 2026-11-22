'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ScheduleStrip } from '@/components/content-type/ScheduleStrip';
import {
  ALSO_AFFECTED,
  capMax,
  daysLabel,
  parseCapUsd,
  refillLine,
  settingsLayout,
  stateAsk,
  stateLine,
  windowsLine,
  type StateAsk,
} from '@/components/content-type/pool/settings-tab';
import { TYPE_CONFIG } from '@/lib/content-type/config';
import type { PostingPatch, PostingState } from '@/lib/content-type/posting';
import { refreshHubPage } from '@/lib/content-type/refresh-client';
import { STATE_COPY, TYPE_STATES, type TypeState } from '@/lib/content-type/state';
import { formatUsd } from '@/lib/social-hub/cost';
import type { Vertical } from '@/lib/social-hub/types';
import { when } from '@/lib/social-hub/views/format';

/**
 * A pool's Settings tab (settings standard D8, D9; CONTRACT.md §2): the one place a type's settings live, the same on
 * every type. The State control (Paused | Approval | Live, D16), the Pool block (refill cadence, last refill, refill $
 * cap), the Posts block, the read-only posting windows, the type's own form ("This type only") and the one line naming
 * the settings that cover every type (D10). There is no Auto-publish or approval control: every post needs a person.
 *
 * Reads GET /api/content-type/posting and writes a PostingPatch to POST /api/content-type/posting, then refreshes the
 * page's hub read. Handed to the pool screen by the type page (outside the read-only hub code), like Make it.
 */

const POSTING = '/api/content-type/posting';

async function call<T>(body?: { type: Vertical } & PostingPatch, type?: Vertical): Promise<T> {
  const res = body === undefined
    ? await fetch(`${POSTING}?type=${type}`, { cache: 'no-store' })
    : await fetch(POSTING, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pl-set__block" aria-label={title}>
      <h3 className="pl-set__label">{title}</h3>
      <div className="pl-set__body">{children}</div>
    </section>
  );
}

/** A − n + stepper that saves each step at once (the daily limit and posts per day, as the old drawer had them). */
function Stepper({ label, n, min, max, onSave, busy, fewer, more }: { label: string; n: number; min: number; max: number; onSave: (n: number) => void; busy: boolean; fewer: string; more: string }) {
  return (
    <div className="pl-set__step">
      <span className="pl-set__step-label">{label}</span>
      <button type="button" className="pl-btn pl-btn--sm" disabled={busy || n <= min} onClick={() => onSave(n - 1)} aria-label={fewer}>−</button>
      <strong className="pl-set__n">{n}</strong>
      <button type="button" className="pl-btn pl-btn--sm" disabled={busy || n >= max} onClick={() => onSave(n + 1)} aria-label={more}>+</button>
    </div>
  );
}

/** The State control: a three-way segmented control; arrows move between segments, a click or Enter picks one. */
function StateControl({ state, onPick, busy }: { state: TypeState; onPick: (s: TypeState) => void; busy: boolean }) {
  return (
    <div className="pl-seg" role="radiogroup" aria-label="State">
      {TYPE_STATES.map((s, i) => (
        <button
          key={s}
          type="button"
          role="radio"
          id={`pl-state-${s}`}
          aria-checked={state === s}
          tabIndex={state === s ? 0 : -1}
          disabled={busy}
          onClick={() => onPick(s)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const next = TYPE_STATES[(i + (e.key === 'ArrowRight' ? 1 : TYPE_STATES.length - 1)) % TYPE_STATES.length]!;
            document.getElementById(`pl-state-${next}`)?.focus();
          }}
        >
          {STATE_COPY[s].label}
        </button>
      ))}
    </div>
  );
}

export function SettingsTab({ type, lastRefill, typeOnly, nowIso }: {
  type: Vertical;
  /** When the pool last gained an idea (poolSummary over the hub read); null when unknown. */
  lastRefill: string | null;
  /** The type's own settings (the AI Drama form, the Explainers rendering form), built by the type page. */
  typeOnly?: ReactNode;
  /** The page's one `now`, for "last refill" words. */
  nowIso?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<PostingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<{ to: TypeState; ask: StateAsk } | null>(null);
  const [capDraft, setCapDraft] = useState<string | null>(null);
  const now = useMemo(() => (nowIso ? new Date(nowIso) : new Date()), [nowIso]);

  const load = useCallback(() => call<PostingState>(undefined, type).then((d) => { setData(d); setError(null); }).catch((e) => setError(msg(e))), [type]);
  useEffect(() => { void load(); }, [load]);

  async function save(patch: PostingPatch, done: string) {
    setBusy(true);
    setNote(null);
    try {
      // POST answers with the whole PostingState; costPerPostMicros is only on GET, so keep the last one read.
      const next = await call<PostingState>({ type, ...patch });
      setData((prev) => ({ ...next, costPerPostMicros: next.costPerPostMicros ?? prev?.costPerPostMicros ?? null }));
      setNote(done);
      void refreshHubPage(router);
    } catch (e) {
      setNote(msg(e));
    } finally {
      setBusy(false);
    }
  }

  function pick(to: TypeState) {
    if (!data || to === data.state) return;
    const question = stateAsk(type, data.state, to, data.scheduledAhead);
    if (question) setAsk({ to, ask: question });
    else void save({ state: to }, `${STATE_COPY[to].label}. ${STATE_COPY[to].line}`);
  }

  if (error) return <div className="pl-set"><p className="pl-set__error" role="alert">Could not load settings: {error}</p></div>;
  if (!data) return <div className="pl-set" aria-busy="true"><p className="pl-note">Loading settings…</p></div>;

  const noun = TYPE_CONFIG[type].postsNoun;
  const layout = settingsLayout(data);
  const capParsed = capDraft === null ? null : parseCapUsd(capDraft);
  const saveCap = () => {
    if (!capParsed?.ok) return;
    if (capParsed.value === data.refillCapUsd) { setCapDraft(null); return; }
    void save({ refillCapUsd: capParsed.value }, `Refill cap saved: ${formatUsd(capParsed.value * 1e6)} a refill.`).then(() => setCapDraft(null));
  };

  return (
    <div className="pl-set">
      <Block title="State">
        <StateControl state={data.state} onPick={pick} busy={busy} />
        <p className="pl-set__line">{stateLine(data.state)}</p>
        {data.stateMismatch ? (
          <p className="pl-set__warn" role="note">The saved settings had Live on while making posts was off, so this type reads as Paused. Pick a state to set it straight.</p>
        ) : null}
        {ask ? (
          <div className="pl-set__ask" role="alertdialog" aria-labelledby="pl-set-ask-title">
            <strong id="pl-set-ask-title">{ask.ask.title}</strong>
            {ask.ask.lines.map((line) => <p key={line}>{line}</p>)}
            <div className="pl-set__ask-actions">
              <button type="button" className="pl-btn pl-btn--sm" onClick={() => setAsk(null)}>Cancel</button>
              <button type="button" className="pl-btn pl-btn--sm pl-btn--primary" disabled={busy} onClick={() => { const to = ask.to; setAsk(null); void save({ state: to }, `${STATE_COPY[to].label}. ${STATE_COPY[to].line}`); }}>{ask.ask.ok}</button>
            </div>
          </div>
        ) : null}
      </Block>

      <Block title="Pool">
        <p className="pl-set__line">{refillLine(type)} · last refill {lastRefill ? when(lastRefill, now) : 'not yet'}</p>
        <div className="pl-set__cap">
          <label htmlFor={`pl-refill-cap-${type}`}>Refill cap</label>
          <span className="pl-set__usd">
            $
            <input
              id={`pl-refill-cap-${type}`}
              type="text"
              inputMode="decimal"
              value={capDraft ?? data.refillCapUsd.toFixed(2)}
              disabled={busy}
              aria-invalid={capParsed?.ok === false}
              onChange={(e) => setCapDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveCap(); if (e.key === 'Escape') setCapDraft(null); }}
            />
          </span>
          {capDraft !== null ? (
            <>
              <button type="button" className="pl-btn pl-btn--sm pl-btn--primary" disabled={busy || !capParsed?.ok} onClick={saveCap}>Save</button>
              <button type="button" className="pl-btn pl-btn--sm" onClick={() => setCapDraft(null)}>Cancel</button>
            </>
          ) : null}
        </div>
        {capParsed && !capParsed.ok ? <p className="pl-set__error" role="alert">{capParsed.error}</p> : null}
        <p className="pl-set__hint">The most one refill may spend. Refill runs in every state, even when the day’s quota is full. All types’ refills also share a nightly total, set on the Social Hub Cost page.</p>
      </Block>

      <Block title="Posts">
        {layout.posts === 'limit' && data.cap !== null ? (
          <>
            <Stepper label="Daily limit" n={data.cap} min={0} max={capMax(type)} busy={busy} fewer="One fewer a night" more="One more a night" onSave={(cap) => void save({ cap }, 'Daily limit saved.')} />
            <p className="pl-set__hint">The most {noun} the overnight run makes a day{TYPE_CONFIG[type].capPerSeries ? ', per series' : ''}, however many slots the calendar has.</p>
            {data.costPerPostMicros != null ? <p className="pl-set__hint">One more a night costs about {formatUsd(data.costPerPostMicros)}.</p> : null}
          </>
        ) : layout.posts === 'perDay' && data.perDay !== null && data.maxPerDay !== null ? (
          <>
            <Stepper label="Posts per day" n={data.perDay} min={TYPE_CONFIG[type].perDayMin} max={data.maxPerDay} busy={busy} fewer="One fewer a day" more="One more a day" onSave={(perDay) => void save({ perDay }, 'Posts per day saved.')} />
            <p className="pl-set__hint">How many {noun} are made each day. Up to {data.maxPerDay}: one per posting window.</p>
          </>
        ) : layout.days ? (
          <p className="pl-set__line">Posts on {daysLabel(layout.days)}.</p>
        ) : (
          <p className="pl-set__line">No daily count to set for this type.</p>
        )}
        {layout.capsInTypeForm ? <p className="pl-set__hint">The run $ cap and render cap are in “This type only” below.</p> : null}
      </Block>

      <Block title="Posting windows">
        {layout.windows === 'calendar' && data.schedule ? (
          <ScheduleStrip type={type} days={data.schedule} />
        ) : (
          <p className="pl-set__line">{windowsLine(type)}{layout.days ? ` · ${daysLabel(layout.days)}` : ''}</p>
        )}
      </Block>

      {typeOnly ? (
        <section className="pl-set__only" aria-label="This type only">
          <h3 className="pl-set__rule"><span>This type only</span></h3>
          {typeOnly}
        </section>
      ) : null}

      <p className="pl-set__also">
        Also affected by:{' '}
        {ALSO_AFFECTED.map((a, i) => (
          <span key={a.label}>{i ? ' · ' : ''}<a href={a.href}>{a.label}</a></span>
        ))}
      </p>

      {note ? <p className="pl-set__note" role="status">{note}</p> : null}
    </div>
  );
}
