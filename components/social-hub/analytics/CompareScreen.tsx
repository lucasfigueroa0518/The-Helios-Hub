import { Breadcrumbs } from '@/components/social-hub/nav/Breadcrumbs';
import { HubLink } from '@/components/social-hub/nav/HubNav';
import { PostLink } from '@/components/social-hub/nav/PostLink';
import { TypeMark } from '@/components/social-hub/ui/marks';
import { PageHead } from '@/components/social-hub/ui/PageHead';
import { Thumb } from '@/components/social-hub/ui/Thumb';
import { comparePosts } from '@/lib/social-hub/analytics';
import { formatUsd, perDollar } from '@/lib/social-hub/cost';
import type { HubDataset } from '@/lib/social-hub/dataset';
import { formatMetric, formatMetricKey, metricsFor, postMetric } from '@/lib/social-hub/metrics';
import { displayName, shortDate } from '@/lib/social-hub/views/format';
import { crumbsFor } from '@/lib/social-hub/views/nav';
import type { HubPost } from '@/lib/social-hub/types';

type Row = { label: string; cells: string[]; best: number | null };

function bestOf(values: Array<number | null>, higherIsBetter: boolean): number | null {
  let best: number | null = null;
  values.forEach((v, i) => {
    if (v == null) return;
    if (best == null || (higherIsBetter ? v > values[best]! : v < values[best]!)) best = i;
  });
  const nums = values.filter((v) => v != null);
  return nums.length > 1 && new Set(nums).size > 1 ? best : null;
}

const SKIP_NATIVE = new Set(['Posting slot', 'Slot', 'Title']);

/** Side by side (BRIEFS.md §3): the best value in each row is marked; fields nobody has are left out. */
export function CompareScreen({ dataset, base, ids }: { dataset: HubDataset; base: string; ids: string[] }) {
  const posts: HubPost[] = comparePosts(dataset.posts, ids);
  const formats = [...new Set(posts.map((p) => p.format))];
  const metricRows: Row[] = metricsFor(formats).map((m) => {
    const values = posts.map((p) => postMetric(p, m.key));
    return { label: m.label, cells: values.map((v) => formatMetricKey(v, m.key)), best: bestOf(values, m.higherIsBetter) };
  });
  const cost = posts.map((p) => p.costMicros);
  const perDollarViews = posts.map((p) => perDollar(postMetric(p, 'views'), p.costMicros));
  const costRows: Row[] = [
    { label: 'Cost to make', cells: cost.map((c) => formatUsd(c)), best: bestOf(cost, false) },
    { label: 'Views per $', cells: perDollarViews.map((v) => formatMetric(v, 'count')), best: bestOf(perDollarViews, true) },
  ];
  const metaLabels: string[] = [];
  for (const p of posts) for (const f of p.native) if (!SKIP_NATIVE.has(f.label) && !metaLabels.includes(f.label)) metaLabels.push(f.label);
  const metaRows: Row[] = [
    { label: 'Posted', cells: posts.map((p) => shortDate(p.postedAt)), best: null },
    { label: 'Window', cells: posts.map((p) => p.slot?.label ?? '—'), best: null },
    ...metaLabels
      .map((label) => ({ label, cells: posts.map((p) => p.native.find((f) => f.label === label)?.value ?? '—'), best: null }))
      .filter((r) => r.cells.some((c) => c !== '—' && c !== '')),
  ];

  return (
    <>
      <Breadcrumbs crumbs={crumbsFor(base, `${base}/analytics/compare`)} />
      <PageHead title="Compare" meta={posts.length ? `${posts.length} posts side by side · the best value in each row is marked` : undefined} />
      {posts.length < 2 ? (
        <div className="sh-panel sh-empty">
          <strong>{posts.length === 1 ? 'Pick one more post' : 'Pick at least two posts'}</strong>
          {posts.length === 1 ? <>“{displayName(posts[0]!)}” is picked. Tick another in any Analytics table, then choose Compare in the tray at the bottom.</> : 'Tick posts in any Analytics table, then choose Compare in the tray at the bottom.'}
          <HubLink className="sh-btn sh-btn--quiet" href={`${base}/analytics`}>Back to Analytics</HubLink>
        </div>
      ) : (
        <div className="sh-panel">
          <div className="sh-table-wrap">
            <table className="sh-table sh-compare">
              <thead>
                <tr>
                  <th scope="col"><span className="sh-sr">Field</span></th>
                  {posts.map((p) => (
                    <th key={p.id} scope="col">
                      <span className="sh-compare__post">
                        <PostLink id={p.id} className="sh-item__thumb"><Thumb post={p} size="lg" /></PostLink>
                        <PostLink id={p.id} className="sh-cell-post__name">{displayName(p)}</PostLink>
                        <TypeMark vertical={p.vertical} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              {[{ id: 'Performance', rows: metricRows }, { id: 'Cost', rows: costRows }, { id: 'Details', rows: metaRows }].map((g) => (
                <tbody key={g.id}>
                  <tr className="sh-compare__group"><th scope="rowgroup" colSpan={posts.length + 1}>{g.id}</th></tr>
                  {g.rows.map((r) => (
                    <tr key={r.label}>
                      <th scope="row">{r.label}</th>
                      {r.cells.map((c, i) => <td key={i} className={`sh-num${r.best === i ? ' sh-best' : ''}`}>{c}{r.best === i ? <span className="sh-sr"> (best)</span> : null}</td>)}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      )}
    </>
  );
}
