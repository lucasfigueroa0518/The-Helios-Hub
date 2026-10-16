'use client';

import { useRouter } from 'next/navigation';
import { Loader, Plus } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { typeStyle } from '@/components/social-hub/ui/marks';
import type { FeedMode, SlotSource } from '@/lib/social-hub/slots/types';
import { isReelType } from '@/lib/social-hub/slots/types';
import { WEEKDAY_SHORT } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { verticalInfo } from '@/lib/social-hub/verticals';
import { minuteLabel, PLAN } from '@/lib/social-hub/views/plan';
import { ROWS, type WeekCell, type WeekChip } from '@/lib/social-hub/views/week';

/**
 * One slot on the week grid (spec §3): the chip (or "+") opens a dialog to
 * switch Trial/Main, remove the slot, or add one, for just this date or every
 * such weekday. Saves post to the slot writer; a 409 lists booked posts, and
 * the person picks Move back to ready (the unschedule action, then the same
 * save) or Keep it. ActionBar's dialog / pending / note pattern.
 */

const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Booked = { scheduleId: string; vertical: Vertical; nyDate: string; windowId: string; refs: Record<string, string> };
type Change = Record<string, unknown>;
type Window = { vertical: Vertical; windowId: string };

const windowOf = (v: Vertical, id: string) => PLAN[v].find((w) => w.id === id);
const modeLabel = (m: FeedMode) => (m === 'trial' ? 'Trial' : 'Main');
const defaultMode = (v: Vertical): FeedMode | null => (v === 'reels' ? 'trial' : v === 'explainers' ? 'main' : null);

/** "Tue Oct 20" */
function dateShort(nyDate: string): string {
  const [y, m, d] = nyDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function post(url: string, body: unknown): Promise<{ status: number; out: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, out: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export function SlotEditor({ cell, chip, scope, readOnly = false, label, dimmed = false, dayCarousels = [] }: {
  cell: WeekCell;
  chip: WeekChip | null;
  scope: 'date' | 'template';
  readOnly?: boolean;
  /** Visible chip text ("Text · Trial"), or "+". */
  label: string;
  /** Another type is in focus (`?type=`). */
  dimmed?: boolean;
  /** That day's Carousel windows, for "Make this a Last Few Days day". */
  dayCarousels?: readonly string[];
}) {
  const router = useRouter();
  const titleId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [pick, setPick] = useState<Window | null>(chip ?? cell.addable[0] ?? null);
  const [mode, setMode] = useState<FeedMode | null>(chip ? chip.feedMode : pick ? defaultMode(pick.vertical) : null);
  const [applyTo, setApplyTo] = useState<'date' | 'template'>(scope);
  const [lfdAsk, setLfdAsk] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [booked, setBooked] = useState<{ list: Booked[]; changes: Change[] } | null>(null);

  const row = ROWS.find((r) => r.id === cell.rowId);
  const day = cell.nyDate ? dateShort(cell.nyDate) : `Every ${WEEKDAY_LONG[cell.weekday]}`;
  const start = chip ? windowOf(chip.vertical, chip.windowId)?.startMinute ?? row?.startMinute ?? 0 : row?.startMinute ?? 0;
  const described = chip
    ? [
        day,
        minuteLabel(start),
        verticalInfo(chip.vertical).label,
        chip.feedMode ? `${modeLabel(chip.feedMode)} feed` : null,
        chip.origin === 'override' ? 'override' : null,
        chip.booked ? '1 post booked' : null,
      ].filter(Boolean).join(', ')
    : `Add a slot, ${day}, ${minuteLabel(start)} ${row?.label ?? ''}`.trim();

  const chipAttrs = chip
    ? { 'data-origin': chip.origin, 'data-booked': chip.booked ? 'true' : undefined, 'data-dimmed': dimmed ? 'true' : undefined, style: typeStyle(chip.vertical) }
    : {};

  if (readOnly) {
    if (!chip) return null;
    return (
      <span className="sh-week__chip" {...chipAttrs} title={described}>
        <span className="sh-week__dot" aria-hidden="true" />
        <span aria-hidden="true">{label}</span>
        <span className="sh-sr">{described}</span>
      </span>
    );
  }

  const everyWeekday = applyTo === 'template' || cell.nyDate == null;

  /** One slot change in the writer's shape, for the scope the person picked. */
  const change = (w: Window, adding: boolean, feedMode: FeedMode | null): Change => {
    const fm = adding && isReelType(w.vertical) ? feedMode : null;
    if (everyWeekday) {
      return adding
        ? { scope: 'template', op: 'put', weekday: cell.weekday, vertical: w.vertical, windowId: w.windowId, feedMode: fm }
        : { scope: 'template', op: 'delete', weekday: cell.weekday, vertical: w.vertical, windowId: w.windowId };
    }
    return { scope: 'date', op: 'put', nyDate: cell.nyDate, vertical: w.vertical, windowId: w.windowId, action: adding ? 'add' : 'remove', feedMode: fm };
  };

  function open() {
    setPick(chip ?? cell.addable[0] ?? null);
    setMode(chip ? chip.feedMode : cell.addable[0] ? defaultMode(cell.addable[0].vertical) : null);
    setApplyTo(scope);
    setLfdAsk(false);
    setErrors([]);
    setBooked(null);
    dialog.current?.showModal();
  }

  async function save(key: string, changes: Change[], keepBooked = false) {
    setBusy(key);
    setErrors([]);
    try {
      const { status, out } = await post('/api/social-hub/slots', keepBooked ? { changes, keepBooked: true } : { changes });
      if (status === 200) {
        dialog.current?.close();
        router.refresh();
      } else if (status === 409) {
        setBooked({ list: (out.booked as Booked[]) ?? [], changes });
      } else if (status === 422 && Array.isArray(out.errors)) {
        setErrors(out.errors as string[]);
      } else {
        setErrors([typeof out.error === 'string' ? out.error : 'That didn’t save. Try again in a moment.']);
      }
    } catch {
      setErrors(['Couldn’t reach the hub. Check your connection and try again.']);
    } finally {
      setBusy(null);
    }
  }

  /** Booked posts go back to ready (the unschedule action), then the same save runs again. */
  async function moveBack() {
    if (!booked) return;
    setBusy('move');
    setErrors([]);
    try {
      for (const b of booked.list) {
        const { status, out } = await post('/api/social-hub/actions/unschedule', { vertical: b.vertical, refs: b.refs });
        if (status < 200 || status >= 300) {
          setErrors([typeof out.note === 'string' ? out.note : 'That post couldn’t move back to ready. Nothing else changed.']);
          setBusy(null);
          return;
        }
      }
    } catch {
      setErrors(['Couldn’t reach the hub. Check your connection and try again.']);
      setBusy(null);
      return;
    }
    const changes = booked.changes;
    setBooked(null);
    await save('move', changes);
  }

  const reel = pick ? isReelType(pick.vertical) : false;
  const modeChanged = chip ? mode !== chip.feedMode : false;
  const lfdOffer = chip?.vertical === 'carousels' && dayCarousels.length > 0;
  const weekdays = `${WEEKDAY_LONG[cell.weekday]}s`;
  const lfdChanges = (): Change[] => [
    change({ vertical: 'last_few_days', windowId: PLAN.last_few_days[0]!.id }, true, null),
    ...dayCarousels.map((id) => change({ vertical: 'carousels', windowId: id }, false, null)),
  ];
  const title = chip ? `${verticalInfo(chip.vertical).label}, ${day}, ${minuteLabel(start)}` : `Add a slot, ${day}`;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={chip ? 'sh-week__chip' : 'sh-week__add'}
        {...chipAttrs}
        aria-label={described}
        aria-haspopup="dialog"
        onClick={open}
      >
        {chip ? <><span className="sh-week__dot" aria-hidden="true" />{label}</> : <Plus size={14} aria-hidden="true" />}
      </button>
      <dialog ref={dialog} className="sh-confirm sh-slot" aria-labelledby={titleId} onClose={() => trigger.current?.focus()}>
        <h2 id={titleId}>{title}</h2>

        {booked ? (
          <>
            <p>{plural(booked.list.length, 'post')} booked here.</p>
            <ul className="sh-slot__booked">
              {booked.list.map((b) => <li key={b.scheduleId}>{verticalInfo(b.vertical).label} · {dateShort(b.nyDate)} {windowOf(b.vertical, b.windowId)?.label ?? b.windowId}</li>)}
            </ul>
            <p className="sh-subtle">Move back to ready takes {booked.list.length === 1 ? 'it' : 'them'} off the schedule so tonight’s run can place {booked.list.length === 1 ? 'it' : 'them'} again. Keep it leaves {booked.list.length === 1 ? 'it' : 'them'} posting as booked.</p>
            {errors.length ? <Errors errors={errors} /> : null}
            <div className="sh-confirm__actions">
              <button type="button" className="sh-btn" disabled={busy != null} onClick={() => void save('keep', booked.changes, true)}>
                {busy === 'keep' ? <Loader size={14} aria-hidden="true" /> : null}Keep it
              </button>
              <button type="button" className="sh-btn sh-btn--primary" autoFocus disabled={busy != null} data-busy={busy === 'move' ? '' : undefined} onClick={() => void moveBack()}>
                {busy === 'move' ? <Loader size={14} aria-hidden="true" /> : null}Move back to ready
              </button>
            </div>
          </>
        ) : (
          <>
            {!chip ? (
              cell.addable.length ? (
                <fieldset className="sh-slot__field">
                  <legend>Type and window</legend>
                  <div className="sh-pills">
                    {cell.addable.map((w) => {
                      const on = pick?.vertical === w.vertical && pick.windowId === w.windowId;
                      return (
                        <button key={`${w.vertical}-${w.windowId}`} type="button" className="sh-pill" aria-pressed={on} onClick={() => { setPick(w); setMode(defaultMode(w.vertical)); }}>
                          {verticalInfo(w.vertical).label} <span className="sh-muted">{windowOf(w.vertical, w.windowId)?.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : <p>Nothing else fits here.</p>
            ) : null}

            {reel ? (
              <fieldset className="sh-slot__field">
                <legend>Feed</legend>
                <div className="sh-pills">
                  {(['trial', 'main'] as const).map((m) => (
                    <button key={m} type="button" className="sh-pill" aria-pressed={mode === m} onClick={() => setMode(m)}>{modeLabel(m)}</button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {scope === 'date' && cell.nyDate ? (
              <fieldset className="sh-slot__field">
                <legend>Apply to</legend>
                <div className="sh-pills">
                  <button type="button" className="sh-pill" aria-pressed={applyTo === 'date'} onClick={() => setApplyTo('date')}>Just {dateShort(cell.nyDate)}</button>
                  <button type="button" className="sh-pill" aria-pressed={applyTo === 'template'} onClick={() => setApplyTo('template')}>Every {WEEKDAY_LONG[cell.weekday]}</button>
                </div>
              </fieldset>
            ) : null}

            {lfdOffer ? (
              <div className="sh-slot__lfd">
                {lfdAsk ? (
                  <>
                    <p>
                      {everyWeekday
                        ? `This also removes the ${plural(dayCarousels.length, 'Carousel slot')} on ${weekdays}.`
                        : `This also removes ${dateShort(cell.nyDate!)}’s ${plural(dayCarousels.length, 'Carousel slot')}.`}
                    </p>
                    <button type="button" className="sh-btn" disabled={busy != null} data-busy={busy === 'lfd' ? '' : undefined} onClick={() => void save('lfd', lfdChanges())}>
                      {busy === 'lfd' ? <Loader size={14} aria-hidden="true" /> : null}Make it a Last Few Days day
                    </button>
                  </>
                ) : (
                  <button type="button" className="sh-btn sh-btn--quiet" onClick={() => setLfdAsk(true)}>Make this a Last Few Days day</button>
                )}
              </div>
            ) : null}

            {errors.length ? <Errors errors={errors} /> : null}

            <div className="sh-confirm__actions">
              {chip ? (
                <button type="button" className="sh-btn sh-btn--danger" disabled={busy != null} data-busy={busy === 'remove' ? '' : undefined} onClick={() => void save('remove', [change(chip, false, null)])}>
                  {busy === 'remove' ? <Loader size={14} aria-hidden="true" /> : null}Remove slot
                </button>
              ) : null}
              <button type="button" className="sh-btn" onClick={() => dialog.current?.close()}>Cancel</button>
              {chip ? (
                reel ? (
                  <button type="button" className="sh-btn sh-btn--primary" disabled={busy != null || !mode || (!modeChanged && applyTo === scope)} data-busy={busy === 'save' ? '' : undefined} onClick={() => void save('save', [change(chip, true, mode)])}>
                    {busy === 'save' ? <Loader size={14} aria-hidden="true" /> : null}Save
                  </button>
                ) : null
              ) : (
                <button type="button" className="sh-btn sh-btn--primary" disabled={busy != null || !pick || (reel && !mode)} data-busy={busy === 'add' ? '' : undefined} onClick={() => pick && void save('add', [change(pick, true, mode)])}>
                  {busy === 'add' ? <Loader size={14} aria-hidden="true" /> : null}Add slot
                </button>
              )}
            </div>
          </>
        )}
      </dialog>
    </>
  );
}

function Errors({ errors }: { errors: string[] }) {
  return (
    <ul className="sh-note sh-note--failed sh-slot__errors" role="alert">
      {errors.map((e) => <li key={e}>{e}</li>)}
    </ul>
  );
}

/**
 * The cutover switch (spec §5): in legacy mode a notice with Switch on; in
 * template mode a small Switch back. Both confirm their consequence first.
 */
export function SourceSwitch({ source, readOnly = false }: { source: SlotSource; readOnly?: boolean }) {
  const router = useRouter();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const on = source === 'template';

  async function flip() {
    setBusy(true);
    setNote(null);
    try {
      const { status, out } = await post('/api/social-hub/slots/source', { source: on ? 'legacy' : 'template' });
      if (status === 200) {
        dialog.current?.close();
        router.refresh();
      } else setNote(typeof out.error === 'string' ? out.error : 'That didn’t switch. Try again in a moment.');
    } catch {
      setNote('Couldn’t reach the hub. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const button = (
    <button ref={trigger} type="button" className={on ? 'sh-btn sh-btn--quiet' : 'sh-btn sh-btn--primary'} disabled={readOnly} onClick={() => { setNote(null); dialog.current?.showModal(); }}>
      {on ? 'Switch back to type settings' : 'Switch on'}
    </button>
  );

  return (
    <div className={on ? 'sh-week__source' : 'sh-note sh-week__source sh-week__source--off'}>
      {on ? null : <p>The calendar is showing today’s settings. It starts deciding when you switch it on.</p>}
      {button}
      <dialog ref={dialog} className="sh-confirm" aria-labelledby={titleId} onClose={() => trigger.current?.focus()}>
        <h2 id={titleId}>{on ? 'Switch back to type settings?' : 'Switch the calendar on?'}</h2>
        <p>
          {on
            ? 'Each content type goes back to deciding from its own settings. Your calendar stays saved for when you switch it on again.'
            : 'From now on the calendar decides what posts when. Today’s pattern is copied in, so nothing changes until you edit it.'}
        </p>
        {note ? <p className="sh-note sh-note--failed" role="alert">{note}</p> : null}
        <div className="sh-confirm__actions">
          <button type="button" className="sh-btn" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="button" className="sh-btn sh-btn--primary" disabled={busy} data-busy={busy ? '' : undefined} onClick={() => void flip()}>
            {busy ? <Loader size={14} aria-hidden="true" /> : null}{on ? 'Switch back' : 'Switch on'}
          </button>
        </div>
      </dialog>
    </div>
  );
}
