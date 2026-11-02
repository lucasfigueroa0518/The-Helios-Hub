'use client';

import { Loader, RotateCcw, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { useHubRefresh } from '@/components/social-hub/nav/useHubRefresh';
import { allowedAmount, overrideProblem, plainPostNote, restoreClick, revisionBoxState, type BoxRow, type BoxState, type PartControl } from '@/lib/revisions/box-state';
// The server's own limit; types.ts has type-only imports, so it is safe in the browser.
import { INSTRUCTION_MAX_CHARS, type PartRef } from '@/lib/revisions/types';
import type { Vertical } from '@/lib/social-hub/types';

/** The hub's own flagged routes (Targeted Revisions); the box calls nothing else. */
const REVISE = '/api/social-hub/actions/revise';
const UNDO = '/api/social-hub/actions/undo-revision';
const CONTINUE = '/api/social-hub/actions/continue-revision';
const READ = '/api/social-hub/actions/revisions';

const POLL_MS = 4000;

type Note = { ok: boolean; text: string };
type Busy = null | 'submit' | 'reply' | 'continue' | `undo:${string}` | `restore:${string}`;

const usd = (n: number) => `$${n.toFixed(2)}`;

export type RevisionBoxViewProps = {
  state: BoxState;
  busy: Busy;
  note: Note | null;
  text: string;
  reply: string;
  amount: string;
  /** The part whose Restore original is armed (`kind:key`): the next click on it runs. */
  armed: string | null;
  onArm: (key: string | null) => void;
  onText: (v: string) => void;
  onReply: (v: string) => void;
  onAmount: (v: string) => void;
  onSubmit: () => void;
  onAnswer: () => void;
  onContinue: () => void;
  onUndo: (p: PartControl, original: boolean) => void;
};

/**
 * Targeted Revisions in the post view: say what's off in your own words; only that part is redone,
 * logged and undoable. The worker does the work; this box asks, waits ("Revising…"), answers the
 * system's question, lets a person allow more spend when a change pauses, and undoes. The states
 * come from revisionBoxState (lib/revisions/box-state.ts); this file only draws them and posts.
 */
export function RevisionBox({ vertical, refs, lock, initialRows = null }: { vertical: Vertical; refs: Record<string, string>; lock: string | null; /** Tests and the first paint. */ initialRows?: BoxRow[] | null }) {
  const { refresh } = useHubRefresh();
  const [rows, setRows] = useState<BoxRow[]>(initialRows ?? []);
  const [loaded, setLoaded] = useState(initialRows != null);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [text, setText] = useState('');
  const [reply, setReply] = useState('');
  const [amount, setAmount] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const refsKey = JSON.stringify(refs);
  const wasActive = useRef(false);

  const state = revisionBoxState(rows, { vertical, lock, now });
  // The rows say when a request is queued or running (a submit's row is there as soon as its POST returns).
  const active = !lock && state.polling;

  const load = useCallback(
    async (alsoRefresh = false) => {
      const qs = new URLSearchParams({ vertical, ...(JSON.parse(refsKey) as Record<string, string>), ...(alsoRefresh ? { refresh: '1' } : {}) });
      try {
        const res = await fetch(`${READ}?${qs.toString()}`, { cache: 'no-store' });
        const out = (await res.json().catch(() => ({}))) as { rows?: BoxRow[]; note?: string };
        if (res.ok && Array.isArray(out.rows)) {
          setRows(out.rows);
          setLoaded(true);
          setNow(new Date());
          return out.rows;
        }
        if (!res.ok && out.note) setNote({ ok: false, text: plainPostNote(false, out.note) });
      } catch {
        // A missed poll is retried on the next tick; the box keeps what it showed.
      }
      return null;
    },
    [vertical, refsKey],
  );

  useEffect(() => {
    if (!lock) void load();
  }, [lock, load]);

  // Poll every few seconds while a request is queued or running and the tab is visible; stop at the end.
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [active, load]);

  // A request just ended (applied, blocked, failed, paused, asking): refresh the post so the revised preview shows.
  useEffect(() => {
    if (wasActive.current && !active) {
      void load(true).then(() => refresh());
    }
    wasActive.current = active;
  }, [active, load, refresh]);

  // The paused control starts at the suggested amount: the estimate (else the cap) at the cap, twice the ceiling at the ceiling.
  const pausedId = state.current?.kind === 'paused' ? state.current.id : null;
  const suggested = state.current?.kind === 'paused' ? state.current.suggestUsd : null;
  useEffect(() => {
    setAmount(pausedId && suggested ? String(suggested) : '');
  }, [pausedId, suggested]);

  async function post(endpoint: string, body: Record<string, unknown>, kind: Busy): Promise<boolean> {
    setBusy(kind);
    setNote(null);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vertical, refs, ...body }) });
      const out = (await res.json().catch(() => ({}))) as { note?: string };
      // Route notes can carry raw errors (a failed restore): the same plain treatment as the rows' notes.
      setNote({ ok: res.ok, text: plainPostNote(res.ok, out.note) });
      return res.ok;
    } catch {
      setNote({ ok: false, text: 'Couldn’t reach the hub. Check your connection and try again.' });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    const instruction = text.trim();
    if (!instruction || !state.canSubmit || busy) return;
    if (await post(REVISE, { instruction }, 'submit')) {
      setText('');
      await load();
    }
  }

  async function answer() {
    if (state.current?.kind !== 'asking' || !reply.trim() || busy) return;
    if (await post(REVISE, { instruction: reply.trim(), parentId: state.current.replyTo }, 'reply')) {
      setReply('');
      await load();
    }
  }

  async function keepGoing() {
    if (state.current?.kind !== 'paused' || busy) return;
    const n = allowedAmount(state.current, amount);
    if (n == null) return;
    if (await post(CONTINUE, { revisionId: state.current.revisionId, overrideUsd: n }, 'continue')) {
      await load();
    }
  }

  async function undo(p: PartControl, original: boolean) {
    if (busy) return;
    setArmed(null);
    const part: PartRef = { kind: p.part.kind, key: p.part.key };
    if (await post(UNDO, { part, ...(original ? { original: true } : {}) }, `${original ? 'restore' : 'undo'}:${p.part.kind}:${p.part.key}`)) {
      await load(true);
      refresh();
    }
  }

  if (!loaded && !lock) {
    return (
      <section className="sh-revise" aria-label="Revise this post">
        <h3 className="sh-post__h">Revise</h3>
        <p className="sh-muted">Loading changes…</p>
      </section>
    );
  }

  return (
    <RevisionBoxView
      state={state}
      busy={busy}
      note={note}
      text={text}
      reply={reply}
      amount={amount}
      armed={armed}
      onArm={setArmed}
      onText={setText}
      onReply={setReply}
      onAmount={setAmount}
      onSubmit={() => void submit()}
      onAnswer={() => void answer()}
      onContinue={() => void keepGoing()}
      onUndo={(p, original) => void undo(p, original)}
    />
  );
}

/** Cmd/Ctrl+Enter sends. */
function sendOnModEnter(send: () => void) {
  return (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };
}

/** The box drawn from its state (no fetch; tests render every state with this). */
export function RevisionBoxView(p: RevisionBoxViewProps) {
  const { state, busy } = p;
  const id = useId();
  const textId = `${id}-text`;
  const countId = `${id}-count`;
  const replyId = `${id}-reply`;
  const amountId = `${id}-amount`;
  const cur = state.current;
  const disabled = Boolean(state.lock);
  const problem = cur?.kind === 'paused' ? overrideProblem(cur, p.amount) : null;
  const amount = cur?.kind === 'paused' ? allowedAmount(cur, p.amount) : null;

  let status: ReactNode = null;
  if (cur?.kind === 'revising') {
    status = (
      <div className="sh-revise__status" data-state="revising">
        <p className="sh-revise__line"><Loader size={14} aria-hidden="true" className="sh-spin" /> <strong>Revising…</strong> “{cur.instruction}”</p>
        <p className="sh-revise__hint">{cur.hint}</p>
      </div>
    );
  } else if (cur?.kind === 'asking') {
    status = (
      <div className="sh-revise__status" data-state="asking">
        <p className="sh-revise__line"><strong>One question first.</strong> {cur.question}</p>
        <label className="sh-revise__label" htmlFor={replyId}>Your answer</label>
        <div className="sh-revise__inline">
          <input
            id={replyId}
            className="sh-revise__input"
            value={p.reply}
            maxLength={INSTRUCTION_MAX_CHARS}
            onChange={(e) => p.onReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                p.onAnswer();
              }
            }}
            disabled={busy != null}
          />
          <button type="button" className="sh-btn sh-btn--primary" onClick={p.onAnswer} disabled={busy != null || !p.reply.trim()} data-busy={busy === 'reply' ? '' : undefined}>
            {busy === 'reply' ? <Loader size={14} aria-hidden="true" /> : null}
            Answer
          </button>
        </div>
      </div>
    );
  } else if (cur?.kind === 'applied') {
    status = (
      <div className="sh-revise__status sh-revise__status--done" data-state="applied">
        <p className="sh-revise__line">{cur.summary}</p>
      </div>
    );
  } else if (cur?.kind === 'blocked' || cur?.kind === 'failed') {
    status = (
      <div className="sh-revise__status sh-revise__status--failed" data-state={cur.kind}>
        <p className="sh-revise__line">{cur.note}</p>
      </div>
    );
  } else if (cur?.kind === 'paused') {
    status = (
      <div className="sh-revise__status sh-revise__status--paused" data-state={`paused-${cur.at}`}>
        <p className="sh-revise__line">{cur.note}</p>
        {cur.notified ? <p className="sh-revise__hint">A notification was sent.</p> : null}
        <label className="sh-revise__label" htmlFor={amountId}>{cur.needsAmount ? 'To keep going, allow up to (US dollars)' : 'Allow up to (US dollars)'}</label>
        <div className="sh-revise__inline">
          <input
            id={amountId}
            className="sh-revise__input sh-revise__input--amount"
            inputMode="decimal"
            placeholder={cur.needsAmount ? 'Amount' : undefined}
            value={p.amount}
            onChange={(e) => p.onAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                p.onContinue();
              }
            }}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${amountId}-why` : undefined}
            disabled={busy != null}
          />
          <button type="button" className="sh-btn sh-btn--primary" onClick={p.onContinue} disabled={busy != null || amount == null} data-busy={busy === 'continue' ? '' : undefined}>
            {busy === 'continue' ? <Loader size={14} aria-hidden="true" /> : null}
            {cur.needsAmount ? (amount != null ? `Keep going, up to ${usd(amount)}` : 'Keep going') : amount != null ? `Allow up to ${usd(amount)}` : 'Allow up to…'}
          </button>
        </div>
        {problem ? <p className="sh-revise__hint sh-revise__hint--failed" id={`${amountId}-why`}>{problem}</p> : null}
      </div>
    );
  }

  return (
    <section className="sh-revise" aria-labelledby={`${id}-h`} data-disabled={disabled ? '' : undefined}>
      <h3 className="sh-post__h" id={`${id}-h`}>Revise</h3>
      {disabled ? (
        <p className="sh-muted">{state.lock}</p>
      ) : (
        <>
          {status}
          {/* One request at a time: while one is running or asking, its own controls are the box. */}
          {state.canSubmit ? (
            <form
              className="sh-revise__form"
              onSubmit={(e) => {
                e.preventDefault();
                p.onSubmit();
              }}
            >
              <label className="sh-revise__label" htmlFor={textId}>{state.prompt}</label>
              <textarea
                id={textId}
                className="sh-revise__text"
                rows={3}
                maxLength={INSTRUCTION_MAX_CHARS}
                value={p.text}
                placeholder="For example: slide 3’s headline is too long"
                aria-describedby={countId}
                onChange={(e) => p.onText(e.target.value)}
                onKeyDown={sendOnModEnter(p.onSubmit)}
                disabled={busy != null}
              />
              <div className="sh-revise__bar">
                <span className="sh-revise__count" id={countId} aria-live="off">{p.text.length}/{INSTRUCTION_MAX_CHARS}</span>
                <button type="submit" className="sh-btn sh-btn--primary" disabled={busy != null || !p.text.trim()} data-busy={busy === 'submit' ? '' : undefined}>
                  {busy === 'submit' ? <Loader size={14} aria-hidden="true" /> : null}
                  Revise
                </button>
              </div>
            </form>
          ) : null}
          {state.parts.length ? (
            <ul className="sh-revise__parts" aria-label="Changes in place">
              {state.parts.map((part) => {
                const key = `${part.part.kind}:${part.part.key}`;
                return (
                  <li key={key} className="sh-revise__part">
                    <span className="sh-revise__part-name">
                      <strong>{part.label[0]!.toUpperCase() + part.label.slice(1)}</strong>
                      <span className="sh-subtle"> · {part.applied === 1 ? '1 change' : `${part.applied} changes`}, last: “{part.latest.instruction}”</span>
                    </span>
                    <span className="sh-revise__part-tools">
                      <button type="button" className="sh-btn sh-btn--quiet" onClick={() => p.onUndo(part, false)} disabled={busy != null} data-busy={busy === `undo:${key}` ? '' : undefined}>
                        {busy === `undo:${key}` ? <Loader size={14} aria-hidden="true" /> : <Undo2 size={14} aria-hidden="true" />}
                        Undo
                      </button>
                      {part.canRestore && p.armed !== key ? (
                        <button type="button" className="sh-btn sh-btn--quiet" onClick={() => (restoreClick(p.armed, key) === 'run' ? p.onUndo(part, true) : p.onArm(key))} disabled={busy != null} data-busy={busy === `restore:${key}` ? '' : undefined}>
                          {busy === `restore:${key}` ? <Loader size={14} aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />}
                          Restore original
                        </button>
                      ) : null}
                    </span>
                    {/* Restore original drops every change to the part at once, with no redo: a second, explicit click. */}
                    {part.canRestore && p.armed === key ? (
                      <span className="sh-revise__confirm" role="group" aria-label={`Restore the original ${part.label}`}>
                        <span className="sh-revise__hint">This drops all {part.applied} changes to {part.label} and brings back the original.</span>
                        <span className="sh-revise__part-tools">
                          <button type="button" className="sh-btn sh-btn--quiet" onClick={() => p.onArm(null)} disabled={busy != null}>Cancel</button>
                          <button type="button" className="sh-btn sh-btn--danger" onClick={() => (restoreClick(p.armed, key) === 'run' ? p.onUndo(part, true) : p.onArm(key))} disabled={busy != null} data-busy={busy === `restore:${key}` ? '' : undefined}>
                            {busy === `restore:${key}` ? <Loader size={14} aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />}
                            Yes, restore the original
                          </button>
                        </span>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      )}
      {p.note ? <p className={`sh-actions__note${p.note.ok ? '' : ' sh-actions__note--failed'}`}>{p.note.text}</p> : null}
      <p className="sh-sr" role="status" aria-live="polite">{p.note && !p.note.ok ? p.note.text : state.announce}</p>
    </section>
  );
}
