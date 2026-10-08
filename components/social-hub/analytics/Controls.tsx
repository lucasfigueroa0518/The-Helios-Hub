import Link from 'next/link';

import { AutoSubmitForm } from '@/components/social-hub/AutoSubmitForm';
import { VerticalDot } from '@/components/social-hub/marks';
import { filterOptions, hrefWith, metricChoices, queryParams, type AnalyticsQuery } from '@/lib/social-hub/analytics';
import { RANGE_OPTIONS } from '@/lib/social-hub/time';
import { VERTICALS } from '@/lib/social-hub/verticals';
import type { HubPost } from '@/lib/social-hub/types';

function without(params: Record<string, string | undefined>, drop: (key: string) => boolean): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(params).filter(([k]) => !drop(k)));
}

/**
 * Global controls on every analytics tab (spec §5): range, vertical first,
 * success metric, filters (shared always; native with one vertical). All
 * state is in the URL; `hrefWith` decides what each change keeps.
 */
export function Controls({ q, posts, action }: { q: AnalyticsQuery; posts: readonly HubPost[]; action: string }) {
  const state = queryParams(q);
  const options = filterOptions(posts, q);
  const current = (on: boolean) => (on ? ('page' as const) : undefined);
  return (
    <div className="sh-card sh-card__body sh-controls-card">
      <div className="sh-controls">
        <div className="sh-control" role="group" aria-labelledby="sh-range-label">
          <span className="sh-control__label" id="sh-range-label">Range</span>
          <nav className="sh-seg" aria-label="Date range">
            {RANGE_OPTIONS.filter((r) => r.id !== 'custom').map((r) => (
              <Link key={r.id} href={hrefWith(action, q, { range: r.id === '30d' ? null : r.id })} aria-current={current(q.range.id === r.id)}>{r.label}</Link>
            ))}
          </nav>
          <form method="get" action={action} className="sh-form" aria-label="Custom range">
            {Object.entries({ ...without(state, (k) => k === 'range' || k === 'from' || k === 'to'), range: 'custom' }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <label className="sh-inline"><span className="sh-subtle">From</span><input className="sh-select" type="date" name="from" required defaultValue={q.range.id === 'custom' ? q.range.from ?? '' : ''} /></label>
            <label className="sh-inline"><span className="sh-subtle">to</span><input className="sh-select" type="date" name="to" defaultValue={q.range.id === 'custom' ? q.range.to : ''} /></label>
            <button type="submit" className="sh-btn">Apply</button>
          </form>
        </div>
        <div className="sh-control" role="group" aria-labelledby="sh-vertical-label">
          <span className="sh-control__label" id="sh-vertical-label">Vertical</span>
          <nav className="sh-seg" aria-label="Vertical">
            <Link href={hrefWith(action, q, { v: null })} aria-current={current(!q.vertical)}>All</Link>
            {VERTICALS.map((v) => (
              <Link key={v.id} href={hrefWith(action, q, { v: v.id })} aria-current={current(q.vertical === v.id)}>
                <VerticalDot vertical={v.id} />
                {v.short}
              </Link>
            ))}
          </nav>
        </div>
        <AutoSubmitForm action={action} hidden={without(state, (k) => k === 'metric' || k.startsWith('f.'))} label="Metric and filters">
          <label className="sh-control">
            <span className="sh-control__label">Success metric</span>
            <select className="sh-select" name="metric" defaultValue={q.metric}>
              {metricChoices(q).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          {options.map(({ factor, values }) => (
            <label key={factor.id} className="sh-control">
              <span className="sh-control__label">{factor.label}</span>
              <select className="sh-select" name={`f.${factor.id}`} defaultValue={q.filters[factor.id] ?? ''}>
                <option value="">Any</option>
                {values.map((v) => <option key={v.key} value={v.key}>{v.label} ({v.count})</option>)}
              </select>
            </label>
          ))}
        </AutoSubmitForm>
      </div>
      <p className="sh-subtle">
        {q.vertical
          ? 'Filters show the values present in this range, with post counts.'
          : 'Format and slot filters work across verticals. Pick one vertical to filter by its own fields (SH-05).'}
      </p>
    </div>
  );
}
