import Link from 'next/link';

import { AutoSubmitForm } from '@/components/social-hub/AutoSubmitForm';
import { colorStyle } from '@/components/social-hub/marks';
import {
  comparePosts,
  groupsFor,
  hrefWith,
  metricChoices,
  MIN_COMPARE,
  queryParams,
  sideBySide,
  type AnalyticsQuery,
} from '@/lib/social-hub/analytics';
import { formatUsd } from '@/lib/social-hub/cost';
import { factorsFor } from '@/lib/social-hub/factors';
import { postHref } from '@/lib/social-hub/ids';
import { formatMetricKey } from '@/lib/social-hub/metrics';
import type { HubPost } from '@/lib/social-hub/types';

/** Compare (spec §5.4): N posts side by side, or group vs group. */
export function CompareTab({ q, all, inView, base, action }: { q: AnalyticsQuery; all: HubPost[]; inView: HubPost[]; base: string; action: string }) {
  const keep = { ...queryParams(q), tab: 'compare' };
  return (
    <>
      <nav className="sh-seg" aria-label="Compare mode">
        <Link href={hrefWith(action, q, { mode: null, factor: null })} aria-current={q.mode === 'side' ? 'page' : undefined}>Side by side</Link>
        <Link href={hrefWith(action, q, { mode: 'groups' })} aria-current={q.mode === 'groups' ? 'page' : undefined}>Group vs group</Link>
      </nav>
      {q.mode === 'side' ? <SideBySide q={q} all={all} base={base} action={action} /> : <Groups q={q} inView={inView} action={action} keep={keep} />}
    </>
  );
}

function SideBySide({ q, all, base, action }: { q: AnalyticsQuery; all: HubPost[]; base: string; action: string }) {
  const posts = comparePosts(all, q.compare);
  if (posts.length < MIN_COMPARE) {
    return (
      <div className="sh-card sh-empty">
        <strong>Pick 2 to 6 posts</strong>
        Tick them in the <Link className="sh-link" href={hrefWith(action, q, { tab: null })}>Content posts table</Link>, then choose Compare selected.
        {q.compare.length > 0 ? ' Unpublished or unknown posts were left out.' : ''}
      </div>
    );
  }
  const rows = sideBySide(posts, formatMetricKey, formatUsd);
  return (
    <div className="sh-card">
      <div className="sh-table-wrap" role="region" aria-label="Comparison table" tabIndex={0}>
        <table className="sh-table sh-compare">
          <thead>
            <tr>
              <th scope="col">Field</th>
              {posts.map((p) => (
                <th key={p.id} scope="col" style={colorStyle(p.vertical)} className="sh-compare__head">
                  <Link href={postHref(base, p.id)} className="sh-link">{p.name}</Link>
                  <Link className="sh-subtle" href={hrefWith(action, q, { cmp: q.compare.filter((id) => id !== p.id).join(',') || null })}>Remove</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.group}-${row.label}`} className={row.differs ? 'sh-compare__diff' : undefined}>
                <th scope="row">{row.label}{row.differs ? <span className="sh-sr"> (differs)</span> : null}</th>
                {row.values.map((v, i) => <td key={posts[i]!.id} className={row.group === 'meta' ? undefined : 'sh-num'}>{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sh-subtle sh-card__body">Highlighted rows differ between the posts. Latest totals (SH-10); no tests of significance (SH-07).</p>
    </div>
  );
}

function Groups({ q, inView, action, keep }: { q: AnalyticsQuery; inView: HubPost[]; action: string; keep: Record<string, string | undefined> }) {
  const factors = factorsFor(q.vertical);
  const groups = groupsFor(inView, q);
  const metrics = metricChoices(q);
  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <AutoSubmitForm action={action} hidden={{ ...keep, mode: 'groups', factor: undefined }} label="Factor">
          <label className="sh-control">
            <span className="sh-control__label">Group by</span>
            <select className="sh-select" name="factor" defaultValue={q.factor}>
              {factors.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
        </AutoSubmitForm>
        <span className="sh-muted">{inView.length} posts · sorted by {metrics.find((m) => m.key === q.metric)?.label}</span>
      </div>
      {groups.length === 0 ? (
        <div className="sh-empty"><strong>No published posts in this view</strong></div>
      ) : (
        <div className="sh-table-wrap">
          <table className="sh-table">
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col" className="sh-num">Posts</th>
                {metrics.map((m) => <th key={m.key} scope="col" className={`sh-num${m.key === q.metric ? ' sh-sorted' : ''}`}>{m.label}</th>)}
                <th scope="col" className="sh-num">Cost a post</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <th scope="row">{g.label} {g.thin ? <span className="sh-thin" title="Fewer than 3 posts">thin</span> : null}</th>
                  <td className="sh-num">{g.count}</td>
                  {metrics.map((m) => <td key={m.key} className="sh-num">{formatMetricKey(g.means[m.key] ?? null, m.key)}</td>)}
                  <td className="sh-num">{formatUsd(g.costMicros == null ? null : Math.round(g.costMicros))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="sh-subtle sh-card__body">Averages per group. A group under 3 posts stays visible and is marked thin (SH-09). A post with several tags counts in each.</p>
    </div>
  );
}
