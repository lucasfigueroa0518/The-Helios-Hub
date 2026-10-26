'use client';

import { Loader, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Floating, TIME_OPTIONS } from '@/components/social-hub/calendar/SlotCard';
import { Menu } from '@/components/social-hub/ui/Menu';
import { LFD_ONCE } from '@/lib/social-hub/slots/rules';
import { canAddTime, DAY_ORDER, formErrors, nextTime, type ScheduleTime, type ScheduleView, type TypeSchedule } from '@/lib/social-hub/slots/schedule';
import { clockLabel, DEFAULT_FEED_MODE } from '@/lib/social-hub/slots/times';
import { isReelType, type FeedMode } from '@/lib/social-hub/slots/types';
import { WEEKDAY_SHORT } from '@/lib/social-hub/time';

/**
 * One type's standing schedule (spec 2026-10-21 §1): its times, each with
 * Trial / Main for reel types, and the days it runs. Errors block Save;
 * warnings don't. A save that needs a yes (LFD / Carousels days, or an empty
 * schedule) comes back as its lines and asks here first. The panel is the
 * board's Floating: beside the dropdown, a bottom sheet on a phone.
 */

export type SaveOutcome = { kind: 'saved' } | { kind: 'errors'; errors: string[] } | { kind: 'confirm'; lines: string[] };

const MERGED = 'This schedule had different times on different days. They’re merged here; nothing changes until you save.';

const modeWord = (m: FeedMode) => (m === 'trial' ? 'Trial' : 'Main');

type Row = ScheduleTime & { id: number };

export function ScheduleForm({ view, others, cap, editable, note, busy, anchor, onClose, onSave }: {
  view: ScheduleView;
  /** Every other entry's schedule, for the feed warning and the LFD / Carousels confirm. */
  others: TypeSchedule[];
  /** This type's daily limit (set on its type page). */
  cap: number;
  editable: boolean;
  /** Why the form is read-only (the switch is off), shown on top. */
  note: string | null;
  busy: boolean;
  anchor: HTMLElement;
  onClose: () => void;
  onSave: (s: TypeSchedule, confirm: boolean) => Promise<SaveOutcome>;
}) {
  const { entry } = view.schedule;
  const label = entry.label;
  const reel = isReelType(entry.vertical);
  // Each row keeps a stable id, so a row's open time menu stays with it when another row is removed.
  const ids = useRef(0);
  const [times, setTimes] = useState<Row[]>(() => view.schedule.times.map((t) => ({ ...t, id: ++ids.current })));
  const [days, setDays] = useState<number[]>(view.schedule.days);
  // Merge problems ("1:00 PM is Trial on some days…") hold until that time is settled: its Trial / Main picked, moved or removed.
  const [problems, setProblems] = useState<string[]>(view.problems);
  const [server, setServer] = useState<string[]>([]);
  const [ask, setAsk] = useState<string[] | null>(null);
  const [dirty, setDirty] = useState(false);

  const draft: TypeSchedule = { entry, times: [...times].sort((a, b) => a.minute - b.minute).map(({ minute, feedMode }) => ({ minute, feedMode })), days: [...days].sort((a, b) => a - b) };
  const check = formErrors(draft, { cap, others, problems });
  const errors = [...check.errors, ...server.filter((e) => !check.errors.includes(e))];
  const canAdd = canAddTime(draft, cap);
  const full = entry.vertical === 'last_few_days' && times.length >= 1 ? LFD_ONCE : `${label} can post ${cap} a day. Raise the daily limit on the ${label} page to add more.`;

  const settle = (minute: number) => setProblems((p) => p.filter((x) => !x.startsWith(`${clockLabel(minute)} `)));
  const edit = (fn: () => void) => { fn(); setServer([]); setDirty(true); };
  const setTime = (i: number, minute: number) => edit(() => { settle(times[i]!.minute); setTimes((t) => t.map((x, j) => (j === i ? { ...x, minute } : x))); });
  const setMode = (i: number, feedMode: FeedMode) => edit(() => { settle(times[i]!.minute); setTimes((t) => t.map((x, j) => (j === i ? { ...x, feedMode } : x))); });
  const remove = (i: number) => edit(() => { settle(times[i]!.minute); setTimes((t) => t.filter((_, j) => j !== i)); });
  const add = () => edit(() => setTimes((t) => [...t, { minute: nextTime(draft, { cap, others }), feedMode: reel ? DEFAULT_FEED_MODE[entry.vertical] : null, id: ++ids.current }]));
  const toggleDay = (d: number) => edit(() => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d])));

  const run = async (confirm: boolean) => {
    const out = await onSave(draft, confirm);
    if (out.kind === 'confirm') setAsk(out.lines);
    else if (out.kind === 'errors') setServer(out.errors);
  };

  const canSave = editable && !busy && errors.length === 0 && (dirty || view.merged);
  const problemAt = (m: number) => problems.some((p) => p.startsWith(`${clockLabel(m)} `)) || check.errors.includes(`${clockLabel(m)} is already in the list.`);

  return (
    <Floating anchor={anchor} flip label={`${label} schedule`} onClose={onClose} width={360}>
      <div className="sh-sched">
        {note ? <p className="sh-note" role="note">{note}</p> : null}
        {view.merged ? <p className="sh-note sh-sched__merged" role="note">{MERGED}</p> : null}

        <fieldset className="sh-sched__field" disabled={!editable}>
          <legend className="sh-sched__legend">Times</legend>
          {times.length ? (
            <ul className="sh-sched__times">
              {times.map((t, i) => (
                <li key={t.id} className="sh-sched__time" data-problem={problemAt(t.minute) ? 'true' : undefined}>
                  {editable ? (
                    <Menu label="Time" value={String(t.minute)} align="left" options={TIME_OPTIONS.map((m) => ({ value: String(m), label: clockLabel(m) }))} onSelect={(v) => setTime(i, Number(v))} />
                  ) : <span className="sh-sched__clock">{clockLabel(t.minute)}</span>}
                  {reel ? (
                    <div className="sh-pills" role="group" aria-label={`${clockLabel(t.minute)} posts as`}>
                      {(['trial', 'main'] as const).map((m) => (
                        <button key={m} type="button" className="sh-pill" aria-pressed={t.feedMode === m} onClick={() => setMode(i, m)}>{modeWord(m)}</button>
                      ))}
                    </div>
                  ) : null}
                  {editable ? (
                    <button type="button" className="sh-btn sh-btn--icon sh-btn--quiet sh-sched__remove" aria-label={`Remove ${clockLabel(t.minute)}`} onClick={() => remove(i)}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="sh-subtle">No times. {label} doesn’t post.</p>}
          {editable ? (
            <div className="sh-sched__add">
              <button type="button" className="sh-btn" disabled={!canAdd} onClick={add}><Plus size={14} aria-hidden="true" />Add a time</button>
              {!canAdd ? <p className="sh-subtle">{full}</p> : null}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="sh-sched__field" disabled={!editable}>
          <legend className="sh-sched__legend">Days</legend>
          <div className="sh-pills sh-sched__days" role="group" aria-label="Days">
            {DAY_ORDER.map((d) => (
              <button key={d} type="button" className="sh-pill" aria-pressed={days.includes(d)} onClick={() => toggleDay(d)}>{WEEKDAY_SHORT[d]}</button>
            ))}
          </div>
        </fieldset>

        {errors.length ? (
          <ul className="sh-sched__msgs sh-sched__msgs--error" role="alert">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        ) : null}
        {check.warnings.length ? (
          <ul className="sh-sched__msgs sh-sched__msgs--warn">
            {check.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        ) : null}

        {editable ? (
          <div className="sh-sched__foot">
            <button type="button" className="sh-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="sh-btn sh-btn--primary" disabled={!canSave} data-busy={busy ? '' : undefined} onClick={() => void run(false)}>
              {busy ? <Loader size={14} className="sh-board__spin" aria-hidden="true" /> : null}Save
            </button>
          </div>
        ) : null}
      </div>
      <ConfirmSave label={label} lines={ask} busy={busy} onClose={() => setAsk(null)} onOk={() => void run(true)} />
    </Floating>
  );
}

/** The yes a save needs (LFD / Carousels days, skip lines, or an empty schedule): the board's confirm dialog, with a line each. */
function ConfirmSave({ label, lines, busy, onClose, onOk }: { label: string; lines: string[] | null; busy: boolean; onClose: () => void; onOk: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (lines && !d.open) d.showModal();
    if (!lines && d.open) d.close();
  }, [lines]);
  return (
    <dialog ref={dialog} className="sh-confirm" aria-labelledby={titleId} onClose={onClose}>
      {lines ? (
        <>
          <h2 id={titleId}>Save the {label} schedule?</h2>
          {lines.map((l) => <p key={l}>{l}</p>)}
          <div className="sh-confirm__actions">
            <button type="button" className="sh-btn" onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="button" className="sh-btn sh-btn--primary" autoFocus disabled={busy} onClick={() => { dialog.current?.close(); onOk(); }}>Save</button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
