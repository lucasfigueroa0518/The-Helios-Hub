import { Filters } from '@/components/social-hub/analytics/Filters';
import { KpiStrip } from '@/components/social-hub/analytics/KpiStrip';
import { PostsTable } from '@/components/social-hub/analytics/PostsTable';
import { Toolbar } from '@/components/social-hub/analytics/Toolbar';
import { Breadcrumbs } from '@/components/social-hub/nav/Breadcrumbs';
import { DataNotes } from '@/components/social-hub/DataNotes';
import { HubLink } from '@/components/social-hub/nav/HubNav';
import { Menu } from '@/components/social-hub/ui/Menu';
import { PageHead } from '@/components/social-hub/ui/PageHead';
import { formatUsd } from '@/lib/social-hub/cost';
import type { HubDataset } from '@/lib/social-hub/dataset';
import { sourceRows } from '@/lib/social-hub/house';
import { withParams, type HubParams } from '@/lib/social-hub/links';
import { formatMetricKey, formatMetrics, metricSpec, metricsFor } from '@/lib/social-hub/metrics';
import { sourceDomain } from '@/lib/social-hub/sources';
import { rangeLabel } from '@/lib/social-hub/time';
import { verticalInfo } from '@/lib/social-hub/verticals';
import { filterOptions, overviewKpis, parseQuery, whatsWorking, workingVerdict } from '@/lib/social-hub/views/analytics';
import { factorGloss } from '@/lib/social-hub/views/factor-gloss';
import { crumbsFor } from '@/lib/social-hub/views/nav';
import { changeLabel } from '@/lib/social-hub/views/typical';
import type { MetricKey, Vertical } from '@/lib/social-hub/types';

const TABLE_COLUMNS: Record<'reel' | 'feed' | 'story', MetricKey[]> = {
  reel: ['views', 'avgWatchTimeMs', 'shares'],
  feed: ['views', 'shares', 'saved'],
  story: ['reach', 'completion', 'replies'],
};

/** One content type (BRIEFS.md §3): its own numbers, what's working, its posts, its sources. */
export function TypeScreen({ dataset, base, vertical, params, now }: { dataset: HubDataset; base: string; vertical: Vertical; params: HubParams; now: Date }) {
  const info = verticalInfo(vertical);
  const q = parseQuery(params, vertical, now);
  const path = `${base}/analytics/${vertical}`;
  const { kpis, posts } = overviewKpis(dataset.posts, q, vertical);
  const spec = metricSpec(q.metric);
  const work = whatsWorking(posts, vertical, q);
  const verdict = workingVerdict(work.groups, work.typical, q.metric);
  const factorLabel = work.factors.find((f) => f.id === work.factor)?.label ?? '';
  const gloss = work.factor ? factorGloss(vertical, work.factor) : null;
  const options = filterOptions(dataset.posts, { vertical, range: q.range, filters: q.filters });
  const metrics = metricsFor([info.format]).map((m) => ({ value: m.key, label: m.label }));
  const columns = [...new Set([q.metric, ...TABLE_COLUMNS[info.format]])].slice(0, 3) as MetricKey[];
  const sources = sourceRows(dataset.sources, posts, q.metric).filter((s) => s.verticals.includes(vertical)).sort((a, b) => b.reuse - a.reuse).slice(0, 8);
  const href = (changes: Record<string, string | null>) => withParams(path, '', params, changes);

  return (
    <>
      <Breadcrumbs crumbs={crumbsFor(base, path)} />
      <PageHead title={info.label} aside={rangeLabel(q.range)} meta={`${posts.length.toLocaleString('en-US')} posts went out${Object.keys(q.filters).length ? ' with these filters' : ''}`} />
      <Toolbar
        range={q.range.id}
        from={q.range.from}
        to={q.range.to}
        metric={q.metric}
        metrics={metrics}
        extra={<Filters options={options.map((o) => ({ factor: o.factor, values: o.values }))} active={q.filters} />}
      />
      <DataNotes dataset={dataset} cost />

      <KpiStrip kpis={kpis} emphasis={q.metric} />

      {work.factor ? (
        <section className="sh-section" aria-labelledby="working">
          <div className="sh-section__head">
            <h2 className="sh-title" id="working">What’s working</h2>
            <Menu
              label="Grouped by"
              value={work.factor}
              options={work.factors.map((f) => ({ value: f.id, label: f.label, href: href({ factor: f.id }) }))}
            />
          </div>
          <p className="sh-lead">{verdict.sentence}</p>
          <div className="sh-panel">
            <div className="sh-table-wrap">
              <table className="sh-table sh-table--stack">
                <thead>
                  <tr>
                    <th scope="col">{factorLabel}</th>
                    <th scope="col" className="sh-num">Posts</th>
                    <th scope="col" className="sh-num">Average {spec.label.toLowerCase()}</th>
                    <th scope="col">vs the type’s median</th>
                    <th scope="col" className="sh-num">Cost a post</th>
                  </tr>
                </thead>
                <tbody>
                  {work.groups.map((g, i) => {
                    const value = g.means[q.metric] ?? null;
                    const better = verdict.rows[i]?.better ?? null;
                    // The median sits at the middle of the bar, marked by a tick.
                    const share = work.typical && value != null ? Math.min(1, value / (work.typical * 2)) : 0;
                    const signed = work.typical && value != null ? changeLabel((value - work.typical) / Math.abs(work.typical)) : null;
                    return (
                      <tr key={g.key}>
                        <td className="sh-stack-lead">
                          <HubLink href={href({ [`f.${work.factor}`]: g.key, page: null })} history="replace" className="sh-link">{g.label}</HubLink>
                          {g.thin ? <span className="sh-chip sh-chip--quiet" title="Fewer than 3 posts: read with care">few posts</span> : null}
                        </td>
                        <td className="sh-num" data-label={g.count === 1 ? 'post' : 'posts'}>{g.count}</td>
                        <td className="sh-num" data-label={`average ${spec.label.toLowerCase()}`}>{formatMetricKey(value, q.metric)}</td>
                        <td>
                          <span className="sh-vs">
                            <span className="sh-bar sh-bar--median" aria-hidden="true"><span style={{ width: `${share * 100}%`, background: `var(--sh-v-${vertical})` }} /></span>
                            <span className={better != null && Math.abs(better) >= 0.1 && !g.thin ? 'sh-vs__pct sh-vs__pct--strong' : 'sh-vs__pct sh-muted'}>
                              {signed ? `${signed} vs median` : '—'}
                            </span>
                          </span>
                        </td>
                        <td className="sh-num sh-muted" data-label="a post">{formatUsd(g.costMicros)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="sh-subtle">
            {gloss ? <>{factorLabel}: {gloss} </> : null}
            The tick on each bar is the type’s median. Descriptive, not causal: a group with few posts can swing on one result. Click a group to see its posts.
          </p>
        </section>
      ) : null}

      <section className="sh-section" aria-labelledby="posts">
        <div className="sh-section__head">
          <h2 className="sh-title" id="posts">Posts<span className="sh-count">{posts.length}</span></h2>
          <span className="sh-subtle">Tick up to six to compare.</span>
        </div>
        <PostsTable posts={posts} q={q} path={path} params={params} columns={columns} showType={false} />
      </section>

      {sources.length ? (
        <section className="sh-section" aria-labelledby="sources">
          <div className="sh-section__head"><h2 className="sh-title" id="sources">Sources it drew on</h2></div>
          <div className="sh-panel">
            <table className="sh-table sh-table--stack">
              <thead><tr><th scope="col">Source</th><th scope="col" className="sh-num">Used</th><th scope="col" className="sh-num">Average {spec.label.toLowerCase()}</th></tr></thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.url}>
                    <td className="sh-stack-lead"><a className="sh-link" href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.url}</a> <span className="sh-subtle">{sourceDomain(s.url)}</span></td>
                    <td className="sh-num" data-label={s.reuse === 1 ? 'use' : 'uses'}>{s.reuse}</td>
                    <td className="sh-num" data-label={`average ${spec.label.toLowerCase()}`}>{formatMetricKey(s.metric, q.metric)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <p className="sh-subtle">{formatMetrics(info.format).length} metrics are tracked for {info.label.toLowerCase()}; pick any under “Ranked by”.</p>
    </>
  );
}
