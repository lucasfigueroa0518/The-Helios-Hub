'use client';

import { useRouter } from 'next/navigation';
import { ChevronDown, Loader, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { ScheduleForm, type SaveOutcome } from '@/components/social-hub/calendar/ScheduleForm';
import { useScheduleSandbox } from '@/components/social-hub/calendar/schedule-sandbox';
import { ToastSlot } from '@/components/social-hub/calendar/toast-slot';
import { typeStyle } from '@/components/social-hub/ui/marks';
import {
  checkSchedule, confirmLines, replaceSchedule, savedToast, SCHEDULE_ENTRIES, scheduleFromTemplate, undoneToast,
  type BackToReady, type ScheduleConfirm, type ScheduleEntry, type ScheduleView, type TypeSchedule,
} from '@/lib/social-hub/slots/schedule';
import type { TemplateRow } from '@/lib/social-hub/slots/types';
import type { Vertical } from '@/lib/social-hub/types';

/**
 * The Calendar header's Schedules dropdown (spec 2026-10-21 §1): pick a
 * content type, then set its standing times (Trial / Main for reel types)
 * and the days it runs, every week from then on. Saves go to the schedule
 * route; Undo saves the schedule as it was (and, after an LFD / Carousels
 * confirm, the other type's too). On the preview (`sandbox`) nothing is
 * sent: the save replaces the on-screen template and the board follows.
 * All schedule fetches live in this file (tests/social-hub-scope.test.ts).
 */

const SCHEDULE = '/api/social-hub/slots/schedule';

const OFFLINE = 'Couldn’t reach the hub. Check your connection and try again.';
/** Why the form is read-only: the board's legacy notice (SourceSwitch), or the other reasons saving is off. */
const LEGACY_NOTE = 'The calendar is showing today’s settings. It starts deciding when you switch it on.';
const OFF_NOTE = 'Editing schedules is turned off for now, so this is read-only.';
const UNREAD_NOTE = 'The calendar couldn’t be read in full just now, so this is read-only. Refresh to try again.';

type Toast = { id: number; text: string; warn?: boolean; undo?: Undo };

/**
 * What Undo puts back. Live: the saved entry's old schedule, then the other
 * type's (LFD / Carousels) when the save took days from it. Preview: the
 * on-screen template as it was.
 */
type Undo =
  | { kind: 'live'; label: string; toReady: number; inverse: TypeSchedule; inverseOther: TypeSchedule | null }
  | { kind: 'sandbox'; label: string; template: TemplateRow[]; entries: ScheduleEntry[] };

async function post(body: unknown): Promise<{ status: number; out: Record<string, unknown> }> {
  const res = await fetch(SCHEDULE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, out: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const sameEntry = (a: Pick<ScheduleEntry, 'vertical' | 'series'>, b: Pick<ScheduleEntry, 'vertical' | 'series'>) =>
  a.vertical === b.vertical && a.series === b.series;
const entryKey = (e: ScheduleEntry) => `${e.vertical}:${e.series ?? ''}`;

export function SchedulesMenu({ schedules, caps, editable, sandbox, legacy = false, readOnlyReason = null, onSaved }: {
  /** Every entry's schedule as the page read it (merged when its days differ). */
  schedules: ScheduleView[];
  caps: Record<Vertical, number>;
  /** Saving is on: the switch is on, the flag is on, and the week read can be trusted. */
  editable: boolean;
  /** The preview: saves stay on screen. */
  sandbox: boolean;
  /** The switch is off: the form is read-only with the board's notice. */
  legacy?: boolean;
  /** Why saving is off when it isn't the switch: the editSlots flag, or a week read that can't be trusted. */
  readOnlyReason?: 'off' | 'unread' | null;
  /** After a save went through (on screen or on the server). */
  onSaved?: (schedule: TypeSchedule) => void;
}) {
  const router = useRouter();
  const box = useScheduleSandbox();
  const views: ScheduleView[] = sandbox && box ? SCHEDULE_ENTRIES.map((e) => scheduleFromTemplate(box.template, e)) : schedules;

  const [list, setList] = useState(false);
  const [open, setOpen] = useState<{ entry: ScheduleEntry; anchor: HTMLElement } | null>(null);
  const entry = open?.entry ?? null;
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastId = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const say = useCallback((t: Omit<Toast, 'id'>) => setToast({ ...t, id: ++toastId.current }), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((x) => (x?.id === toast.id ? null : x)), toast.warn ? 6000 : 9000);
    return () => clearTimeout(t);
  }, [toast]);

  // The list closes on Escape or a click outside (the hub Menu's behaviour).
  useEffect(() => {
    if (!list) return;
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setList(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setList(false); trigger.current?.focus(); } };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    root.current?.querySelector<HTMLButtonElement>('.sh-menu__item')?.focus();
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key); };
  }, [list]);

  const view = entry ? views.find((v) => sameEntry(v.schedule.entry, entry)) ?? null : null;
  const others = entry ? views.filter((v) => !sameEntry(v.schedule.entry, entry)).map((v) => v.schedule) : [];

  /** One save: the sandbox's on-screen version, or the route. A confirm comes back as its lines; the form asks, then saves again with `confirm`. */
  const save = useCallback(async (s: TypeSchedule, confirm: boolean): Promise<SaveOutcome> => {
    const label = s.entry.label;
    if (sandbox) {
      if (!box) return { kind: 'errors', errors: ['The preview couldn’t hold this change.'] };
      const rest = SCHEDULE_ENTRIES.filter((e) => !sameEntry(e, s.entry)).map((e) => scheduleFromTemplate(box.template, e).schedule);
      const check = checkSchedule(s, { cap: caps[s.entry.vertical], others: rest });
      if (check.errors.length) return { kind: 'errors', errors: check.errors };
      const ask: ScheduleConfirm | { kind: 'empty' } | null = check.empty ? { kind: 'empty' } : check.confirm;
      if (ask && !confirm) return { kind: 'confirm', lines: confirmLines(ask, label) };
      const was = box.template;
      const other = check.confirm ? SCHEDULE_ENTRIES.find((e) => e.vertical === (check.confirm!.kind === 'lfd-carousels' ? 'carousels' : 'last_few_days'))! : null;
      box.apply(replaceSchedule(was, s, check.confirm), [s.entry], other ? { entry: other, days: check.confirm!.days } : null);
      setOpen(null);
      say({ text: savedToast(label, []), undo: { kind: 'sandbox', label, template: was, entries: other ? [s.entry, other] : [s.entry] } });
      onSaved?.(s);
      return { kind: 'saved' };
    }
    setBusy(true);
    let res: Awaited<ReturnType<typeof post>>;
    try {
      res = await post({ schedule: s, confirm });
    } catch {
      return { kind: 'errors', errors: [OFFLINE] };
    } finally {
      setBusy(false);
    }
    const { status, out } = res;
    if (status === 200) {
      const toReady = typeof out.toReady === 'number' ? out.toReady : 0;
      const byType = Array.isArray(out.toReadyByType) ? (out.toReadyByType as BackToReady[]) : toReady ? [{ label, count: toReady }] : [];
      setOpen(null);
      router.refresh();
      say({ text: savedToast(label, byType), undo: { kind: 'live', label, toReady, inverse: out.inverse as TypeSchedule, inverseOther: (out.inverseOther as TypeSchedule | null) ?? null } });
      onSaved?.(s);
      return { kind: 'saved' };
    }
    const errors = Array.isArray(out.errors) ? (out.errors as string[]) : typeof out.error === 'string' ? [out.error] : ['That didn’t save. Try again in a moment.'];
    if (status === 422 && out.confirm) return { kind: 'confirm', lines: errors };
    // A half-done save (posts already sent back to Ready) changed the board: show it.
    if (typeof out.toReady === 'number' && out.toReady > 0) router.refresh();
    return { kind: 'errors', errors };
  }, [box, caps, onSaved, router, sandbox, say]);

  const undo = useCallback(async (u: Undo) => {
    setToast(null);
    if (u.kind === 'sandbox') {
      box?.apply(u.template, u.entries, null);
      say({ text: undoneToast(u.label, 0) });
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      // The saved entry first, then the other type's lost days (LFD / Carousels), in that order.
      const steps = u.inverseOther ? [u.inverse, u.inverseOther] : [u.inverse];
      let done = 0;
      // A second step that fails leaves the first restored: say so, so the half-done state isn't a surprise.
      const half = () => (done ? `${u.inverse.entry.label} schedule was restored; ${steps[done]!.entry.label} wasn’t. ` : '');
      for (const s of steps) {
        let res: Awaited<ReturnType<typeof post>>;
        try {
          res = await post({ schedule: s, confirm: true });
        } catch {
          if (done) router.refresh();
          say({ text: `${half()}${OFFLINE}`, warn: true });
          return;
        }
        if (res.status !== 200) {
          const { out } = res;
          const why = Array.isArray(out.errors) ? (out.errors as string[]).join(' ') : typeof out.error === 'string' ? out.error : 'Undo didn’t go through.';
          router.refresh();
          say({ text: `${half()}${why}`, warn: true });
          return;
        }
        done += 1;
      }
    } finally {
      setBusy(false);
    }
    router.refresh();
    say({ text: undoneToast(u.label, u.toReady) });
  }, [box, busy, router, say]);

  const pick = (e: ScheduleEntry) => {
    setList(false);
    if (trigger.current) setOpen({ entry: e, anchor: trigger.current });
  };

  return (
    <>
      {/* data-pick: a click on the dropdown doesn't count as outside the open form (useDismiss). */}
      <div className="sh-menu sh-sched-menu" ref={root} data-pick="">
        <button
          ref={trigger}
          type="button"
          className="sh-btn sh-menu__trigger"
          aria-haspopup="menu"
          aria-expanded={list}
          aria-controls={list ? listId : undefined}
          onClick={() => setList((v) => !v)}
        >
          <Settings2 size={14} aria-hidden="true" />
          <span>Schedules</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {list ? (
          <ul
            id={listId}
            role="menu"
            aria-label="Schedules"
            className="sh-menu__list"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('.sh-menu__item') ?? [])];
              const at = items.indexOf(document.activeElement as HTMLButtonElement);
              items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
            }}
          >
            {SCHEDULE_ENTRIES.map((e) => (
              <li key={entryKey(e)} role="none">
                <button type="button" role="menuitem" className="sh-menu__item" style={typeStyle(e.vertical)} onClick={() => pick(e)}>
                  <span className="sh-board__dot" aria-hidden="true" />
                  {e.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {open && view ? (
        <ScheduleForm
          key={entryKey(open.entry)}
          view={view}
          others={others}
          cap={caps[open.entry.vertical]}
          editable={editable}
          note={editable ? null : legacy ? LEGACY_NOTE : readOnlyReason === 'unread' ? UNREAD_NOTE : OFF_NOTE}
          busy={busy}
          anchor={open.anchor}
          onClose={() => setOpen(null)}
          onSave={save}
        />
      ) : null}

      {/* The week page's one toast place (toast-slot.tsx): stacked with the board's, never on top of it. */}
      <ToastSlot top={open !== null}>
        {toast ? (
          <div className={`sh-board__toast${toast.warn ? ' is-warn' : ''}`} role={toast.warn ? 'alert' : 'status'}>
            <span>{toast.text}</span>
            {toast.undo ? <button type="button" disabled={busy} onClick={() => void undo(toast.undo!)}>Undo</button> : null}
            {busy ? <Loader size={14} className="sh-board__spin" aria-label="Saving" /> : null}
          </div>
        ) : null}
      </ToastSlot>
    </>
  );
}
