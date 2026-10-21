import { ChevronLeft, ChevronRight, Hand, TriangleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';

import { Delta } from '@/components/social-hub/analytics/KpiStrip';
import { DaySheet } from '@/components/social-hub/calendar/DaySheet';
import { MonthGrid } from '@/components/social-hub/calendar/MonthGrid';
import { SourceSwitch, WeekBoard, type ReadyItem } from '@/components/social-hub/calendar/WeekBoard';
import type { SlimPost } from '@/components/social-hub/calendar/SlotCard';
import { thumbOf } from '@/components/social-hub/ui/Thumb';
import { TypeToggles } from '@/components/social-hub/calendar/CalendarControls';
import { LineupItem } from '@/components/social-hub/content/LineupItem';
import { ActionBar } from '@/components/social-hub/house/ActionBar';
import { PostLink } from '@/components/social-hub/nav/PostLink';
import { Thumb } from '@/components/social-hub/ui/Thumb';
import { DataNotes } from '@/components/social-hub/DataNotes';
import { HubLink } from '@/components/social-hub/nav/HubNav';
import { Menu } from '@/components/social-hub/ui/Menu';
import { PageHead } from '@/components/social-hub/ui/PageHead';
import { TypeMark, typeStyle } from '@/components/social-hub/ui/marks';
import type { HubDataset } from '@/lib/social-hub/dataset';
import { contentRefs } from '@/lib/social-hub/house';
import { isStorySeries, type ResolvedSlot, type SlotsByDate, type SlotSource } from '@/lib/social-hub/slots/types';
import { actionEnabled, SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { withParams, type HubParams } from '@/lib/social-hub/links';
import { metricSpec } from '@/lib/social-hub/metrics';
import { addDays, dayLabel, isDayKey, monthLabel, monthOf, nyDateOf, shiftMonth, WEEKDAY_SHORT } from '@/lib/social-hub/time';
import { isVertical, verticalInfo, VERTICAL_IDS } from '@/lib/social-hub/verticals';
import { daySlots, monthModel, totalLabel, type DayCell, type DaySlot } from '@/lib/social-hub/views/calendar';
import { displayName, plural, shortDate, whenInline } from '@/lib/social-hub/views/format';
import { offerer } from '@/lib/social-hub/views/offer';
import { minuteLabel, windowRange } from '@/lib/social-hub/views/plan';
import { mondayOf, weekLabel, type SwitchFacts, type WeekDayInput } from '@/lib/social-hub/views/week';
import type { HubPost, MetricKey, Vertical } from '@/lib/social-hub/types';
import { needsGroups } from '@/lib/social-hub/views/today';

const METRICS: MetricKey[] = ['views', 'reach', 'shares', 'totalInteractions'];

const MARK_LABEL = { posted: 'posted', scheduled: 'scheduled', failed: 'failed', missed: 'didn’t post', open: 'open slot' } as const;

/** The week view's input (the page loads it; the preview builds it from the seed). */
export type CalendarWeek = {
  mode: 'week' | 'template';
  monday: string;
  days: WeekDayInput[];
  source: SlotSource;
  /** No edits and no switch (a read that can't be trusted to write back). */
  readOnly?: boolean;
  /** The preview: the board edits on screen only and sends nothing. */
  sandbox?: boolean;
  /** Each weekday's Standard week slots (0 = Sunday), for "Edited" and Reset day. */
  standard: Record<number, ResolvedSlot[]>;
  /** The daily caps (readCaps; DEFAULT_CAPS on the preview). */
  caps: Record<Vertical, number>;
  /** What switching on changes, for the confirm. */
  switchFacts: SwitchFacts;
};

/** Calendar (BRIEFS.md §2): the week's slots to edit (spec §3), or the month's shape, gaps ahead, and a day panel to act from. */
export function CalendarScreen({ dataset, base, params, now, week, weekFailed = false }: { dataset: HubDataset; base: string; params: HubParams; now: Date; week?: CalendarWeek | null; /** The week was asked for but its slots didn't load: say so above the month. */ weekFailed?: boolean }) {
  if (week && calendarView(params) === 'week') return <WeekScreen dataset={dataset} base={base} params={params} now={now} week={week} />;
  return <MonthScreen dataset={dataset} base={base} params={params} now={now} weekFailed={weekFailed} />;
}

/**
 * Week is the default; Month when asked for, or when an older link names a
 * month or a day (breadcrumbs, legacy routes) without a view.
 */
export function calendarView(params: HubParams): 'week' | 'month' {
  if (!SOCIAL_HUB_FLAGS.views.calendarWeek || params.view === 'month') return 'month';
  if (params.view === 'week') return 'week';
  return params.month || params.day ? 'month' : 'week';
}

/** Week | Month, as links that keep nothing else (each view has its own params). */
function ViewToggle({ path, view }: { path: string; view: 'week' | 'month' }) {
  if (!SOCIAL_HUB_FLAGS.views.calendarWeek) return null;
  return (
    <div className="sh-pills" role="group" aria-label="View">
      <HubLink className="sh-pill" href={path} aria-current={view === 'week' ? 'page' : undefined} history="replace">Week</HubLink>
      <HubLink className="sh-pill" href={`${path}?view=month`} aria-current={view === 'month' ? 'page' : undefined} history="replace">Month</HubLink>
    </div>
  );
}

/** Hold-the-slot statuses the board shows on a card (plus a placed post still waiting as ready). */
const ON_BOARD = new Set(['scheduled', 'publishing', 'published', 'ready']);

/** A post as the board needs it: small enough to send to the client. */
function slim(p: HubPost): SlimPost {
  const refs = Object.fromEntries(Object.entries(contentRefs(p)).filter((e): e is [string, string] => typeof e[1] === 'string'));
  return { id: p.id, vertical: p.vertical, nyDate: p.nyDate, slot: p.slot, status: p.status, approval: { required: p.approval.required, approvedAt: p.approval.approvedAt }, name: displayName(p), refs, thumb: thumbOf(p.media).src };
}

/** Ready to place (decision 16): made, approved or not, with no slot (the Content page's "Made, waiting for a slot"). */
function readyItems(posts: readonly HubPost[], now: Date): ReadyItem[] {
  const unplaced = needsGroups(posts, now).find((g) => g.id === 'unplaced')?.posts ?? [];
  return unplaced.map((p) => {
    const f = p.factorValues.series;
    const key = f && f.kind === 'category' ? f.key : null;
    return { ...slim(p), series: p.vertical === 'stories' && isStorySeries(key) ? key : null, made: p.generatedAt ? `Made ${shortDate(p.generatedAt)}` : 'Made' };
  }).filter((r) => r.vertical !== 'stories' || r.series !== null);
}

function WeekScreen({ dataset, base, params, now, week }: { dataset: HubDataset; base: string; params: HubParams; now: Date; week: CalendarWeek }) {
  const path = `${base}/calendar`;
  const template = week.mode === 'template';
  const thisMonday = mondayOf(nyDateOf(now)!);
  const keep: HubParams = { scope: params.scope, week: params.week, type: params.type };
  const href = (changes: Record<string, string | null>) => withParams(path, '', keep, changes);
  const dim = isVertical(params.type) ? params.type : null;
  const legacy = week.source === 'legacy';
  const editable = actionEnabled('editSlots') && !week.readOnly && !legacy;
  const dates = new Set(week.days.map((d) => d.nyDate).filter(Boolean));
  const posts = template ? [] : dataset.posts.filter((p) => p.nyDate && dates.has(p.nyDate) && p.slot && ON_BOARD.has(p.status)).map(slim);
  const ready = template || !editable || !actionEnabled('reschedule') ? [] : readyItems(dataset.posts, now);
  return (
    <>
      <PageHead
        title={template ? 'Standard week' : weekLabel(week.monday)}
        actions={
          <>
            <ViewToggle path={path} view="week" />
            <div className="sh-pills" role="group" aria-label="Show">
              <HubLink className="sh-pill" href={href({ scope: 'template', week: null })} aria-current={template ? 'page' : undefined} history="replace">Standard week</HubLink>
              <HubLink className="sh-pill" href={href({ scope: null })} aria-current={template ? undefined : 'page'} history="replace">This week</HubLink>
            </div>
            {template ? null : (
              <div className="sh-pills" role="group" aria-label="Week">
                <HubLink className="sh-btn sh-btn--icon" href={href({ week: addDays(week.monday, -7) })} aria-label="Previous week" history="replace"><ChevronLeft size={16} aria-hidden="true" /></HubLink>
                <HubLink className="sh-btn" href={href({ week: null })} aria-current={week.monday === thisMonday ? 'page' : undefined} history="replace">Today</HubLink>
                <HubLink className="sh-btn sh-btn--icon" href={href({ week: addDays(week.monday, 7) })} aria-label="Next week" history="replace"><ChevronRight size={16} aria-hidden="true" /></HubLink>
              </div>
            )}
          </>
        }
      />
      <DataNotes dataset={dataset} />
      {actionEnabled('editSlots') ? <SourceSwitch source={week.source} readOnly={week.readOnly || week.sandbox} facts={week.switchFacts} /> : null}
      {dim ? (
        <p className="sh-subtle sh-week__focus">
          Showing {verticalInfo(dim).label} first. <HubLink className="sh-link" href={href({ type: null })} history="replace">Show every type</HubLink>
        </p>
      ) : null}
      {template ? <p className="sh-subtle sh-week__focus">The standard week repeats every week. A change on This week shows on that date only.</p> : null}
      <WeekBoard
        mode={week.mode}
        monday={week.monday}
        canUnschedule={actionEnabled('unschedule')}
        days={week.days}
        standard={week.standard}
        caps={week.caps}
        posts={posts}
        ready={ready}
        now={now.toISOString()}
        editable={editable}
        sandbox={week.sandbox === true}
        dim={dim}
      />
    </>
  );
}

function MonthScreen({ dataset, base, params, now, weekFailed = false }: { dataset: HubDataset; base: string; params: HubParams; now: Date; weekFailed?: boolean }) {
  const path = `${base}/calendar`;
  const today = nyDateOf(now)!;
  const day = isDayKey(params.day) ? params.day : null;
  const month = monthOf(params.month ?? day?.slice(0, 7), now);
  const metric: MetricKey = METRICS.includes(params.metric as MetricKey) ? (params.metric as MetricKey) : 'views';
  const shown: Vertical[] = params.types ? params.types.split(',').filter(isVertical) : [...VERTICAL_IDS];
  const types = new Set(shown.length ? shown : VERTICAL_IDS);
  const o = offerer(dataset, now);
  const m = monthModel(dataset.posts, month, now, metric, types, (p) => o.offer(p).state.id === 'needs_you', dataset.dayQuotas?.lfdDays ?? [], dataset.dayQuotas?.slots ?? null);
  // Month links say view=month, so Today (no month) stays on the month instead of opening the week.
  const keep: HubParams = { view: SOCIAL_HUB_FLAGS.views.calendarWeek ? 'month' : undefined, month: params.month, types: params.types, metric: params.metric };
  const href = (changes: Record<string, string | null>) => withParams(path, '', keep, changes);
  const metricLabel = metricSpec(metric).label.toLowerCase();

  // A past day's sheet carries its total, and says when it was the month's best.
  const daySub = (d: string) => {
    if (d > today) return 'What’s planned';
    const cell = m.weeks.flat().find((c) => c.day === d);
    const total = cell?.total != null ? `${totalLabel(cell.total, metric)} ${metricLabel}` : null;
    const best = m.summary.best?.day === d ? 'best day this month' : null;
    return [d === today ? 'Today' : 'What went out', total, best].filter(Boolean).join(' · ');
  };

  return (
    <>
      <PageHead
        title={monthLabel(month)}
        actions={
          <>
          <ViewToggle path={path} view="month" />
          <div className="sh-pills" role="group" aria-label="Month">
            <HubLink className="sh-btn sh-btn--icon" href={href({ month: shiftMonth(month, -1), day: null })} aria-label="Previous month" history="replace"><ChevronLeft size={16} aria-hidden="true" /></HubLink>
            <HubLink className="sh-btn" href={href({ month: null, day: null })} aria-current={month === today.slice(0, 7) ? 'page' : undefined} history="replace">Today</HubLink>
            <HubLink className="sh-btn sh-btn--icon" href={href({ month: shiftMonth(month, 1), day: null })} aria-label="Next month" history="replace"><ChevronRight size={16} aria-hidden="true" /></HubLink>
          </div>
          </>
        }
      />
      {weekFailed ? <p className="sh-note sh-note--failed" role="status">The week couldn’t load, so this is the month. Try again in a moment.</p> : null}
      <DataNotes dataset={dataset} />

      <dl className="sh-summary" aria-label={`${monthLabel(month)} at a glance`}>
        <div>
          <dt>Published</dt>
          <dd>{m.summary.published.toLocaleString('en-US')}</dd>
          <dd className="sh-summary__vs"><Delta value={m.summary.published} previous={m.summary.previous.published || null} higherIsBetter suffix={`vs ${m.summary.previous.label}`} /></dd>
        </div>
        <div>
          <dt>Total {metricLabel}</dt>
          <dd>{totalLabel(m.summary.total, metric) || '—'}</dd>
          <dd className="sh-summary__vs"><Delta value={m.summary.total} previous={m.summary.previous.total} higherIsBetter={metricSpec(metric).higherIsBetter} suffix={`vs ${m.summary.previous.label}`} /></dd>
        </div>
        <div><dt>Best day</dt><dd>{m.summary.best ? <>{shortDate(m.summary.best.day)} <span className="sh-muted">· {totalLabel(m.summary.best.total, metric)}</span></> : '—'}</dd></div>
        <div><dt>Failed</dt><dd className={m.summary.failed ? 'sh-failed-text' : undefined}>{m.summary.failed}</dd></div>
        <div><dt>Open, today and tomorrow</dt><dd>{m.summary.openAhead}</dd></div>
      </dl>

      <div className="sh-toolbar">
        <TypeToggles shown={shown.length === VERTICAL_IDS.length ? [...VERTICAL_IDS] : shown} />
        <Menu label="Day totals" value={metric} options={METRICS.map((k) => ({ value: k, label: metricSpec(k).label, href: href({ metric: k === 'views' ? null : k }) }))} />
      </div>

      <MonthGrid label={monthLabel(month)}>
        <div className="sh-month__head" role="row">
          {WEEKDAY_SHORT.map((d) => <span key={d} role="columnheader">{d[0]}<span className="sh-month__wd-rest">{d.slice(1)}</span></span>)}
        </div>
        {m.weeks.map((week, i) => (
          <div key={i} className="sh-month__week" role="row">
            {week.map((cell) => <Cell key={cell.day} cell={cell} href={href({ day: cell.day, month: cell.day.slice(0, 7) === today.slice(0, 7) ? null : cell.day.slice(0, 7) })} metric={metric} />)}
          </div>
        ))}
      </MonthGrid>
      <div className="sh-month__key">
        <ul className="sh-key" aria-label="Key">
          <li><span className="sh-mark" aria-hidden="true" />posted</li>
          <li><span className="sh-mark sh-mark--scheduled" aria-hidden="true" />scheduled</li>
          <li><span className="sh-mark sh-mark--open" aria-hidden="true" />open slot (today and tomorrow)</li>
          <li><span className="sh-mark sh-mark--missed" aria-hidden="true" />didn’t post</li>
          <li><span className="sh-mark sh-mark--failed" aria-hidden="true" />failed</li>
          <li><span className="sh-cell__needs" aria-hidden="true"><Hand size={11} />1</span>needs you</li>
          <li><span className="sh-key__heat" aria-hidden="true" />darker day, more {metricLabel}</li>
        </ul>
        <p className="sh-subtle">Dots run in type order: Text on Screen, Explainer Reels, Carousels, IG Stories. Day totals add up {metricLabel} across what posted that day.</p>
      </div>

      {day ? (
        <DaySheet
          title={dayLabel(day)}
          sub={daySub(day)}
          prevHref={href({ day: addDays(day, -1), month: null })}
          nextHref={href({ day: addDays(day, 1), month: null })}
        >
          <DayList posts={dataset.posts} day={day} types={types} now={now} o={o} base={base} carouselOff={dataset.dayQuotas?.lfdDays ?? []} slots={dataset.dayQuotas?.slots ?? null} />
        </DaySheet>
      ) : null}
    </>
  );
}

function Cell({ cell, href, metric }: { cell: DayCell; href: string; metric: MetricKey }) {
  const style = cell.rank != null ? ({ '--sh-heat': (0.03 + cell.rank * 0.07).toFixed(3) } as CSSProperties) : undefined;
  const failed = cell.marks.some((mk) => mk.kind === 'failed');
  const described = [
    `${cell.posts} ${cell.posts === 1 ? 'post' : 'posts'}`,
    cell.total != null ? `${totalLabel(cell.total, metric)} ${metricSpec(metric).label.toLowerCase()}` : null,
    cell.needs ? `${cell.needs} need you` : null,
    failed ? 'something failed' : null,
    cell.marks.filter((mk) => mk.kind === 'open').length ? `${cell.marks.filter((mk) => mk.kind === 'open').length} open slots` : null,
  ].filter(Boolean).join(', ');
  return (
    <HubLink
      href={href}
      role="gridcell"
      data-day={cell.day}
      data-today={cell.isToday ? 'true' : undefined}
      data-in-month={cell.inMonth ? 'true' : undefined}
      className={`sh-cell${cell.inMonth ? '' : ' sh-cell--out'}${cell.isToday ? ' sh-cell--today' : ''}${cell.rank != null ? ' sh-cell--heat' : ''}`}
      style={style}
      aria-label={`${dayLabel(cell.day)}: ${described}`}
    >
      <span className="sh-cell__top">
        <span className="sh-cell__num">{Number(cell.day.slice(8))}</span>
        {cell.needs ? <span className="sh-cell__needs" title={`${cell.needs} need you`}><Hand size={11} aria-hidden="true" />{cell.needs}</span> : null}
        {failed ? <TriangleAlert size={13} className="sh-cell__failed" aria-hidden="true" /> : null}
      </span>
      {cell.total != null ? <span className="sh-cell__total">{totalLabel(cell.total, metric)}</span> : null}
      {cell.marks.length ? (
        <span className="sh-cell__marks" aria-hidden="true">
          {cell.marks.map((mk, i) => <span key={i} className={`sh-mark sh-mark--${mk.kind}`} style={typeStyle(mk.vertical)} title={`${mk.vertical} ${MARK_LABEL[mk.kind]}`} />)}
        </span>
      ) : null}
    </HubLink>
  );
}

function DayList({ posts, day, types, now, o, base, carouselOff, slots: calendarSlots }: { posts: HubDataset['posts']; day: string; types: ReadonlySet<Vertical>; now: Date; o: ReturnType<typeof offerer>; base: string; carouselOff: readonly number[]; slots: SlotsByDate | null }) {
  const slots = daySlots(posts, day, types, now, carouselOff, calendarSlots);
  if (slots.length === 0) return <div className="sh-empty"><strong>Nothing on this day</strong>No content was placed and no slots are open.</div>;
  return (
    <ul className="sh-list">
      {slots.map((s) => s.kind === 'post' ? (
        <LineupItem key={s.post.id} post={s.post} o={o} past={(s.at ?? '') < now.toISOString()} />
      ) : (
        <li key={`${s.vertical}-${s.window.id}`} className="sh-item sh-item--open">
          <span className="sh-item__time">{minuteLabel(s.window.startMinute)}</span>
          <span className="sh-thumb sh-thumb--open" style={typeStyle(s.vertical)} aria-hidden="true" />
          <div className="sh-item__main">
            <div className="sh-item__meta"><TypeMark vertical={s.vertical} /><span className="sh-state">Open slot</span></div>
            <span className="sh-item__name sh-muted">{s.window.label} · {windowRange(s.window)}</span>
          </div>
          <ReadyFor posts={posts} slot={s} o={o} poolHref={`${base}/content/pools/${s.vertical}`} />
        </li>
      ))}
    </ul>
  );
}

/** Content of the slot's type that's made and waiting: schedule one right here (D50). */
function ReadyFor({ posts, slot, o, poolHref }: { posts: HubDataset['posts']; slot: Extract<DaySlot, { kind: 'open' }>; o: ReturnType<typeof offerer>; poolHref: string }) {
  const ready = posts
    .filter((p) => p.vertical === slot.vertical && p.status === 'ready' && !/\brejected\b/i.test(p.approval.note ?? ''))
    .sort((a, b) => (b.generatedAt ?? '').localeCompare(a.generatedAt ?? ''))
    .slice(0, 4);
  if (ready.length === 0) {
    return (
      <p className="sh-item__ready-none sh-subtle">
        Nothing of this type is made and waiting; tonight’s run fills open slots. <HubLink className="sh-link" href={poolHref}>See the pool</HubLink>
      </p>
    );
  }
  // No disclosure that opens onto a switched-off button (critique P1-A): say what's ready instead.
  if (!actionEnabled('reschedule')) {
    return (
      <p className="sh-item__ready-none sh-subtle">
        {plural(ready.length, 'post')} of this type {ready.length === 1 ? 'is' : 'are'} made and could go here once scheduling from the hub is on. <HubLink className="sh-link" href={poolHref}>See the pool</HubLink>
      </p>
    );
  }
  return (
    <details className="sh-item__ready">
      <summary>Schedule something here <span className="sh-count">{ready.length} ready</span></summary>
      <ul className="sh-list">
        {ready.map((p) => (
          <li key={p.id} className="sh-item sh-item--candidate">
            <Thumb post={p} />
            <div className="sh-item__main">
              <PostLink id={p.id} className="sh-item__name">{displayName(p)}</PostLink>
              <span className="sh-item__line">{o.offer(p).state.label} · made {whenInline(p.generatedAt, o.now)}</span>
            </div>
            <div className="sh-item__actions"><ActionBar menu={o.placeHere(p, slotDay(slot), slot.window.id)} compact /></div>
          </li>
        ))}
      </ul>
      <p className="sh-item__ready-more"><HubLink className="sh-link" href={poolHref}>See the whole pool</HubLink></p>
    </details>
  );
}

function slotDay(slot: Extract<DaySlot, { kind: 'open' }>): string {
  return nyDateOf(new Date(slot.at))!;
}
