import { ChevronLeft, ChevronRight, Hand, TriangleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';

import { Delta } from '@/components/social-hub/analytics/KpiStrip';
import { DaySheet } from '@/components/social-hub/calendar/DaySheet';
import { MonthGrid } from '@/components/social-hub/calendar/MonthGrid';
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
import { actionEnabled } from '@/lib/social-hub/flags';
import { withParams, type HubParams } from '@/lib/social-hub/links';
import { metricSpec } from '@/lib/social-hub/metrics';
import { addDays, dayLabel, isDayKey, monthLabel, monthOf, nyDateOf, shiftMonth, WEEKDAY_SHORT } from '@/lib/social-hub/time';
import { isVertical, VERTICAL_IDS } from '@/lib/social-hub/verticals';
import { daySlots, monthModel, totalLabel, type DayCell, type DaySlot } from '@/lib/social-hub/views/calendar';
import { displayName, plural, shortDate, whenInline } from '@/lib/social-hub/views/format';
import { offerer } from '@/lib/social-hub/views/offer';
import { minuteLabel, windowRange } from '@/lib/social-hub/views/plan';
import type { MetricKey, Vertical } from '@/lib/social-hub/types';

const METRICS: MetricKey[] = ['views', 'reach', 'shares', 'totalInteractions'];

const MARK_LABEL = { posted: 'posted', scheduled: 'scheduled', failed: 'failed', missed: 'didn’t post', open: 'open slot' } as const;

/** Calendar (BRIEFS.md §2): the month's shape, gaps ahead, and a day panel to act from. */
export function CalendarScreen({ dataset, base, params, now }: { dataset: HubDataset; base: string; params: HubParams; now: Date }) {
  const path = `${base}/calendar`;
  const today = nyDateOf(now)!;
  const day = isDayKey(params.day) ? params.day : null;
  const month = monthOf(params.month ?? day?.slice(0, 7), now);
  const metric: MetricKey = METRICS.includes(params.metric as MetricKey) ? (params.metric as MetricKey) : 'views';
  const shown: Vertical[] = params.types ? params.types.split(',').filter(isVertical) : [...VERTICAL_IDS];
  const types = new Set(shown.length ? shown : VERTICAL_IDS);
  const o = offerer(dataset, now);
  const m = monthModel(dataset.posts, month, now, metric, types, (p) => o.offer(p).state.id === 'needs_you');
  const keep: HubParams = { month: params.month, types: params.types, metric: params.metric };
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
          <div className="sh-pills" role="group" aria-label="Month">
            <HubLink className="sh-btn sh-btn--icon" href={href({ month: shiftMonth(month, -1), day: null })} aria-label="Previous month" history="replace"><ChevronLeft size={16} aria-hidden="true" /></HubLink>
            <HubLink className="sh-btn" href={href({ month: null, day: null })} aria-current={month === today.slice(0, 7) ? 'page' : undefined} history="replace">Today</HubLink>
            <HubLink className="sh-btn sh-btn--icon" href={href({ month: shiftMonth(month, 1), day: null })} aria-label="Next month" history="replace"><ChevronRight size={16} aria-hidden="true" /></HubLink>
          </div>
        }
      />
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
          {WEEKDAY_SHORT.map((d) => <span key={d} role="columnheader">{d}</span>)}
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
          <DayList posts={dataset.posts} day={day} types={types} now={now} o={o} base={base} />
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

function DayList({ posts, day, types, now, o, base }: { posts: HubDataset['posts']; day: string; types: ReadonlySet<Vertical>; now: Date; o: ReturnType<typeof offerer>; base: string }) {
  const slots = daySlots(posts, day, types, now);
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
