'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Loader, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { ActionMenu, OfferedAction, SlotChoice } from '@/lib/social-hub/views/actions';

/**
 * Actions on a post (MATRICES.md §2), wherever it appears: one primary, a
 * secondary, the rest under More. Each posts to a flagged hub action route;
 * anything expensive or irreversible confirms with its consequence first.
 * Pending shows on the button; the outcome note stays inline; then the hub
 * refreshes (the route revalidates the shared read).
 */
export function ActionBar({ menu, compact = false, showOffNote = true }: { menu: ActionMenu; compact?: boolean; showOffNote?: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const moreRoot = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState<OfferedAction | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const picker = useRef<HTMLDialogElement>(null);
  const [picking, setPicking] = useState<OfferedAction | null>(null);
  const [choice, setChoice] = useState<SlotChoice | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const outside = (e: MouseEvent) => {
      if (!moreRoot.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [moreOpen]);

  async function run(action: OfferedAction, extra: Record<string, string> = {}) {
    const plan = action.plan;
    setBusy(action.key);
    setNote(null);
    try {
      const res = await fetch(plan.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...plan.body, ...extra }) });
      const out = (await res.json().catch(() => ({}))) as { note?: string };
      setNote({ ok: res.ok, text: out.note ?? (res.ok ? 'Done.' : 'That didn’t work. Try again in a moment.') });
      if (res.ok) router.refresh();
    } catch {
      setNote({ ok: false, text: 'Couldn’t reach the hub. Check your connection and try again.' });
    } finally {
      setBusy(null);
    }
  }

  function start(action: OfferedAction) {
    setMoreOpen(false);
    if (action.slots) {
      setPicking(action);
      setChoice(null);
      picker.current?.showModal();
      return;
    }
    if (action.plan.confirm) {
      setConfirming(action);
      dialog.current?.showModal();
    } else void run(action);
  }

  const button = (action: OfferedAction, primary: boolean) => (
    <button
      key={action.key}
      type="button"
      className={`sh-btn${primary ? ' sh-btn--primary' : ''}`}
      disabled={Boolean(action.disabled) || busy != null}
      data-busy={busy === action.key ? '' : undefined}
      onClick={() => start(action)}
    >
      {busy === action.key ? <Loader size={14} aria-hidden="true" /> : null}
      {action.label}
    </button>
  );

  const reasons = [menu.primary, ...menu.secondary].filter((a): a is OfferedAction => Boolean(a?.disabled)).map((a) => a.disabled!);
  const hasButtons = Boolean(menu.primary || menu.secondary.length || menu.more.length);
  if (!hasButtons && !(showOffNote && menu.offNote) && menu.links.length === 0) return null;

  return (
    <div className={`sh-actions${compact ? ' sh-actions--compact' : ''}`}>
      <div className="sh-actions__row">
        {menu.primary ? button(menu.primary, true) : null}
        {menu.secondary.map((a) => button(a, false))}
        {menu.links.map((l) => (
          <Link key={l.href + l.label} href={l.href} className="sh-btn sh-btn--quiet">
            {l.label}
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        ))}
        {menu.more.length ? (
          <div className="sh-menu" ref={moreRoot}>
            <button type="button" className="sh-btn sh-btn--icon" aria-haspopup="menu" aria-expanded={moreOpen} aria-label="More actions" onClick={() => setMoreOpen((v) => !v)} disabled={busy != null}>
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
            {moreOpen ? (
              <ul role="menu" className={`sh-menu__list${compact ? '' : ' sh-menu__list--left'}`}>
                {menu.more.map((a) => (
                  <li key={a.key} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className={`sh-menu__item${a.danger ? ' sh-menu__item--danger' : ''}`}
                      disabled={Boolean(a.disabled)}
                      title={a.disabled ?? undefined}
                      onClick={() => start(a)}
                    >
                      {a.label}
                    </button>
                    {a.disabled ? <span className="sh-actions__why sh-actions__why--menu">{a.disabled}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {reasons.length ? <p className="sh-actions__why">{reasons[0]}</p> : null}
      {showOffNote && menu.offNote ? <p className="sh-actions__why">{menu.offNote}</p> : null}
      {note ? <p className={`sh-actions__note${note.ok ? '' : ' sh-actions__note--failed'}`} role="status">{note.text}</p> : null}
      <dialog ref={picker} className="sh-confirm sh-picker" aria-labelledby="sh-picker-title" onClose={() => setPicking(null)}>
        <h2 id="sh-picker-title">{picking?.confirmTitle ?? 'Pick a slot'}</h2>
        <p>Pick a window in the next week. It counts toward that day’s posts, so the overnight run makes one fewer.</p>
        {picking?.slots ? <SlotPicker slots={picking.slots} value={choice} onChange={setChoice} /> : null}
        <div className="sh-confirm__actions">
          <button type="button" className="sh-btn" onClick={() => picker.current?.close()}>Cancel</button>
          <button
            type="button"
            className="sh-btn sh-btn--primary"
            disabled={!choice || choice.state !== 'free'}
            onClick={() => {
              const action = picking;
              const picked = choice;
              picker.current?.close();
              if (action && picked) void run(action, { nyDate: picked.nyDate, slot: picked.slot });
            }}
          >
            {choice && choice.state === 'free' ? `${picking?.key === 'reschedule' ? 'Move' : 'Schedule'} for ${choice.dayLabel} ${choice.label.toLowerCase()}` : 'Pick a free window'}
          </button>
        </div>
      </dialog>
      <dialog ref={dialog} className="sh-confirm" aria-labelledby="sh-confirm-title" onClose={() => setConfirming(null)}>
        <h2 id="sh-confirm-title">{confirming?.confirmTitle ?? `${confirming?.label ?? ''}?`}</h2>
        <p>{confirming?.plan.confirm}</p>
        <div className="sh-confirm__actions">
          <button type="button" className="sh-btn" onClick={() => dialog.current?.close()}>Cancel</button>
          <button
            type="button"
            className={`sh-btn${confirming?.danger ? '' : ' sh-btn--primary'}`}
            onClick={() => {
              const action = confirming;
              dialog.current?.close();
              if (action) void run(action);
            }}
          >
            {confirming?.label}
          </button>
        </div>
      </dialog>
    </div>
  );
}

/** Next week's windows for the type, by day; taken ones show who holds them by being unavailable. */
function SlotPicker({ slots, value, onChange }: { slots: SlotChoice[]; value: SlotChoice | null; onChange: (s: SlotChoice) => void }) {
  const days = [...new Set(slots.map((s) => s.nyDate))];
  if (days.length === 0) return <p className="sh-subtle">No windows left this week.</p>;
  return (
    <div className="sh-picker__days" role="radiogroup" aria-label="Windows">
      {days.map((day) => {
        const mine = slots.filter((s) => s.nyDate === day);
        return (
          <div key={day} className="sh-picker__day">
            <span className="sh-picker__label">{mine[0]!.dayLabel}</span>
            <div className="sh-pills">
              {mine.map((s) => (
                <button
                  key={s.slot}
                  type="button"
                  role="radio"
                  aria-checked={value?.nyDate === s.nyDate && value.slot === s.slot}
                  className="sh-pill"
                  aria-pressed={value?.nyDate === s.nyDate && value.slot === s.slot}
                  disabled={s.state !== 'free'}
                  onClick={() => onChange(s)}
                  title={s.state === 'taken' ? 'Taken' : s.state === 'current' ? 'Where it is now' : undefined}
                >
                  {s.label} <span className="sh-muted">{s.range}</span>{s.state === 'current' ? ' · now' : s.state === 'taken' ? ' · taken' : ''}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
