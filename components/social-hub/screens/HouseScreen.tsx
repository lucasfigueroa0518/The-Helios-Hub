import Link from 'next/link';

import { AutoSubmitForm } from '@/components/social-hub/AutoSubmitForm';
import { DataNotes } from '@/components/social-hub/DataNotes';
import { ActionBar } from '@/components/social-hub/house/ActionBar';
import { PostRow } from '@/components/social-hub/house/PostRow';
import { TypesChart } from '@/components/social-hub/house/TypesChart';
import { MediaPreview } from '@/components/social-hub/MediaPreview';
import { PageHead } from '@/components/social-hub/PageHead';
import { VerticalDot, VerticalTag } from '@/components/social-hub/marks';
import { formatUsd } from '@/lib/social-hub/cost';
import type { HubDataset } from '@/lib/social-hub/dataset';
import { ACTION_FLAGS, actionEnabled, hubIsReadOnly, type HubFlags } from '@/lib/social-hub/flags';
import {
  actionsFor,
  allContent,
  HOUSE_TABS,
  houseTab,
  ideasView,
  needsApproval,
  onDeck,
  quotaFrom,
  sourceRows,
  timeLeft,
  todayPosts,
  typeRows,
  typicalCost,
  type Quota,
} from '@/lib/social-hub/house';
import { hubHref, withParams, type HubParams } from '@/lib/social-hub/links';
import { DEFAULT_METRIC, formatMetricKey, isMetricKey, METRICS } from '@/lib/social-hub/metrics';
import { sourceDomain } from '@/lib/social-hub/sources';
import { dateTimeLabel, nyDateOf, parseRange, RANGE_OPTIONS } from '@/lib/social-hub/time';
import { isVertical, VERTICALS } from '@/lib/social-hub/verticals';
import type { HubPost, IdeaState } from '@/lib/social-hub/types';

const STATUS_FILTERS = ['published', 'scheduled', 'failed', 'cancelled', 'ready', 'skipped'] as const;

const IDEA_STATE: Record<IdeaState, string> = {
  idea_only: 'Idea only',
  content_ready: 'Content ready',
  on_deck: 'On deck',
  published: 'Published',
  retired: 'Retired',
  skipped: 'Story skipped',
};

/** Content House (spec §7): the operating floor. Actions are flagged off in Phase 1 (§S5). */
export function HouseScreen({ dataset, base, params, now, flags }: { dataset: HubDataset; base: string; params: HubParams; now: Date; flags: HubFlags }) {
  const tab = houseTab(params.tab);
  const action = `${base}/house`;
  const today = nyDateOf(now)!;
  const quota = quotaFrom(dataset.latestQuota, dataset.posts, now);
  const enabled = Object.fromEntries(ACTION_FLAGS.map((f) => [f, actionEnabled(f, flags)])) as Record<(typeof ACTION_FLAGS)[number], boolean>;
  const costLabel = (post: HubPost) => formatUsd(typicalCost(dataset.posts, post.vertical, today));
  const actions = (post: HubPost) => <ActionBar plans={actionsFor(post, { quota, typicalCostLabel: costLabel(post) })} enabled={enabled} />;
  const vertical = isVertical(params.v) ? params.v : null;
  const keep: HubParams = { tab: tab === 'approval' ? undefined : tab, v: params.v };

  return (
    <>
      <PageHead
        kicker="Social Hub · Content House"
        title="Content House"
        sub="Everything the pipelines made, what posts next, and what's waiting on a person."
        actions={<QuotaCard quota={quota} />}
      />
      {hubIsReadOnly(flags) ? (
        <p className="sh-note" role="note">Read-only for now: approve, Hard publish and Hard regenerate turn on one at a time in Phase 2. Links open each pipeline&apos;s own page.</p>
      ) : null}
      <nav className="sh-seg sh-tabs" aria-label="Content House tabs">
        {HOUSE_TABS.map((t) => (
          <Link key={t.id} href={hubHref(action, '', { tab: t.id === 'approval' ? undefined : t.id })} aria-current={tab === t.id ? 'page' : undefined}>{t.label}</Link>
        ))}
      </nav>
      <DataNotes dataset={dataset} cost={tab === 'types'} />

      {tab === 'approval' ? <Approval posts={needsApproval(dataset.posts, now)} base={base} now={now} actions={actions} /> : null}
      {tab === 'today' ? <List posts={todayPosts(dataset.posts, today)} base={base} empty="Nothing posts or posted today." actions={actions} /> : null}
      {tab === 'deck' ? <List posts={onDeck(dataset.posts)} base={base} empty="Nothing is scheduled." actions={actions} now={now} /> : null}

      {tab === 'all' ? (
        <>
          <VerticalFilter action={action} keep={keep} current={vertical} />
          <nav className="sh-seg" aria-label="Status">
            <Link href={withParams(action, '', { ...keep, status: params.status }, { status: null })} aria-current={!params.status ? 'page' : undefined}>Any status</Link>
            {STATUS_FILTERS.map((s) => (
              <Link key={s} href={withParams(action, '', { ...keep, status: params.status }, { status: s })} aria-current={params.status === s ? 'page' : undefined}>{s}</Link>
            ))}
          </nav>
          <List
            posts={allContent(dataset.posts, { vertical, status: STATUS_FILTERS.includes(params.status as never) ? params.status! : null, range: null }).slice(0, 100)}
            base={base}
            empty="No content matches."
            actions={actions}
            footnote="Newest 100 shown. Filter by vertical or status to narrow."
          />
        </>
      ) : null}

      {tab === 'ideas' ? (
        <Ideas dataset={dataset} action={action} keep={keep} vertical={vertical} has={params.has === 'yes' ? true : params.has === 'no' ? false : null} />
      ) : null}

      {tab === 'sources' ? <Sources dataset={dataset} action={action} keep={keep} metricParam={params.metric} /> : null}

      {tab === 'types' ? <Types dataset={dataset} action={action} keep={keep} params={params} now={now} /> : null}
    </>
  );
}

function QuotaCard({ quota }: { quota: Quota }) {
  return (
    <div className="sh-quota" aria-label="Publishing quota">
      <span className="sh-control__label">24 h publishing quota</span>
      <strong>{quota.left != null ? `${quota.left} of ${quota.total} left` : 'Not reported'}</strong>
      <span className="sh-subtle">{quota.publishedLast24h} media published in the last 24 h (pipeline rows) · {quota.source}</span>
      <span className="sh-subtle">Each publisher still refuses to post with fewer than 5 left.</span>
    </div>
  );
}

function VerticalFilter({ action, keep, current }: { action: string; keep: HubParams; current: string | null }) {
  return (
    <nav className="sh-seg" aria-label="Vertical">
      <Link href={withParams(action, '', keep, { v: null })} aria-current={!current ? 'page' : undefined}>All</Link>
      {VERTICALS.map((v) => (
        <Link key={v.id} href={withParams(action, '', keep, { v: v.id })} aria-current={current === v.id ? 'page' : undefined}><VerticalDot vertical={v.id} />{v.short}</Link>
      ))}
    </nav>
  );
}

function List({ posts, base, empty, actions, now, footnote }: { posts: HubPost[]; base: string; empty: string; actions: (p: HubPost) => React.ReactNode; now?: Date; footnote?: string }) {
  if (posts.length === 0) return <div className="sh-card sh-empty"><strong>{empty}</strong></div>;
  return (
    <section className="sh-card sh-card__body">
      <ul className="sh-rows">
        {posts.map((post) => (
          <PostRow key={post.id} post={post} base={base} extra={now && post.publishAt ? <span className="sh-subtle">{timeLeft(post, now)}</span> : null}>
            {actions(post)}
          </PostRow>
        ))}
      </ul>
      {footnote ? <p className="sh-subtle">{footnote}</p> : null}
    </section>
  );
}

function Approval({ posts, base, now, actions }: { posts: HubPost[]; base: string; now: Date; actions: (p: HubPost) => React.ReactNode }) {
  if (posts.length === 0) {
    return <div className="sh-card sh-empty"><strong>Nothing is waiting on a person</strong>Every scheduled slot is approved and every render is reviewed.</div>;
  }
  return (
    <section className="sh-card sh-card__body">
      <p className="sh-muted">Soonest slot first. A slot that passes unapproved is cancelled, never posted late.</p>
      <ul className="sh-rows">
        {posts.map((post) => (
          <PostRow key={post.id} post={post} base={base} extra={<span className="sh-left">{timeLeft(post, now) ?? 'no slot yet'}</span>}>
            {actions(post)}
            {post.vertical === 'carousels' ? (
              <details className="sh-review">
                <summary>Review slides, checks and sources</summary>
                <MediaPreview media={post.media} title={post.name} />
                {post.reviewNotes?.length ? <ul className="sh-notes">{post.reviewNotes.map((n, i) => <li key={`${i}-${n}`}>{n}</li>)}</ul> : <p className="sh-subtle">No render-check notes.</p>}
                {post.sources.map((s, i) => <p key={`${i}-${s.url}`} className="sh-subtle"><a className="sh-link" href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.url}</a> · {sourceDomain(s.url)}</p>)}
                {post.status === 'ready' ? <p className="sh-subtle">In review with no slot: approval needs a slot first (Phase 2, P2-M4).</p> : null}
              </details>
            ) : null}
          </PostRow>
        ))}
      </ul>
    </section>
  );
}

function Ideas({ dataset, action, keep, vertical, has }: { dataset: HubDataset; action: string; keep: HubParams; vertical: HubPost['vertical'] | null; has: boolean | null }) {
  const ideas = ideasView(dataset.ideas, { vertical, hasContent: has });
  const k = { ...keep, has: has == null ? undefined : has ? 'yes' : 'no' };
  return (
    <>
      <VerticalFilter action={action} keep={k} current={vertical} />
      <nav className="sh-seg" aria-label="Has content">
        <Link href={withParams(action, '', k, { has: null })} aria-current={has == null ? 'page' : undefined}>Any</Link>
        <Link href={withParams(action, '', k, { has: 'yes' })} aria-current={has === true ? 'page' : undefined}>Has content</Link>
        <Link href={withParams(action, '', k, { has: 'no' })} aria-current={has === false ? 'page' : undefined}>Idea only</Link>
      </nav>
      {ideas.length === 0 ? (
        <div className="sh-card sh-empty"><strong>No ideas match</strong></div>
      ) : (
        <section className="sh-card">
          <div className="sh-table-wrap" role="region" aria-label="Ideas" tabIndex={0}>
            <table className="sh-table">
              <thead><tr><th scope="col">Idea</th><th scope="col">Pool</th><th scope="col" className="sh-num">Score</th><th scope="col">State</th><th scope="col">Has content</th><th scope="col">Generated</th></tr></thead>
              <tbody>
                {ideas.map((i) => (
                  <tr key={i.id}>
                    <td><span className="sh-table__name"><span>{i.title}</span>{i.detail ? <span className="sh-subtle">{i.detail}</span> : null}</span></td>
                    <td><VerticalTag vertical={i.vertical} /></td>
                    <td className="sh-num" title={i.scoreLabel}>{i.score == null ? '—' : i.score.toFixed(2)}</td>
                    <td>{IDEA_STATE[i.state]}</td>
                    <td>{i.hasContent ? `Yes · ${i.versionCount} version${i.versionCount === 1 ? '' : 's'}` : 'No'}</td>
                    <td className="sh-nowrap">{i.generatedAt ? dateTimeLabel(i.generatedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sh-subtle sh-card__body">Read-only: each pipeline&apos;s own pool with its own score (SH-19). Trial Reels ideas never carry stored content (SH-59).</p>
        </section>
      )}
    </>
  );
}

function MetricPicker({ action, keep, metric }: { action: string; keep: HubParams; metric: string }) {
  return (
    <AutoSubmitForm action={action} hidden={keep} label="Metric">
      <label className="sh-control">
        <span className="sh-control__label">Metric</span>
        <select className="sh-select" name="metric" defaultValue={metric}>
          {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </label>
    </AutoSubmitForm>
  );
}

function Sources({ dataset, action, keep, metricParam }: { dataset: HubDataset; action: string; keep: HubParams; metricParam?: string }) {
  const metric = isMetricKey(metricParam) ? metricParam : DEFAULT_METRIC;
  const rows = sourceRows(dataset.sources, dataset.posts, metric);
  return (
    <>
      <MetricPicker action={action} keep={keep} metric={metric} />
      {rows.length === 0 ? (
        <div className="sh-card sh-empty"><strong>No sources recorded</strong></div>
      ) : (
        <section className="sh-card">
          <div className="sh-table-wrap" role="region" aria-label="Sources" tabIndex={0}>
            <table className="sh-table">
              <thead><tr><th scope="col">Source</th><th scope="col">Domain</th><th scope="col">Used by</th><th scope="col" className="sh-num">Reuse</th><th scope="col" className="sh-num">Mean {METRICS.find((m) => m.key === metric)?.label.toLowerCase()}</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.url}>
                    <td><a className="sh-link" href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.url}</a></td>
                    <td className="sh-nowrap">{sourceDomain(s.url)}</td>
                    <td><span className="sh-row__meta">{s.verticals.map((v) => <VerticalTag key={v} vertical={v} />)}</span></td>
                    <td className="sh-num">{s.reuse}</td>
                    <td className="sh-num">{formatMetricKey(s.metric, metric)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sh-subtle sh-card__body">All source material across verticals, deduped by URL (SH-18). Performance averages the published posts that used it.</p>
        </section>
      )}
    </>
  );
}

function Types({ dataset, action, keep, params, now }: { dataset: HubDataset; action: string; keep: HubParams; params: HubParams; now: Date }) {
  const metric = isMetricKey(params.metric) ? params.metric : DEFAULT_METRIC;
  const range = parseRange({ range: params.range }, now);
  const k = { ...keep, range: params.range };
  return (
    <section className="sh-card sh-card__body">
      <div className="sh-controls">
        <nav className="sh-seg" aria-label="Date range">
          {RANGE_OPTIONS.filter((r) => r.id !== 'custom').map((r) => (
            <Link key={r.id} href={withParams(action, '', { ...k, metric: params.metric }, { range: r.id === '30d' ? null : r.id })} aria-current={range.id === r.id ? 'page' : undefined}>{r.label}</Link>
          ))}
        </nav>
        <MetricPicker action={action} keep={k} metric={metric} />
      </div>
      <TypesChart rows={typeRows(dataset.posts, metric, range)} metric={metric} />
    </section>
  );
}
