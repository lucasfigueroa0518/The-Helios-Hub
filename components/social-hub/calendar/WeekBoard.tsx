'use client';

import { useRouter } from 'next/navigation';
import { Loader } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';

import { createHistory, type Command, type Tab } from '@/components/social-hub/calendar/history';
import { DayTimePicker, Floating, SlotCard, SlotPanel, type SlimPost } from '@/components/social-hub/calendar/SlotCard';
import { sourceSeries, sourceVertical, useBoardDrag, type DragSource } from '@/components/social-hub/calendar/useBoardDrag';
import { typeStyle } from '@/components/social-hub/ui/marks';
import { gapsFor, PAST_DAY } from '@/lib/social-hub/slots/rules';
import { clockLabel, SERIES_NAME, USUAL } from '@/lib/social-hub/slots/times';
import { slotId, type ResolvedSlot, type SlotSource, type StorySeries } from '@/lib/social-hub/slots/types';
import type { BookedPost } from '@/lib/social-hub/slots/write';
import { WEEKDAY_SHORT } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { verticalInfo } from '@/lib/social-hub/verticals';
import {
  boardModel, dayShortLabel, lanes, splitBooked, stuckNote, switchOnCopy, yForMinute,
  type BoardCard, type SwitchFacts, type WeekDayInput,
} from '@/lib/social-hub/views/week';
import {
  bookedHits, clockOf, readyTakenAt, dayCtx, dayName, defaultPlaceMinute, dropState, everyFor, nameOf, openMinutes, planCopyDay, readyMinutes, planEdit, planReady, planReset, TAKEN, toastText, WEEKDAY_LONG,
  type BoardState, type Drop, type Edit, type Every, type Hit,
} from '@/lib/social-hub/views/week-edit';

/**
 * The week board (spec 2026-10-20-calendar-week-board-redesign): seven day
 * timelines from 8 AM to 9 PM, a drag row on top, Ready to place and Gaps and
 * warnings underneath. Every edit is planned through views/week-edit.ts (the
 * same rules the server applies), shown at once, and saved to the slot writer;
 * a refusal puts the board back and says why. Booked posts ask first ("Move it
 * back to ready" sends them through the unschedule action, ruling R7). Undo is
 * a command per tab. On the preview (`sandbox`) nothing is sent: edits stay on
 * screen. All slot fetches live in this file (tests/social-hub-scope.test.ts).
 */

const SLOTS = '/api/social-hub/slots';
const SOURCE = '/api/social-hub/slots/source';
const UNSCHEDULE = '/api/social-hub/actions/unschedule';
const PLACE = '/api/social-hub/actions/place';

const OFFLINE = 'Couldn’t reach the hub. Check your connection and try again.';

/** " 2 posts already went back to Ready to place." after a half-done Move it back to ready. */
const movedNote = (n: number) => (n ? ` ${n} post${n === 1 ? '' : 's'} already went back to Ready to place.` : '');

export type ReadyItem = SlimPost & { series: StorySeries | null; made: string };

type Booked = { postId: string | null; vertical: Vertical; refs: Record<string, string>; label: string; why: Hit['why'] };

type Ask = { title: string; body: string; ok: string; cancel: string; run: () => void | Promise<void>; canOk?: boolean; /** Why OK is off, shown in the dialog. */ note?: string | null };

type Toast = { id: number; text: string; warn?: boolean; command?: Command; every?: Every | null };

type Pick = {
  anchor: HTMLElement;
  title: string;
  action: string;
  vertical: Vertical;
  series: StorySeries | null;
  /** The times a day offers this pick, and its first choice (null: none). */
  times: (day: number) => number[];
  first: (day: number) => number | null;
  /** What the picker says when a day offers no time. */
  none: (day: number) => string;
  /** Why this day and time can't take it, shown in the picker; null when it can. */
  check: (day: number, minute: number) => string | null;
  run: (day: number, minute: number) => void;
};

/** Module scope: undo survives switching between This week and Standard week. */
const history = createHistory();
/** The board as it was before each command, to show the undo at once. */
const before = new WeakMap<Command, BoardState<SlimPost>>();

async function post(url: string, body: unknown): Promise<{ status: number; out: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, out: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

type Sent = { ok: true } | { ok: false; booked?: Booked[]; reason?: string };

const TRAY: Array<{ vertical: Vertical; series: StorySeries | null; label: string }> = [
  { vertical: 'reels', series: null, label: 'Text on Screen' },
  { vertical: 'explainers', series: null, label: 'Explainer' },
  { vertical: 'carousels', series: null, label: 'Carousel' },
  { vertical: 'last_few_days', series: null, label: 'Last Few Days' },
  { vertical: 'stories', series: 'morning_download', label: SERIES_NAME.morning_download.one },
  { vertical: 'stories', series: 'guess_the_number', label: SERIES_NAME.guess_the_number.one },
  { vertical: 'stories', series: 'free_vs_paid', label: SERIES_NAME.free_vs_paid.one },
];

/** The narrowest lane card that keeps its short name whole ("Morning Dl" at 12px). */
const LANE_MIN = 86;

const HOURS = Array.from({ length: 12 }, (_, i) => (9 + i) * 60);
const AXIS = 21 * 60 - 8 * 60;
const pct = (m: number) => `${(yForMinute(m, AXIS) / AXIS) * 100}%`;
const hourLabel = (m: number) => { const h = m / 60; return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`; };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function WeekBoard(props: {
  mode: 'week' | 'template';
  /** The week shown (its Monday): undo only reaches edits made on this week. */
  monday: string;
  /** The unschedule action is on, so "Move it back to ready" can work. */
  canUnschedule: boolean;
  days: WeekDayInput[];
  standard: Record<number, ResolvedSlot[]>;
  caps: Record<Vertical, number>;
  posts: SlimPost[];
  ready: ReadyItem[];
  /** Server time of this render (the preview's fixed clock). */
  now: string;
  editable: boolean;
  /** The preview: edits stay on screen and nothing is sent. */
  sandbox: boolean;
  dim: Vertical | null;
}) {
  const router = useRouter();
  const { mode, caps, editable, sandbox } = props;
  const tab: Tab = mode === 'template' ? 'standard' : `week:${props.monday}`;

  // The server's board; a fresh one (after a save refreshes the page) replaces what's on screen.
  const base = useMemo<BoardState<SlimPost>>(() => ({ mode, days: props.days, standard: props.standard, posts: props.posts }), [mode, props.days, props.standard, props.posts]);
  const [seen, setSeen] = useState(base);
  const [state, setState] = useState(base);
  const [ready, setReady] = useState(props.ready);
  const [seenReady, setSeenReady] = useState(props.ready);
  // The board the server last confirmed: a failed save goes back to it, never to another edit's optimistic view.
  const confirmed = useRef(base);
  if (seen !== base) { setSeen(base); setState(base); confirmed.current = base; }
  if (seenReady !== props.ready) { setSeenReady(props.ready); setReady(props.ready); }
  const stateRef = useRef(state);
  stateRef.current = state;

  // Now ticks each minute on the live page (cards lock as their time comes); the preview's clock is fixed.
  const [now, setNow] = useState(() => new Date(props.now));
  useEffect(() => {
    if (sandbox) return;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [sandbox]);
  const clock = useMemo(() => clockOf(now), [now]);

  const model = useMemo(
    () => boardModel({ mode, days: state.days, posts: state.posts, now, caps, standard: mode === 'week' ? state.standard : undefined }),
    [mode, state, now, caps],
  );
  const laneOf = useMemo(() => lanes(model.cards), [model.cards]);
  const byDay = useMemo(() => model.columns.map((_, i) => model.cards.filter((c) => c.day === i)), [model]);

  const [toast, setToast] = useState<Toast | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const [reopen, setReopen] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const toastId = useRef(0);

  const say = useCallback((t: Omit<Toast, 'id'>) => setToast({ ...t, id: ++toastId.current }), []);
  const warn = useCallback((text: string) => say({ text, warn: true }), [say]);

  // One save at a time: while one is in flight, other edits wait for it (the board shows Saving…).
  const flight = useRef(false);
  const begin = useCallback((): boolean => {
    if (flight.current) { say({ text: 'Still saving the last change. Try again in a moment.' }); return false; }
    flight.current = true;
    setBusy(true);
    return true;
  }, [say]);
  const finish = useCallback(() => { flight.current = false; setBusy(false); }, []);
  const saving = () => { if (flight.current) say({ text: 'Still saving the last change. Try again in a moment.' }); return flight.current; };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((x) => (x?.id === toast.id ? null : x)), toast.warn ? 6000 : 9000);
    return () => clearTimeout(t);
  }, [toast]);

  // The open card left the board (moved, removed, refreshed): close its panel; a panel Move reopens on the new card.
  useEffect(() => {
    if (open && !model.cards.some((c) => c.key === open.key)) setOpen(null);
    if (reopen) {
      const el = document.querySelector<HTMLElement>(`[data-card="${CSS.escape(reopen)}"] .sh-board__open`);
      if (el) { setOpen({ key: reopen, anchor: el }); setReopen(null); }
    }
  }, [model.cards, open, reopen]);

  // ── Saving ──

  const send = useCallback(async (changes: Command['changes']): Promise<Sent> => {
    if (sandbox || !changes.length) return { ok: true };
    try {
      const { status, out } = await post(SLOTS, { changes });
      if (status === 200) return { ok: true };
      if (status === 409 && Array.isArray(out.booked)) {
        return {
          ok: false,
          booked: (out.booked as BookedPost[]).map((b) => ({ postId: null, vertical: b.vertical, refs: b.refs, why: b.why, label: `${verticalInfo(b.vertical).label} · ${dayShortLabel(b.nyDate)}` })),
        };
      }
      if (typeof out.error === 'string') return { ok: false, reason: out.error };
      if (Array.isArray(out.errors) && out.errors.length) return { ok: false, reason: (out.errors as string[]).join(' ') };
      return { ok: false, reason: 'That didn’t save. Try again in a moment.' };
    } catch {
      return { ok: false, reason: OFFLINE };
    }
  }, [sandbox]);

  /** Booked posts back to ready (the unschedule action); null when they all went. On the preview they join Ready to place. */
  const moveBack = useCallback(async (list: Booked[]): Promise<{ error: string | null; moved: number }> => {
    if (sandbox) {
      const ids = new Set(list.map((b) => b.postId));
      const moved = stateRef.current.posts.filter((p) => ids.has(p.id));
      setState((s) => ({ ...s, posts: s.posts.filter((p) => !ids.has(p.id)) }));
      setReady((r) => [...r, ...moved.map((p) => ({ ...p, nyDate: null, slot: null, status: 'ready' as const, approval: { ...p.approval, approvedAt: null }, series: p.slot?.id.split(':')[1] as StorySeries ?? null, made: 'Back from the calendar' }))]);
      return { error: null, moved: moved.length };
    }
    const { movable, stuck } = splitBooked(list);
    let moved = 0;
    for (const b of movable) {
      try {
        const { status, out } = await post(UNSCHEDULE, { vertical: b.vertical, refs: b.refs });
        if (status < 200 || status >= 300) return { error: `${typeof out.note === 'string' ? out.note : 'That post couldn’t move back to ready.'}${movedNote(moved)}`, moved };
      } catch {
        return { error: `${OFFLINE}${movedNote(moved)}`, moved };
      }
      moved += 1;
    }
    // A post with no action ref can't be unscheduled here: the change isn't sent, and the note says which moved.
    return { error: stuck.length ? `${stuckNote(stuck.length)} The slot didn’t change.${movedNote(moved)}` : null, moved };
  }, [sandbox]);

  const askBooked = useCallback((list: Booked[], then: () => void) => {
    const stories = list.every((b) => b.why === 'cannot-move');
    const n = list.length;
    setAsk({
      title: n === 1 ? 'A post is booked here' : `${n} posts are booked here`,
      body: stories
        ? `${n === 1 ? 'This Story’s set is' : 'These Stories’ sets are'} booked at ${n === 1 ? 'its' : 'their'} time, so the board can’t move ${n === 1 ? 'it' : 'them'}. Move ${n === 1 ? 'it' : 'them'} back to ready and the slot moves; the set goes back to Ready to place and needs approval again.`
        : `${list.map((b) => b.label).join('; ')}. Move ${n === 1 ? 'it' : 'them'} back to ready so ${n === 1 ? 'it goes' : 'they go'} back to Ready to place (${n === 1 ? 'its' : 'their'} approval is withdrawn), or keep ${n === 1 ? 'it' : 'them'} posting as booked.`,
      ok: 'Move it back to ready',
      cancel: 'Keep it',
      canOk: sandbox || (props.canUnschedule && splitBooked(list).movable.length > 0),
      note: !sandbox && !props.canUnschedule ? 'Moving posts back to ready is turned off for now, so this slot can’t change here.' : null,
      run: async () => {
        if (!begin()) return;
        const { error, moved } = await moveBack(list);
        finish();
        if (moved && !sandbox) {
          const ids = new Set(list.map((b) => b.postId));
          confirmed.current = { ...confirmed.current, posts: confirmed.current.posts.filter((p) => !ids.has(p.id)) };
        }
        if (error) { warn(error); if (!sandbox) router.refresh(); return; }
        then();
      },
    });
  }, [begin, finish, moveBack, props.canUnschedule, router, sandbox, warn]);

  type Commit = { label: string; changes: Command['changes']; inverse: Command['inverse']; next: BoardState<SlimPost> };
  type CommitOpts = { every?: Every | null; text?: string; undoable?: boolean; checked?: boolean; moved?: number; reopen?: string };

  const commit = useCallback(async (plan: Commit, o: CommitOpts = {}): Promise<void> => {
    const was = stateRef.current;
    if (!o.checked) {
      const hits = bookedHits(was, plan.next);
      if (hits.length) {
        const ids = new Set(hits.map((h) => h.post.id));
        const list = hits.map((h) => ({ postId: h.post.id, vertical: h.post.vertical, refs: h.post.refs, why: h.why, label: `“${h.post.name}”` }));
        askBooked(list, () => void commit({ ...plan, next: { ...plan.next, posts: plan.next.posts.filter((p) => !ids.has(p.id)) } }, { ...o, checked: true, undoable: false, moved: hits.length }));
        return;
      }
    }
    if (!begin()) return;
    setState(plan.next);
    const res = await send(plan.changes);
    finish();
    if (!res.ok) {
      setState(confirmed.current);
      if (res.booked) {
        askBooked(res.booked, () => void commit(plan, { ...o, checked: true, undoable: false, moved: (o.moved ?? 0) + res.booked!.length }));
        return;
      }
      warn(`${res.reason ?? 'That didn’t save.'}${movedNote(o.moved ?? 0)}`);
      if (o.moved && !sandbox) router.refresh();
      return;
    }
    confirmed.current = plan.next;
    if (!sandbox) router.refresh();
    const command: Command = { label: plan.label, changes: plan.changes, inverse: plan.inverse, tab, undoable: o.undoable !== false };
    history.push(command);
    before.set(command, was);
    const moved = o.moved ? ` ${plural(o.moved, 'post')} went back to Ready to place and ${o.moved === 1 ? 'needs' : 'need'} approval again.` : '';
    say({ text: `${o.text ?? toastText(plan.label, mode)}${moved}`, command, every: o.every ?? null });
    if (o.reopen) setReopen(o.reopen);
  }, [askBooked, begin, finish, mode, router, sandbox, say, send, tab, warn]);

  const doEdit = useCallback((edit: Edit, o: { reopen?: boolean } = {}) => {
    if (saving()) return;
    const s = stateRef.current;
    const p = planEdit(s, edit, clock);
    if (!p.ok) {
      if (p.confirm === 'remove-carousels') {
        const to = edit.op === 'move' ? edit.to : edit.day;
        const n = s.days[to]!.slots.filter((x) => x.vertical === 'carousels').length;
        setAsk({
          title: 'Make this a Last Few Days day?',
          body: `Last Few Days takes over the 3 AM run, so ${dayName(s, to)}’s ${plural(n, 'Carousel slot')} will be removed.`,
          ok: 'Make it Last Few Days',
          cancel: 'Cancel',
          run: () => doEdit({ ...edit, clearCarousels: true } as Edit, o),
        });
      } else warn(p.reason);
      return;
    }
    if (p.noop) return;
    const landed = edit.op === 'place' || edit.op === 'move' ? { ...edit, minute: p.minute! } : edit;
    const every = everyFor(s, landed, clock);
    const key = edit.op === 'move' ? `${edit.to}|${edit.key.vertical}|${slotId(p.minute!, edit.key.series)}` : undefined;
    void commit(p, { every, reopen: o.reopen ? key : undefined });
  }, [clock, commit, warn]);

  const runEvery = useCallback((every: Every) => {
    if (saving()) return;
    const s = stateRef.current;
    void commit({ label: every.label, changes: every.changes, inverse: every.inverse, next: { ...s, standard: every.standard } }, { text: `${every.label}.`, checked: true });
  }, [commit]);

  const undo = useCallback(async () => {
    if (saving() || !history.canUndo(tab)) return;
    if (!begin()) return;
    const c = history.undo(tab)!;
    const snap = before.get(c);
    if (snap) setState(snap);
    setToast(null);
    const res = await send(c.inverse);
    finish();
    if (!res.ok) {
      history.push(c);
      setState(confirmed.current);
      warn(res.booked ? 'Undo would leave a booked post without its slot, so nothing changed.' : res.reason ?? 'Undo didn’t go through.');
      return;
    }
    if (snap) confirmed.current = snap;
    if (!sandbox) router.refresh();
    say({ text: `Undone: ${c.label}.` });
  }, [begin, finish, router, sandbox, say, send, tab, warn]);

  // Cmd/Ctrl+Z undoes the tab's last change (not while a dialog or a field has focus).
  useEffect(() => {
    if (!editable) return;
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      if (document.querySelector('dialog[open]') || (e.target instanceof Element && e.target.closest('input, select, textarea'))) return;
      if (!history.canUndo(tab)) return;
      e.preventDefault();
      void undo();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [editable, tab, undo]);

  const doReset = useCallback((day: number) => {
    if (saving()) return;
    const p = planReset(stateRef.current, day, clock);
    if (!p.ok) { warn(p.reason); return; }
    if (p.noop) { say({ text: `${dayName(stateRef.current, day)} already matches the standard week.` }); return; }
    void commit(p, { text: `${p.label}.` });
  }, [clock, commit, say, warn]);

  const doCopyDay = useCallback((day: number) => {
    if (saving()) return;
    const s = stateRef.current;
    const p = planCopyDay(s, day);
    if (!p.ok) { warn(p.reason); return; }
    if (p.noop) return;
    void commit({ label: p.label, changes: p.changes, inverse: p.inverse, next: { ...s, standard: p.standard } }, { text: `${p.label}.`, checked: true });
  }, [commit, warn]);

  const readyTaken = (st: BoardState<SlimPost>, item: ReadyItem, nyDate: string | null) => readyTakenAt(st, item, item.series, nyDate);

  const placeReady = useCallback(async (item: ReadyItem, day: number, minute: number) => {
    if (saving()) return;
    const s = stateRef.current;
    const r = planReady(s, item, item.series, day, minute, clock);
    if (!r.ok) { warn(r.reason); return; }
    const readyWas = ready;
    if (!begin()) return;
    setState(r.next);
    setReady((x) => x.filter((y) => y.id !== item.id));
    if (sandbox) finish();
    else {
      try {
        const { status, out } = await post(PLACE, { vertical: item.vertical, refs: item.refs, nyDate: s.days[day]!.nyDate, slot: r.slot });
        if (status < 200 || status >= 300 || out.ok === false) {
          setState(confirmed.current);
          setReady(readyWas);
          warn(typeof out.note === 'string' ? out.note : 'That post couldn’t be placed.');
          return;
        }
      } catch {
        setState(confirmed.current);
        setReady(readyWas);
        warn(OFFLINE);
        return;
      } finally {
        finish();
      }
      router.refresh();
    }
    confirmed.current = r.next;
    history.push({ label: r.label, changes: [], inverse: [], tab, undoable: false });
    say({ text: r.label });
  }, [begin, clock, finish, ready, router, sandbox, say, tab, warn]);

  // ── Drag ──

  const grid = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);

  const preview = useCallback((source: DragSource, day: number, raw: number, prev: Drop | null): Drop | null => {
    const s = stateRef.current;
    const col = model.columns[day];
    if (!col) return null;
    if (col.folded) return { minute: raw, snappedTo: null, tone: 'refused', tag: PAST_DAY, reason: PAST_DAY };
    const ctx = dayCtx(s, day, clock);
    const vertical = sourceVertical(source);
    const series = sourceSeries(source);
    if (source.kind === 'ready') {
      const item = ready.find((r) => r.id === source.id);
      if (!item) return null;
      return dropState({ ctx, vertical, series, raw, caps, prev, ready: { taken: readyTaken(s, item, ctx.nyDate) } });
    }
    return dropState({ ctx, vertical, series, raw, caps, prev, ignore: source.kind === 'card' && source.day === day ? source.key : null });
  }, [caps, clock, model.columns, ready]);

  const onDrop = useCallback((source: DragSource, day: number, drop: Drop | null) => {
    if (!drop) return;
    if (drop.tone === 'refused') { warn(drop.reason ?? TAKEN); return; }
    if (source.kind === 'card') doEdit({ op: 'move', day: source.day, key: source.key, to: day, minute: drop.minute });
    else if (source.kind === 'type') doEdit({ op: 'place', day, vertical: source.vertical, series: source.series, minute: drop.minute });
    else {
      const item = ready.find((r) => r.id === source.id);
      if (item) void placeReady(item, day, drop.minute);
    }
  }, [doEdit, placeReady, ready, warn]);

  const drag = useBoardDrag({
    grid,
    ghost,
    preview,
    onDrop,
    onRemove: (source) => doEdit({ op: 'remove', day: source.day, key: source.key }),
  });
  const dragVertical = drag.dragging ? sourceVertical(drag.dragging) : null;

  // ── Layout ──

  // An open day grows with its widest cluster so each lane keeps a short name whole (fix round 2, A).
  const widest = model.columns.map((_, i) => Math.max(1, ...byDay[i]!.map((c) => laneOf.get(c.key)?.of ?? 1)));
  const cols = model.columns.map((c, i) => (c.folded ? '76px' : `minmax(max(var(--sh-col-min), ${widest[i]! * LANE_MIN + 8}px), 1fr)`)).join(' ');
  const when = (day: number) => dayName(state, day);
  const dayOptions = model.columns.flatMap((c, i) => (c.folded ? [] : [{ day: i, label: mode === 'week' && c.nyDate ? dayShortLabel(c.nyDate) : WEEKDAY_LONG[c.weekday]! }]));
  const openCard = open ? model.cards.find((c) => c.key === open.key) ?? null : null;

  const gaps = useMemo(() => {
    if (!editable) return [];
    return state.days.flatMap((d, i) => (model.columns[i]!.folded ? [] : gapsFor(dayCtx(state, i, clock), state.standard[d.weekday] ?? [], caps).map((g) => ({ ...g, day: i }))));
  }, [caps, clock, editable, model.columns, state]);

  const fixGap = (g: (typeof gaps)[number]) => {
    const f = g.fix;
    if (!f) return;
    if (f.op === 'place') doEdit({ op: 'place', day: g.day, vertical: f.vertical, series: f.series, minute: f.startMinute, feedMode: f.feedMode });
    else if (f.op === 'move') doEdit({ op: 'move', day: g.day, key: f.key, to: g.day, minute: f.toMinute });
    else doEdit({ op: 'remove', day: g.day, key: f.key });
  };
  const fixLabel = (g: (typeof gaps)[number]) => {
    const f = g.fix!;
    return f.op === 'place' ? `Add ${nameOf(f)}` : f.op === 'move' ? `Move to ${clockLabel(f.toMinute)}` : 'Remove';
  };

  const openPick = (anchor: HTMLElement, p: Omit<Pick, 'anchor'>) => setPick({ anchor, ...p });
  const timesFor = (day: number) => openMinutes(dayCtx(stateRef.current, day, clock));
  const addPick = (anchor: HTMLElement, t: (typeof TRAY)[number]) =>
    openPick(anchor, {
      title: `Add ${t.label}`, action: 'Add', vertical: t.vertical, series: t.series,
      times: timesFor,
      first: (day) => defaultPlaceMinute(dayCtx(stateRef.current, day, clock), t.vertical),
      none: () => 'No time left on this day. Pick another day.',
      check: (day, minute) => {
        const p = planEdit(stateRef.current, { op: 'place', day, vertical: t.vertical, series: t.series, minute }, clock);
        return p.ok || p.confirm ? null : p.reason;
      },
      run: (day, minute) => doEdit({ op: 'place', day, vertical: t.vertical, series: t.series, minute }),
    });
  const readyPick = (anchor: HTMLElement, r: ReadyItem) =>
    openPick(anchor, {
      title: `Place “${r.name}”`, action: 'Place', vertical: r.vertical, series: r.series,
      times: (day) => readyMinutes(dayCtx(stateRef.current, day, clock), r.vertical, r.series),
      first: (day) => (r.series
        ? readyMinutes(dayCtx(stateRef.current, day, clock), r.vertical, r.series)[0] ?? null
        : defaultPlaceMinute(dayCtx(stateRef.current, day, clock), r.vertical)),
      none: (day) => (r.series ? `No open ${SERIES_NAME[r.series].one} slot on ${dayName(stateRef.current, day)}.` : 'No time left on this day. Pick another day.'),
      check: (day, minute) => {
        const p = planReady(stateRef.current, r, r.series, day, minute, clock);
        return p.ok ? null : p.reason;
      },
      run: (day, minute) => void placeReady(r, day, minute),
    });

  /** A gap's text names its day ("Wed has no Explainer."; "Wed: Explainer at 12:00 PM is outside its usual window."). */
  const gapText = (g: (typeof gaps)[number]) => {
    const short = WEEKDAY_SHORT[state.days[g.day]!.weekday]!;
    return g.text.startsWith(`${short} `) ? g.text : `${short}: ${g.text}`;
  };

  return (
    <div className="sh-board" data-dragging={drag.dragging ? 'true' : undefined} data-busy={busy ? 'true' : undefined}>
      {busy ? <p className="sh-board__saving" role="status"><Loader size={14} className="sh-board__spin" aria-hidden="true" />Saving… other changes wait for this one.</p> : null}
      {sandbox ? <p className="sh-note sh-board__sandbox">Preview: changes stay on this screen and nothing is saved.</p> : null}
      {editable ? (
        <div className="sh-board__tray" data-remove={drag.dragging?.kind === 'card' ? 'true' : undefined} data-over={drag.overRow ? 'true' : undefined} {...drag.rowProps}>
          <span className="sh-board__tray-label">Drag in:</span>
          <ul className="sh-board__chips">
            {TRAY.map((t) => (
              <li key={`${t.vertical}-${t.series ?? ''}`}>
                {/* A span, not a <button>: Firefox won't start a drag from a button. */}
                <span
                  role="button"
                  tabIndex={0}
                  className="sh-board__chip"
                  data-pick=""
                  style={typeStyle(t.vertical)}
                  title="Drag onto a day, or click to pick a day and time"
                  aria-haspopup="dialog"
                  {...drag.sourceProps({ kind: 'type', vertical: t.vertical, series: t.series, label: t.label }, !busy)}
                  onClick={(e) => addPick(e.currentTarget, t)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addPick(e.currentTarget, t); } }}
                >
                  <span className="sh-board__dot" aria-hidden="true" />{t.label}
                </span>
              </li>
            ))}
          </ul>
          <span className="sh-board__remove-hint" aria-hidden={drag.dragging?.kind !== 'card'}>Drop here to remove</span>
        </div>
      ) : null}

      <div className="sh-board__scroll">
        <div ref={grid} className="sh-board__grid" style={{ gridTemplateColumns: `44px ${cols}` } as CSSProperties} role="group" aria-label={mode === 'template' ? 'Standard week' : 'This week'}>
          <div className="sh-board__gutter" aria-hidden="true">
            <div className="sh-board__dhead" />
            <div className="sh-board__axis sh-board__axis--gutter">
              {HOURS.map((m) => <span key={m} className="sh-board__hour" style={{ top: pct(m) }}>{hourLabel(m)}</span>)}
            </div>
          </div>
          {model.columns.map((c, i) => {
            const cards = byDay[i]!;
            const label = mode === 'week' && c.nyDate ? `${WEEKDAY_SHORT[c.weekday]} ${Number(c.nyDate.slice(8))}` : WEEKDAY_LONG[c.weekday];
            const spoken = mode === 'week' && c.nyDate ? `${WEEKDAY_LONG[c.weekday]} ${dayShortLabel(c.nyDate).slice(4)}` : `Every ${WEEKDAY_LONG[c.weekday]}`;
            if (c.folded) {
              return (
                <section key={i} className="sh-board__day is-folded" aria-label={`${spoken}, past: ${c.count} posted`}>
                  <header className="sh-board__dhead"><span className="sh-board__dname">{label}</span></header>
                  <p className="sh-board__fold">{c.count} posted</p>
                </section>
              );
            }
            const blocked = dragVertical === 'carousels' && state.days[i]!.slots.some((s) => s.vertical === 'last_few_days');
            return (
              <section key={i} className={`sh-board__day${c.isToday ? ' is-today' : ''}`} aria-label={`${spoken}, ${plural(cards.length, 'slot')}${c.edited ? ', edited' : ''}`}>
                <header className="sh-board__dhead">
                  <span className="sh-board__dname">{label}<span className="sh-board__count">{cards.length}</span></span>
                  <span className="sh-board__badges">
                    {c.isToday ? <span className="sh-board__badge sh-board__badge--today">Today</span> : null}
                    {c.edited ? <span className="sh-board__badge sh-board__badge--edited">Edited</span> : null}
                    {c.edited && editable ? <button type="button" className="sh-board__lnk" onClick={() => doReset(i)}>Reset</button> : null}
                  </span>
                </header>
                <div className="sh-board__axis" data-day={i} {...(editable ? drag.axisProps(i) : {})}>
                  {HOURS.map((m) => <span key={m} className={`sh-board__line${m === 720 ? ' is-noon' : ''}`} style={{ top: pct(m) }} aria-hidden="true" />)}
                  {dragVertical && !blocked ? USUAL[dragVertical].map((w) => {
                    if (c.isToday && w.end <= clock.nowMinute) return null;
                    return (
                      <span key={w.start} className="sh-board__band" style={{ ...typeStyle(dragVertical), top: pct(w.start), height: `calc(${pct(w.end)} - ${pct(w.start)})` }} aria-hidden="true">
                        usual · {w.name.toLowerCase()}
                      </span>
                    );
                  }) : null}
                  {blocked ? <span className="sh-board__blocked" aria-hidden="true">Last Few Days day: no Carousels</span> : null}
                  {c.isToday && clock.nowMinute >= 480 && clock.nowMinute <= 1260 ? <span className="sh-board__now" style={{ top: pct(clock.nowMinute) }} aria-hidden="true" /> : null}
                  {cards.length === 0 && !drag.dragging ? <p className="sh-board__empty">Nothing posts. {editable ? 'Drag a type here.' : ''}</p> : null}
                  {cards.map((card) => (
                    <SlotCard
                      key={card.key}
                      card={card}
                      lane={laneOf.get(card.key) ?? { lane: 0, of: 1 }}
                      when={when(i)}
                      editable={editable}
                      dimmed={props.dim !== null && props.dim !== card.vertical}
                      faded={drag.dragging?.kind === 'card' && drag.dragging.cardKey === card.key}
                      open={open?.key === card.key}
                      dragProps={drag.sourceProps({ kind: 'card', day: i, key: { vertical: card.vertical, startMinute: card.startMinute, series: card.series }, cardKey: card.key, label: chipLabel(card) }, editable && !card.locked && !busy)}
                      onOpen={(anchor) => setOpen((o) => (o?.key === card.key ? null : { key: card.key, anchor }))}
                      onFlip={() => card.feedMode && doEdit({ op: 'mode', day: i, key: { vertical: card.vertical, startMinute: card.startMinute, series: card.series }, feedMode: card.feedMode === 'trial' ? 'main' : 'trial' })}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          <div ref={ghost} className="sh-board__ghost" hidden aria-hidden="true">
            <span data-ghost-name="" />
            <span className="sh-board__ghost-tag" data-ghost-tag="" />
          </div>
        </div>
      </div>

      <ul className="sh-key sh-board__key" aria-label="Key">
        <li><span className="sh-board__tag sh-board__tag--key" data-mode="trial">Trial</span> / <span className="sh-board__tag sh-board__tag--key" data-mode="main">Main</span> click to switch</li>
        {mode === 'week' ? <li><span className="sh-board__mark" aria-hidden="true" />a post is booked</li> : null}
        {mode === 'week' ? <li><span className="sh-board__badge sh-board__badge--edited">Edited</span>differs from the standard week</li> : null}
        <li>{editable ? 'Click a slot for details · drag to move · drag back onto the row above to remove' : 'Click a slot for details'}</li>
        <li>Times are New York.</li>
      </ul>

      {editable ? (
        <div className="sh-board__below">
          {mode === 'week' ? (
            <section className="sh-panel sh-board__section" aria-labelledby="sh-board-ready">
              <h2 className="sh-title" id="sh-board-ready">Ready to place <span className="sh-count">{ready.length}</span></h2>
              <p className="sh-subtle">Made, with no slot yet. Drag one onto a day and time.</p>
              {ready.length ? (
                <ul className="sh-board__ready">
                  {ready.map((r) => (
                    <li key={r.id} className="sh-board__rcard" style={typeStyle(r.vertical)} {...drag.sourceProps({ kind: 'ready', id: r.id, vertical: r.vertical, series: r.series, label: r.name }, !busy)}>
                      <span className="sh-board__dot" aria-hidden="true" />
                      <span className="sh-board__rmain">
                        <span className="sh-board__rname">{r.name}</span>
                        <span className="sh-subtle">{r.series ? SERIES_NAME[r.series].one : verticalInfo(r.vertical).label} · {r.made}</span>
                      </span>
                      <button
                        type="button"
                        className="sh-btn sh-btn--quiet"
                        data-pick=""
                        onClick={(e) => readyPick(e.currentTarget, r)}
                      >
                        Place…
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="sh-board__none">Nothing waiting. Everything made has a slot.</p>}
            </section>
          ) : null}
          <section className="sh-panel sh-board__section" aria-labelledby="sh-board-gaps">
            <h2 className="sh-title" id="sh-board-gaps">Gaps and warnings <span className="sh-count">{gaps.length}</span></h2>
            <p className="sh-subtle">Things worth a look before the week runs.</p>
            {gaps.length ? (
              <ul className="sh-board__gaps">
                {gaps.map((g, j) => (
                  <li key={`${g.day}-${g.kind}-${j}`}>
                    <span className="sh-board__warn" aria-hidden="true">!</span>
                    <span className="sh-board__gtext">{gapText(g)}</span>
                    {g.fix ? <button type="button" className="sh-btn" onClick={() => fixGap(g)}>{fixLabel(g)}</button> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="sh-board__none">No gaps. The week looks complete.</p>}
          </section>
        </div>
      ) : null}

      {open && openCard ? (
        <SlotPanel
          key={`${openCard.key}|${openCard.feedMode ?? ''}`}
          card={openCard}
          column={model.columns[openCard.day]!}
          mode={mode}
          anchor={open.anchor}
          flip={openCard.day >= 4}
          editable={editable}
          dayOptions={dayOptions}
          timesFor={timesFor}
          onClose={() => setOpen(null)}
          onMode={(m) => doEdit({ op: 'mode', day: openCard.day, key: cardKey(openCard), feedMode: m })}
          onMove={(to, minute) => doEdit({ op: 'move', day: openCard.day, key: cardKey(openCard), to, minute }, { reopen: true })}
          onRemove={() => { setOpen(null); doEdit({ op: 'remove', day: openCard.day, key: cardKey(openCard) }); }}
          onReset={() => { setOpen(null); doReset(openCard.day); }}
          onCopyDay={() => doCopyDay(openCard.day)}
        />
      ) : null}

      {pick ? (
        <PlacePicker
          pick={pick}
          dayOptions={dayOptions}
          onClose={() => setPick(null)}
        />
      ) : null}

      <Confirm ask={ask} busy={busy} onClose={() => setAsk(null)} />

      <div className={`sh-board__toasts${open || pick ? ' is-top' : ''}`} aria-live="polite">
        {toast ? (
          <div className={`sh-board__toast${toast.warn ? ' is-warn' : ''}`} role={toast.warn ? 'alert' : 'status'}>
            <span>{toast.text}</span>
            {toast.every ? <button type="button" className="sh-board__toast-primary" onClick={() => { const e = toast.every!; setToast(null); runEvery(e); }}>{toast.every.button}</button> : null}
            {toast.command && toast.command.undoable && history.peek(tab) === toast.command ? <button type="button" onClick={() => void undo()}>Undo</button> : null}
            {busy ? <Loader size={14} className="sh-board__spin" aria-label="Saving" /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const cardKey = (c: BoardCard<SlimPost>) => ({ vertical: c.vertical, startMinute: c.startMinute, series: c.series });

/** The ghost's name: the type, or the Stories series. */
function chipLabel(c: BoardCard<SlimPost>): string {
  return c.series ? SERIES_NAME[c.series].one : verticalInfo(c.vertical).label;
}

/** The keyboard and touch path for the drag row and Ready to place: a day and a time, then Add / Place. */
function PlacePicker({ pick, dayOptions, onClose }: {
  pick: Pick;
  dayOptions: Array<{ day: number; label: string }>;
  onClose: () => void;
}) {
  // The first day this pick has a time on (today after 8:45 PM has none; a Story needs its series' slot).
  const start = dayOptions.find((d) => pick.first(d.day) !== null)?.day ?? dayOptions[0]?.day ?? 0;
  const [day, setDay] = useState(start);
  const [minute, setMinute] = useState<number | null>(() => pick.first(start));
  const [why, setWhy] = useState<string | null>(null);
  const times = pick.times(day);
  const go = () => {
    if (minute === null) return;
    const reason = pick.check(day, minute);
    if (reason) { setWhy(reason); return; }
    onClose();
    pick.run(day, minute);
  };
  return (
    <Floating anchor={pick.anchor} flip={false} label={pick.title} onClose={onClose} width={300}>
      <div className="sh-board__move">
        <DayTimePicker
          dayLabel="Day"
          days={dayOptions}
          day={day}
          minute={minute ?? times[0] ?? 0}
          times={times}
          onDay={(d) => { setDay(d); setWhy(null); setMinute((m) => (m !== null && pick.times(d).includes(m) ? m : pick.first(d))); }}
          onMinute={(m) => { setMinute(m); setWhy(null); }}
        />
        <button type="button" className="sh-btn sh-btn--primary" disabled={minute === null || !times.includes(minute)} onClick={go}>{pick.action}</button>
      </div>
      {!times.length ? <p className="sh-subtle">{pick.none(day)}</p> : null}
      {why ? <p className="sh-note sh-note--failed" role="alert">{why}</p> : null}
    </Floating>
  );
}

function Confirm({ ask, busy, onClose }: { ask: Ask | null; busy: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (ask && !d.open) { opener.current = document.activeElement as HTMLElement | null; d.showModal(); }
    if (!ask && d.open) d.close();
  }, [ask]);
  return (
    <dialog ref={dialog} className="sh-confirm" aria-labelledby={titleId} onClose={() => { onClose(); opener.current?.focus?.(); }}>
      {ask ? (
        <>
          <h2 id={titleId}>{ask.title}</h2>
          <p>{ask.body}</p>
          {ask.note ? <p className="sh-note" role="note">{ask.note}</p> : null}
          <div className="sh-confirm__actions">
            <button type="button" className="sh-btn" onClick={() => dialog.current?.close()}>{ask.cancel}</button>
            <button
              type="button"
              className="sh-btn sh-btn--primary"
              autoFocus
              disabled={busy || ask.canOk === false}
              onClick={() => { const run = ask.run; dialog.current?.close(); void run(); }}
            >
              {ask.ok}
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}

/**
 * The cutover switch (spec §5): in legacy mode a notice with Switch on; in
 * template mode a small Switch back. Both confirm their consequence first.
 */
export function SourceSwitch({ source, readOnly = false, facts }: { source: SlotSource; readOnly?: boolean; /** What switching on changes (read on the server). */ facts: SwitchFacts }) {
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
      const { status, out } = await post(SOURCE, { source: on ? 'legacy' : 'template' });
      if (status === 200) {
        dialog.current?.close();
        router.refresh();
      } else setNote(typeof out.error === 'string' ? out.error : 'That didn’t switch. Try again in a moment.');
    } catch {
      setNote(OFFLINE);
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
            : switchOnCopy(facts)}
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
