'use client';

import { isStoryVertical } from '@/lib/social-hub/story-types';
import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';

import { clearOldHold } from '@/components/content-type/AiEventsPoolButtons';
import { GenerateConfirm } from '@/components/content-type/GenerateConfirm';
import { PoolQueue } from '@/components/content-type/PoolQueue';
import { postQueue } from '@/components/content-type/queue-post';
import { useRunProgress } from '@/components/content-type/run-progress';
import { ownRun, panelRun, runForPost, useTicking } from '@/components/content-type/pool/bits';
import { IdeaPanel } from '@/components/content-type/pool/IdeaPanel';
import { IdeaRow } from '@/components/content-type/pool/IdeaRow';
import { MadeRow } from '@/components/content-type/pool/MadeRow';
import { PoolBoard } from '@/components/content-type/pool/PoolBoard';
import { BOARD_AHEAD_DAYS, BOARD_BACK_DAYS, type PoolPageData } from '@/components/content-type/pool/pool-data';
import { PoolTabs, type PoolTab } from '@/components/content-type/pool/PoolTabs';
import { PostPanel } from '@/components/content-type/pool/PostPanel';
import { TYPE_CONFIG } from '@/lib/content-type/config';
import type { TypeBenchItem, TypeCard, TypeHubModel } from '@/lib/content-type/model';
import { madeRowState, type PoolRowState } from '@/lib/content-type/pool-rules';
import { poolBoard, poolIdeas, poolMade, poolRunway, poolSlotsPerDay, type PoolIdeaRow } from '@/lib/content-type/pool-view';
import type { GenerateIdea } from '@/lib/content-type/queue-client';
import { refreshHubPage } from '@/lib/content-type/refresh-client';
import { formatUsd } from '@/lib/social-hub/cost';
import { POOL_CAP } from '@/lib/social-hub/queue';
import { addDays, nyDateOf, nyDayStart } from '@/lib/social-hub/time';
import type { HubIdea, HubPost } from '@/lib/social-hub/types';

/**
 * The pool screen (pool UI contract §5, mock docs/superpowers/specs/mocks/2026-11-15-pool-screen.html): the header
 * line and runway, the next three days, Ideas | Made | Settings, the list with its Up next band, and the idea and post panels.
 * Every type page draws its pool with it; the type's settings (TYPE_CONFIG[type].pool) are all that differ.
 *
 * Its writes go only through the existing routes: Pin, Unpin, Archive and the drag through the idea queue
 * (queue-post.ts, PoolQueue), Make it through the make function the page hands in. Archive takes effect on screen at
 * once and is written when its 5-second Undo runs out (the queue has no unarchive), so Undo is real.
 *
 * Styles: components/content-type/pool/pool.css, imported by the pages that draw it (ContentTypePage, the reels page,
 * the preview), so this file stays importable where CSS is not (the page tests).
 */

const UNDO_MS = 5000;
const LEAVE_MS = 200;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
const WHOLE_LIST = new Set(['last_few_days', 'ai_events']);
/**
 * The types whose worker really trims the pool to POOL_CAP open ideas (Explainers: lib/explainers/ideas/evaluate.ts;
 * Stories, per series: lib/stories/pool.ts). Only these can be "full"; every other type's list is a view capped at 30
 * over a longer pool, so its length never switches Seed off.
 */
const TRIMMED = new Set(['explainers', 'stories', 'ai_trivia', 'real_or_ai']);

type Open = { kind: 'idea'; id: string } | { kind: 'post'; id: string } | null;
type Toast = { kind: 'archive'; id: string; title: string } | { kind: 'note'; text: string } | null;
type Ask = { id: string; title: string; reason: 'top' | 'over_cap'; costUsd: number | null } | null;

/** The bench in the order the person sees it while a drop is on its way: `seen` takes the places its rows hold. */
function applySeen(bench: readonly TypeBenchItem[], seen: readonly string[] | null): TypeBenchItem[] {
  if (!seen) return [...bench];
  const byId = new Map(bench.map((b) => [b.idea.id, b]));
  const queue = seen.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const inSeen = new Set(queue.map((b) => b.idea.id));
  let k = 0;
  return bench.map((b) => (inSeen.has(b.idea.id) ? queue[k++] ?? b : b));
}

export function PoolScreen({ model, data, readOnly = false, make, generate, seed, postExtras, ideaExtras, progress, settings, initialTab = 'ideas', fullPostBase, fromPath }: {
  model: TypeHubModel;
  /** The dataset's pieces (posts, slots, moves), each post's card, and the one `now`. Missing: the model alone, drawn now. */
  data?: PoolPageData | null;
  /** The preview: no buttons that write. */
  readOnly?: boolean;
  /** Make it on one idea (Explainers, AI Drama, Field Notes). */
  make?: GenerateIdea;
  /** Asked about when an idea with nothing made is pinned or dragged into today's slots. Defaults to `make`. */
  generate?: GenerateIdea;
  /** The type's Seed button, switched off at the cap. */
  seed?: (opts: { disabled: boolean }) => ReactNode;
  /** A type's own controls in the post panel (Text on Screen: song, finish, publish). */
  postExtras?: (post: HubPost) => ReactNode;
  /** A type's own controls in the idea panel (Text on Screen: Generate Reel). */
  ideaExtras?: (idea: HubIdea) => ReactNode;
  /** The run-progress strip, under the runway. */
  progress?: ReactNode;
  /**
   * The Settings tab (settings standard D8, D9: components/content-type/pool/SettingsTab.tsx), built by the type page
   * outside the read-only hub code because it writes. None (the preview): the tabs are Ideas | Made.
   */
  settings?: ReactNode;
  /** The tab shown first (`?tab=settings` opens Settings). */
  initialTab?: PoolTab;
  fullPostBase: string;
  fromPath: string;
}) {
  const router = useRouter();
  const vertical = model.vertical;
  const config = TYPE_CONFIG[vertical];
  const { noun, order } = config.pool;
  const moves = readOnly ? { pin: false, drag: false, archive: false, make: false } : { ...config.pool.moves, make: config.pool.moves.make && make != null };
  const askWith = generate ?? make;
  const wholeList = WHOLE_LIST.has(vertical);
  const live = useRunProgress();

  const nowIso = data?.nowIso;
  // One `now` per read: the board and Up next must agree.
  const now = useMemo(() => {
    if (nowIso) return new Date(nowIso);
    // No read time handed in (a test render): now, if it is still the model's day, else the start of the model's day.
    const clock = new Date();
    return nyDateOf(clock) === model.today ? clock : nyDayStart(model.today);
  }, [nowIso, model]);
  const source = data?.source;
  const cards = useMemo(() => data?.cards ?? {}, [data]);

  const [tab, setTab] = useState<PoolTab>(initialTab === 'settings' && !settings ? 'ideas' : initialTab);
  const [startDay, setStartDay] = useState(model.today);
  const [group, setGroup] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [seen, setSeen] = useState<string[] | null>(null);
  const [pinOverride, setPinOverride] = useState<Record<string, boolean>>({});
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<string | null>(null);
  const [making, setMaking] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [flashes, setFlashes] = useState<Record<string, number>>({});
  const [pops, setPops] = useState<Record<string, boolean>>({});
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A fresh read is the truth again: optimistic pins and Making marks give way to it.
  useEffect(() => {
    setPinOverride({});
    setMaking(new Set());
    setHidden((prev) => (pending.current && prev.has(pending.current.id) ? new Set([pending.current.id]) : prev.size ? new Set() : prev));
  }, [model]);

  const flash = useCallback((id: string, pop = false) => {
    setFlashes((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    if (pop) {
      setPops((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => setPops((prev) => ({ ...prev, [id]: false })), 400);
    }
  }, []);
  const note = useCallback((text: string) => {
    setToast({ kind: 'note', text });
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setToast((t) => (t?.kind === 'note' ? null : t)), 6000);
  }, []);
  const refresh = useCallback(() => void refreshHubPage(router), [router]);

  // ── The lists ──
  const adjusted = useCallback((withSeen: boolean): TypeHubModel => {
    let bench = model.bench.filter((b) => !hidden.has(b.idea.id)).map((b) => (b.idea.id in pinOverride ? { ...b, pinned: pinOverride[b.idea.id] } : b));
    const newPins = bench.filter((b) => pinOverride[b.idea.id] === true);
    if (newPins.length) bench = [...newPins, ...bench.filter((b) => pinOverride[b.idea.id] !== true)];
    return { ...model, bench: withSeen ? applySeen(bench, seen) : bench };
  }, [model, hidden, pinOverride, seen]);
  const serverRows = useMemo(() => poolIdeas(adjusted(false), now, source ?? undefined), [adjusted, now, source]);
  const viewModel = useMemo(() => adjusted(true), [adjusted]);
  const rows = useMemo(() => (seen ? poolIdeas(viewModel, now, source ?? undefined) : serverRows), [seen, viewModel, now, source, serverRows]);
  const madeRows = useMemo(() => poolMade(model, now, source ?? undefined), [model, now, source]);
  const board = useMemo(() => poolBoard(viewModel, startDay, 3, { ...(source ?? {}), now }), [viewModel, startDay, source, now]);
  const slotsPerDay = useMemo(() => poolSlotsPerDay(model, source ?? undefined), [model, source]);
  const runway = poolRunway(rows.length, slotsPerDay);
  // Full: the real open count, not the list (which is capped at 30 for every type). Explainers: the whole pool
  // (model.poolOpen, uncapped), less what was just archived here. Stories: per series; its list holds every open idea of
  // a series up to the cap, so a series showing 30 is at the cap. Seed picks its series in the form, so with no series
  // picked it is off only when every series is full.
  const seriesFull = (name: string) => rows.filter((r) => r.idea.group === name).length >= POOL_CAP;
  const full = !TRIMMED.has(vertical) ? false
    : isStoryVertical(vertical) ? (group ? seriesFull(group) : model.groups.length > 0 && model.groups.every(seriesFull))
      : model.poolOpen - hidden.size >= POOL_CAP;

  const stateOf = (row: PoolIdeaRow): PoolRowState => {
    if (making.has(row.idea.id)) return 'making';
    const run = ownRun(row.idea, live);
    if (run && (run.state === 'queued' || run.state === 'running')) return 'making';
    return row.state;
  };
  // AI Events: an event pinned with the retired Pin button (ai_events.pool, `idea.hold`) is still honored by the night,
  // so it shows as pinned and Unpin clears it too.
  const oldPin = (idea: HubIdea) => vertical === 'ai_events' && idea.hold === 'pinned';
  const pinnedOf = (row: PoolIdeaRow) => pinOverride[row.idea.id] ?? (row.pinned || oldPin(row.idea));
  // A row the live feed shows as Making says "making now" in its Up next slot, like its badge.
  const liveRow = (row: PoolIdeaRow): PoolIdeaRow => {
    if (!row.slot || row.state === 'making' || stateOf(row) !== 'making' || row.slot.makes === 'making now') return row;
    const slot = { ...row.slot, makes: 'making now' };
    return { ...row, slot, meta: [`${slot.label} · ${slot.makes}`, ...row.meta.slice(1)] };
  };

  // Groups (Stories' series, AI Events' cities): a filter over the same list.
  const groupTabs = model.groups.map((name) => ({ name, n: rows.filter((r) => r.idea.group === name).length }));
  const shown = group ? rows.filter((r) => r.idea.group === group) : rows;
  const shownServer = group ? serverRows.filter((r) => r.idea.group === group) : serverRows;

  // PoolQueue's rows follow the server's order only, so a drop is not reset by its own echo.
  const queueKey = shownServer.map((r) => `${r.idea.id}${r.pinned ? '*' : ''}${model.content[r.idea.id] ? '+' : ''}`).join();
  useEffect(() => setSeen(null), [queueKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the server's order changes
  const queueRows = useMemo(() => shownServer.map((r) => ({ id: r.idea.id, pinned: r.pinned, hasContent: model.content[r.idea.id] != null, title: r.idea.title })), [queueKey]);
  const onOrder = useCallback((ids: string[]) => setSeen((prev) => (prev && prev.join() === ids.join() ? prev : ids)), []);
  const rowById = new Map(rows.map((r) => [r.idea.id, r]));
  const upShown = shown.filter((r) => r.upNext);
  const laterId = upShown.length ? shown.find((r) => !r.upNext)?.idea.id ?? null : null;
  const upDays = [...new Set(upShown.flatMap((r) => (r.slot ? [r.slot.label.split(' ')[0]!] : [])))];

  // ── Moves ──
  const commitArchive = useCallback((id: string) => {
    postQueue({ vertical, action: 'archive', ideaId: id })
      .then(() => refresh())
      .catch((e: unknown) => {
        setHidden((prev) => { const next = new Set(prev); next.delete(id); return next; });
        note(`Could not archive: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [vertical, refresh, note]);
  const flushPending = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    commitArchive(p.id);
  }, [commitArchive]);
  useEffect(() => {
    const onHide = () => flushPending();
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); flushPending(); };
  }, [flushPending]);

  function archive(row: { idea: HubIdea }) {
    flushPending();
    const id = row.idea.id;
    setOpen(null);
    setConfirming(null);
    setLeaving(id);
    setTimeout(() => {
      setLeaving(null);
      setHidden((prev) => new Set(prev).add(id));
      setToast({ kind: 'archive', id, title: row.idea.title });
      pending.current = {
        id,
        timer: setTimeout(() => {
          pending.current = null;
          setToast((t) => (t?.kind === 'archive' && t.id === id ? null : t));
          commitArchive(id);
        }, UNDO_MS),
      };
    }, LEAVE_MS);
  }
  function undo() {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    setHidden((prev) => { const next = new Set(prev); next.delete(p.id); return next; });
    setToast(null);
    requestAnimationFrame(() => flash(p.id));
  }

  async function pin(row: PoolIdeaRow) {
    const id = row.idea.id;
    const next = !pinnedOf(row);
    setPinOverride((prev) => ({ ...prev, [id]: next }));
    if (next) flash(id, true);
    try {
      await postQueue({ vertical, action: next ? 'pin' : 'unpin', ideaId: id });
      if (!next && oldPin(row.idea)) await clearOldHold(id);
      if (next && askWith && model.content[id] == null && moves.make) setAsk({ id, title: row.idea.title, reason: 'top', costUsd: null });
      refresh();
    } catch (e) {
      setPinOverride((prev) => { const copy = { ...prev }; delete copy[id]; return copy; });
      note(`Could not ${next ? 'pin' : 'unpin'}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function makeIt(row: { idea: HubIdea }) {
    if (!make) return;
    const id = row.idea.id;
    setBusy(id);
    try {
      const out = await make(id, false);
      if (out.ok) {
        setConfirming(null);
        setMaking((prev) => new Set(prev).add(id));
        flash(id);
        refresh();
      } else if (out.ask === 'over_cap') {
        setConfirming(null);
        setAsk({ id, title: row.idea.title, reason: 'over_cap', costUsd: out.costUsd });
      } else {
        note(out.message);
      }
    } finally {
      setBusy(null);
    }
  }

  const costUsd = data?.costPerPostMicros != null ? data.costPerPostMicros / 1e6 : null;
  const costText = data?.costPerPostMicros != null
    ? `Make this now? It spends about ${formatUsd(data.costPerPostMicros)}; the day’s spend cap still applies.`
    : `Make this now? It makes live model calls for this one ${noun.one}; the day’s spend cap still applies.`;

  // ── Panels ──
  const ticking = open != null && live.some((item) => item.state !== 'failed');
  const tick = useTicking(ticking);
  const allCards = useMemo(() => {
    const map = new Map<string, TypeCard>();
    const add = (c: TypeCard | null | undefined) => { if (c && !map.has(c.post.id)) map.set(c.post.id, c); };
    for (const c of Object.values(cards)) add(c);
    for (const d of model.days) for (const c of d.cards) add(c);
    for (const b of model.bench) add(b.card);
    for (const c of Object.values(model.content)) add(c);
    for (const list of Object.values(model.versions)) for (const c of list) add(c);
    return map;
  }, [cards, model]);
  const cardRecord = useMemo(() => Object.fromEntries(allCards), [allCards]);
  const ideaOf = (post: HubPost): HubIdea | null => {
    const ref = post.idea?.id;
    if (!ref) return null;
    return model.bench.find((b) => b.idea.id === ref || b.idea.id.endsWith(`:${ref}`))?.idea ?? null;
  };

  const openedPost = open?.kind === 'post' ? allCards.get(open.id) ?? null : null;
  const versions = openedPost?.post.idea ? model.versions[openedPost.post.idea.id] ?? [] : [];
  const shownPost = (versionId ? versions.find((v) => v.post.id === versionId) : null) ?? openedPost;
  const openedRow = open?.kind === 'idea' ? rowById.get(open.id) ?? null : null;
  const openedIdeaRow = openedRow ? liveRow(openedRow) : null;
  const openedIdea = open?.kind === 'idea' ? openedIdeaRow?.idea ?? model.bench.find((b) => b.idea.id === open.id)?.idea ?? null : null;
  const closePanel = useCallback(() => { setOpen(null); setVersionId(null); }, []);

  function makeFromPanel(id: string) {
    setOpen(null);
    setTab('ideas');
    setGroup(null);
    setConfirming(id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.pl-row[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }

  // ── Words ──
  const many = noun.many;
  const sum = `${rows.length} ${rows.length === 1 ? noun.one : many} waiting · ${madeRows.length} made in the last 30 days`;
  const ideasNote = wholeList
    ? `${cap(many)} in line for the next post, ${order === 'rank' ? 'best rank' : 'best'} first. The top of the list goes into it. Hold and drag ${article(noun.one)} ${noun.one} to move it; drop it above the pins to pin it.`
    : `${cap(many)} waiting to be made, best first. The top three fill the next open slots. ${config.dragNeedsGroup ? `Pick a ${config.groupNoun === 'cities' ? 'city' : 'series'}, then hold` : 'Hold'} and drag ${article(noun.one)} ${noun.one} to move it; drop it above the pins to pin it.`;
  const madeNote = 'Posts made from this pool. Each one is archived 30 days after it was made; nothing is deleted.';
  const dragOn = moves.drag && (!config.dragNeedsGroup || group != null);
  const boardFrom = addDays(model.today, -BOARD_BACK_DAYS);
  const boardLast = addDays(model.today, BOARD_AHEAD_DAYS - 2);

  return (
    <div className="pl">
      <p className="pl-sum">{sum}</p>
      {/* Last Few Days and AI Events build each post from the whole list: a days-of-topics count means nothing there. */}
      {wholeList ? null : slotsPerDay > 0 ? (
        <div className="pl-runway">
          {rows.length ? (
            <>
              <span className="pl-runway__track"><span className="pl-runway__fill" style={{ width: `${Math.min(100, Math.round((runway / 7) * 100))}%` }} /></span>
              <span>Enough {many} for <b>{runway} {runway === 1 ? 'day' : 'days'}</b> of posts</span>
            </>
          ) : <span>No {many} left for upcoming posts</span>}
        </div>
      ) : (
        // No posting slots this week: say so, so an empty board and Up next read as the schedule, not a broken pool.
        <div className="pl-runway"><span>No posting slots this week. <a href={`/social/calendar?view=week&type=${model.vertical}`}>Set them in Calendar</a></span></div>
      )}
      {model.poolWeek ? (
        <p className="pl-week">
          Week of {model.poolWeek.label}. {model.poolWeek.editable ? 'Pin or archive events, then Rebuild post.' : 'This week’s post is out; next week’s pool fills Sunday at 12:00 PM.'}
        </p>
      ) : null}
      {/* Keyed: a progress strip handed down from a server page can arrive unvalidated, and React then asks for a key. */}
      {progress ? <Fragment key="progress">{progress}</Fragment> : null}

      <PoolBoard
        days={board}
        canBack={startDay > boardFrom}
        canAhead={startDay < boardLast}
        onBack={() => setStartDay((d) => addDays(d, -1))}
        onAhead={() => setStartDay((d) => addDays(d, 1))}
        cards={cardRecord}
        noun={noun.one}
        wholeList={wholeList}
        flashes={flashes}
        onOpenPost={(id) => { setVersionId(null); setOpen({ kind: 'post', id }); }}
        onOpenIdea={(id) => setOpen({ kind: 'idea', id })}
      />

      <PoolTabs
        tab={tab}
        onTab={setTab}
        ideas={rows.length}
        made={madeRows.length}
        settings={settings != null}
        seed={!readOnly && seed ? seed({ disabled: full }) : undefined}
        seedOff={full ? `The pool holds ${POOL_CAP} ${many}, counting ones already made. Archive one to seed another.` : null}
      />

      {tab === 'settings' ? null : tab === 'ideas' ? (
        <>
          <p className="pl-note">{ideasNote}</p>
          {groupTabs.length ? (
            <div className="pl-groups" role="group" aria-label={config.groupNoun === 'cities' ? 'Cities' : 'Series'}>
              <button type="button" className="pl-pill" aria-pressed={group == null} onClick={() => setGroup(null)}>All {config.groupNoun} <span className="pl-pill__n">{rows.length}</span></button>
              {groupTabs.map((t) => (
                <button key={t.name} type="button" className="pl-pill" aria-pressed={group === t.name} onClick={() => setGroup(t.name)}>{t.name} <span className="pl-pill__n">{t.n}</span></button>
              ))}
            </div>
          ) : null}
        </>
      ) : <p className="pl-note">{madeNote}</p>}

      {tab === 'settings' ? (
        <div id="pl-list" role="tabpanel" aria-labelledby="pl-tab-settings">{settings}</div>
      ) : (
        <div className="pl-panel" id="pl-list" role="tabpanel" aria-labelledby={`pl-tab-${tab}`} aria-live="polite">
          {tab === 'made' ? (
            madeRows.length ? (
              <ol className="pl-list">
                {madeRows.map((row) => (
                  <MadeRow key={row.post.id} row={row} card={allCards.get(row.post.id) ?? null} flash={flashes[row.post.id]} onOpen={() => { setVersionId(null); setOpen({ kind: 'post', id: row.post.id }); }} />
                ))}
              </ol>
            ) : (
              <div className="pl-empty"><h3>Nothing made in the last 30 days</h3><p>Made posts show here for 30 days, then they are archived.</p></div>
            )
          ) : shown.length === 0 ? (
            <div className="pl-empty">
              <h3>No {many} waiting{group ? ` in ${group}` : ''}</h3>
              <p>{vertical === 'ai_events' ? 'The pool is empty until the Sunday run ranks the coming week.' : config.seedable ? `The nights have nothing to make from this pool. Seed ${article(noun.one)} ${noun.one}, or the next refill adds new ones.` : 'The nights have nothing to make from this pool until the next refill adds new ones.'}</p>
              {!readOnly && seed && !group ? seed({ disabled: full }) : null}
            </div>
          ) : (
            <>
              {upShown.length ? (
                <div className="pl-band pl-band--up"><i className="pl-band__live" aria-hidden="true" />Up next <span>{wholeList ? 'First in line for the next post' : upDays.length ? `Fills the open slots on ${upDays.join(', ')}` : 'No open slot in the next three weeks takes them yet'}</span></div>
              ) : null}
              <PoolQueue
                vertical={vertical}
                rows={queueRows}
                onOrder={onOrder}
                topN={model.slots.length}
                generate={moves.make ? askWith : undefined}
                enabled={dragOn}
                classes={{ list: 'pl-list', zone: 'pl-pinzone', grip: 'pl-grip' }}
                renderRow={(id, handle) => {
                  const found = rowById.get(id);
                  if (!found) return null;
                  const row = liveRow(found);
                  const later = id === laterId ? <div className="pl-band pl-band--later">Later <span>{shown.length - upShown.length} {shown.length - upShown.length === 1 ? noun.one : many}</span></div> : null;
                  return (
                    <IdeaRow
                      row={row}
                      state={stateOf(row)}
                      pinned={pinnedOf(row)}
                      handle={handle}
                      moves={moves}
                      readOnly={readOnly}
                      confirming={confirming === id}
                      costText={costText}
                      busy={busy === id}
                      flash={flashes[id]}
                      pop={pops[id] === true}
                      leaving={leaving === id}
                      laterBand={later}
                      onOpen={() => setOpen({ kind: 'idea', id })}
                      onPin={() => void pin(row)}
                      onArchive={() => archive(row)}
                      onMake={() => setConfirming((c) => (c === id ? null : id))}
                      onMakeYes={() => void makeIt(row)}
                      onMakeNo={() => setConfirming(null)}
                    />
                  );
                }}
              />
            </>
          )}
        </div>
      )}

      {openedIdea ? (
        <IdeaPanel
          idea={openedIdea}
          state={openedIdeaRow ? stateOf(openedIdeaRow) : 'idea'}
          run={panelRun(openedIdea, live)}
          now={tick}
          details={[
            ...(openedIdeaRow ? [['Where from', openedIdeaRow.source] as [string, string]] : []),
            ...(openedIdeaRow?.addedDaysAgo != null ? [['Added', openedIdeaRow.addedDaysAgo === 0 ? 'Today' : `${openedIdeaRow.addedDaysAgo} ${openedIdeaRow.addedDaysAgo === 1 ? 'day' : 'days'} ago`] as [string, string]] : []),
            ...(openedIdeaRow?.slot ? [['Fills', `${openedIdeaRow.slot.label} · ${openedIdeaRow.slot.makes}`] as [string, string]] : []),
            ...(openedIdeaRow ? [['Place', `${openedIdeaRow.position} of ${rows.length}`] as [string, string]] : []),
            ...(openedIdeaRow?.number ? [[order === 'rank' ? 'Rank' : 'Score', openedIdeaRow.number] as [string, string]] : []),
            ...(openedIdea.group ? [[config.groupNoun === 'cities' ? 'City' : 'Series', openedIdea.group] as [string, string]] : []),
          ]}
          pinned={openedIdeaRow ? pinnedOf(openedIdeaRow) : false}
          moves={openedIdeaRow ? moves : { pin: false, archive: false, make: false }}
          readOnly={readOnly}
          extras={ideaExtras?.(openedIdea)}
          onClose={closePanel}
          onMake={() => makeFromPanel(openedIdea.id)}
          onPin={() => { if (openedIdeaRow) void pin(openedIdeaRow); }}
          onArchive={() => { if (openedIdeaRow) archive(openedIdeaRow); }}
        />
      ) : null}
      {shownPost ? (
        <PostPanel
          card={shownPost}
          versions={versions}
          onVersion={setVersionId}
          state={madeRowState(shownPost.post, now)}
          meta={madeRows.find((m) => m.post.id === shownPost.post.id)?.meta.join(' · ') ?? null}
          idea={ideaOf(shownPost.post)}
          run={runForPost(shownPost.post, model.bench.map((b) => b.idea), live)}
          now={tick}
          fullPostBase={fullPostBase}
          fromPath={fromPath}
          readOnly={readOnly}
          extras={postExtras?.(shownPost.post)}
          onClose={closePanel}
        />
      ) : null}

      {toast ? (
        <div className={`pl-toast${toast.kind === 'note' ? ' pl-toast--note' : ''}`} role="status">
          {toast.kind === 'archive' ? (
            <>
              <span className="pl-toast__msg"><span className="pl-toast__tick"><Check className="pl-i" aria-hidden="true" /></span>Archived “{toast.title}”</span>
              <button type="button" onClick={undo}>Undo</button>
            </>
          ) : (
            <>
              <span className="pl-toast__msg">{toast.text}</span>
              <button type="button" onClick={() => setToast(null)}>Close</button>
            </>
          )}
        </div>
      ) : null}
      {ask && askWith ? (
        <GenerateConfirm
          generate={askWith}
          ideaId={ask.id}
          title={ask.title}
          reason={ask.reason}
          costUsd={ask.costUsd ?? costUsd}
          onDone={() => { setAsk(null); refresh(); }}
        />
      ) : null}
    </div>
  );
}
