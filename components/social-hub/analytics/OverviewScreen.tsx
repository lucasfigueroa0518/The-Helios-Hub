import { ArrowRight } from 'lucide-react';

import { Delta, KpiStrip, Sparkline } from '@/components/social-hub/analytics/KpiStrip';
import { PostsTable } from '@/components/social-hub/analytics/PostsTable';
import { Toolbar } from '@/components/social-hub/analytics/Toolbar';
import { TrendChart } from '@/components/social-hub/analytics/TrendChart';
import { AudienceSection } from '@/components/social-hub/analytics/AudienceSection';
import { DataNotes } from '@/components/social-hub/DataNotes';
import { HubLink } from '@/components/social-hub/nav/HubNav';
import { PageHead } from '@/components/social-hub/ui/PageHead';
import { TypeMark } from '@/components/social-hub/ui/marks';
import { summarizeAccount } from '@/lib/social-hub/account';
import { formatUsd } from '@/lib/social-hub/cost';
import type { HubDataset } from '@/lib/social-hub/dataset';
import { hubHref, withParams, type HubParams } from '@/lib/social-hub/links';
import { formatMetric, formatMetricKey, metricSpec, metricsFor } from '@/lib/social-hub/metrics';
import { rangeLabel } from '@/lib/social-hub/time';
import { overviewKpis, parseQuery, trendSeries, typeRows } from '@/lib/social-hub/views/analytics';

/** Analytics overview (BRIEFS.md §3): how the account is doing, which type carries it, then the posts. */
/** The overview answers "how are we doing"; the full list is one click away. */
const TOP_POSTS = 10;

export function OverviewScreen({ dataset, base, params, now }: { dataset: HubDataset; base: string; params: HubParams; now: Date }) {
  const q = parseQuery(params, null, now);
  const allPosts = params.posts === 'all' || q.page > 1;
  const path = `${base}/analytics`;
  const { kpis, posts, days } = overviewKpis(dataset.posts, q, null);
  const rows = typeRows(dataset.posts, q, days);
  const { series, smoothed } = trendSeries(posts, days, q.metric);
  const spec = metricSpec(q.metric);
  const account = summarizeAccount(dataset.account, q.range);
  const metrics = metricsFor(['reel', 'feed', 'story']).map((m) => ({ value: m.key, label: m.label }));

  return (
    <>
      <PageHead title="Analytics" aside={rangeLabel(q.range)} meta={`${posts.length.toLocaleString('en-US')} posts went out · compared with the ${q.range.id === 'all' ? 'whole history' : 'same span just before'}`} />
      <Toolbar range={q.range.id} from={q.range.from} to={q.range.to} metric={q.metric} metrics={metrics} />
      <DataNotes dataset={dataset} cost />

      <KpiStrip kpis={kpis} emphasis={q.metric} />

      <section className="sh-section" aria-labelledby="trend">
        <div className="sh-section__head"><h2 className="sh-title" id="trend">{spec.label} by type</h2></div>
        <div className="sh-panel sh-panel__body">
          <TrendChart days={days} series={series} display={spec.display} metricLabel={smoothed ? `${spec.label}, 7-day average,` : spec.label} />
        </div>
      </section>

      <section className="sh-section" aria-labelledby="by-type">
        <div className="sh-section__head">
          <h2 className="sh-title" id="by-type">By content type</h2>
          <span className="sh-subtle">Median per post, so types that post more often compare fairly.</span>
        </div>
        <div className="sh-panel">
          <div className="sh-table-wrap">
            <table className="sh-table sh-table--rows sh-table--stack">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col" className="sh-num">Posts</th>
                  <th scope="col" className="sh-num">Median {spec.label.toLowerCase()}</th>
                  <th scope="col">Trend</th>
                  <th scope="col">vs previous period</th>
                  <th scope="col" className="sh-num">Shares a post</th>
                  <th scope="col" className="sh-num">Cost a post</th>
                  <th scope="col"><span className="sh-sr">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.vertical} className="sh-row-link">
                    <td className="sh-stack-lead"><HubLink href={hubHref(`${path}/${r.vertical}`, '', { range: params.range, from: params.from, to: params.to, metric: params.metric })} className="sh-row-link__a"><TypeMark vertical={r.vertical} /></HubLink></td>
                    <td className="sh-num" data-label={r.posts === 1 ? 'post' : 'posts'}>{r.posts}</td>
                    <td className="sh-num" data-label={`median ${spec.label.toLowerCase()}`}>{r.median == null ? <span className="sh-muted">n/a</span> : formatMetricKey(r.median, q.metric)}</td>
                    <td><Sparkline values={r.spark} color={`var(--sh-v-${r.vertical})`} /></td>
                    <td data-label="vs before">{r.median == null ? null : <Delta value={r.median} previous={r.previousMedian} higherIsBetter={spec.higherIsBetter} suffix="" />}</td>
                    <td className="sh-num" data-label="shares a post">{r.sharesPerPost == null ? '—' : formatMetric(r.sharesPerPost, 'count')}</td>
                    <td className="sh-num" data-label="a post">{formatUsd(r.costPerPost)}</td>
                    <td className="sh-num sh-stack-hide"><ArrowRight size={14} aria-hidden="true" className="sh-muted" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="sh-section" aria-labelledby="posts">
        <div className="sh-section__head">
          <h2 className="sh-title" id="posts">{allPosts ? 'Posts' : 'Top posts'}<span className="sh-count">{posts.length}</span></h2>
          <span className="sh-subtle">Tick up to six to compare.</span>
        </div>
        <PostsTable
          posts={posts}
          q={q}
          path={path}
          params={params}
          columns={[q.metric === 'views' ? 'views' : q.metric, ...(q.metric === 'shares' ? [] : ['shares' as const])]}
          showType
          {...(allPosts ? {} : { limit: TOP_POSTS, moreHref: withParams(path, '', params, { posts: 'all', page: null }) })}
        />
      </section>

      {account ? <AudienceSection summary={account} /> : null}
    </>
  );
}
