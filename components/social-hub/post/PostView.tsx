import { ArrowUpRight } from 'lucide-react';

import { ActionBar } from '@/components/social-hub/house/ActionBar';
import { MediaPreview } from '@/components/social-hub/MediaPreview';
import { MetricChart } from '@/components/social-hub/MetricChart';
import { StateBadge, TypeMark } from '@/components/social-hub/ui/marks';
import { formatUsd, perDollar } from '@/lib/social-hub/cost';
import type { HubDataset } from '@/lib/social-hub/dataset';
import { formatMetric, formatMetricKey, formatMetrics, metricSpec, postMetric } from '@/lib/social-hub/metrics';
import { sourceDomain } from '@/lib/social-hub/sources';
import { verticalInfo } from '@/lib/social-hub/verticals';
import { displayName, when, whenInline } from '@/lib/social-hub/views/format';
import type { Offerer } from '@/lib/social-hub/views/offer';
import { typicalCurve, vsTypical } from '@/lib/social-hub/views/typical';
import type { HubPost, MetaGroup, MetricKey } from '@/lib/social-hub/types';

const GROUP_LABEL: Record<MetaGroup, string> = { content: 'Content', production: 'Production', scoring: 'Scoring', scheduling: 'Scheduling' };

/** The four numbers that matter most per format (BRIEFS.md §4); the rest sit under "All metrics". */
const KEY_METRICS: Record<HubPost['format'], MetricKey[]> = {
  reel: ['views', 'avgWatchTimeMs', 'shares', 'saved'],
  feed: ['views', 'reach', 'shares', 'saved'],
  story: ['reach', 'completion', 'replies', 'exitsFirst3'],
};

const EMPTY = new Set(['', '—', '-', 'n/a', 'null', 'undefined']);

/**
 * One post (BRIEFS.md §4), the same in the drawer and on its own page: its
 * state and what to do about it first, then the media, then its numbers
 * against what's typical for its type, then the history.
 */
export function PostView({ post, o, dataset }: { post: HubPost; o: Offerer; dataset: HubDataset }) {
  const { state, menu } = o.offer(post);
  const info = verticalInfo(post.vertical);
  const posted = post.status === 'published';
  const keys = KEY_METRICS[post.format].filter((k) => metricSpec(k).formats.includes(post.format));
  const rest = formatMetrics(post.format).filter((m) => !keys.includes(m.key));
  const views = postMetric(post, 'views');
  const time = post.postedAt ?? post.publishAt;
  const groups = (['content', 'production', 'scoring', 'scheduling'] as MetaGroup[])
    .map((group) => ({ group, fields: post.native.filter((f) => f.group === group && !EMPTY.has(f.value.trim().toLowerCase())) }))
    .filter((g) => g.fields.length > 0);
  const chartOptions = formatMetrics(post.format).map((m) => ({
    key: m.key,
    label: m.label,
    display: m.display,
    typical: typicalCurve(dataset.posts, post.vertical, m.key, o.now, post.history.length),
  }));

  return (
    <article className="sh-post" aria-labelledby={`post-${post.id}`}>
      <header className="sh-post__head">
        <div className="sh-post__tags">
          <TypeMark vertical={post.vertical} />
          <StateBadge state={state} />
        </div>
        <h2 className="sh-post__title" id={`post-${post.id}`}>{displayName(post)}</h2>
        <p className="sh-post__when">
          {time ? `${posted ? 'Posted' : state.id === 'late' ? 'Was due' : post.status === 'scheduled' ? 'Posts' : 'Slot'} ${whenInline(time, o.now)}` : 'Not scheduled'}
          {post.slot ? ` · ${post.slot.label}` : ''}
        </p>
        {state.line && state.id !== 'published' ? <p className={`sh-post__state${state.tone === 'failed' ? ' sh-post__state--failed' : ''}`}>{state.line}</p> : null}
        <ActionBar menu={menu} />
        <p className="sh-post__links">
          {post.permalink ? <a className="sh-out" href={post.permalink} target="_blank" rel="noreferrer">Open on Instagram <ArrowUpRight size={14} aria-hidden="true" /></a> : null}
          {/* One way out to the type's own page: skip this when the actions already link there. */}
          {info.href !== '/social' && !menu.links.some((l) => l.href.startsWith(info.href)) ? <a className="sh-out" href={post.pipelineHref}>Open in {info.label} <ArrowUpRight size={14} aria-hidden="true" /></a> : null}
        </p>
      </header>

      <section className="sh-post__media" aria-label="Media">
        <MediaPreview media={post.media} title={displayName(post)} />
      </section>

      <section className="sh-post__numbers" aria-labelledby={`numbers-${post.id}`}>
        <h3 className="sh-post__h" id={`numbers-${post.id}`}>Performance</h3>
        {posted ? (
          <>
            <dl className="sh-figures">
              {keys.map((k) => {
                const value = postMetric(post, k);
                const vs = vsTypical(value, o.typical(post.vertical, k), k);
                return (
                  <div key={k} className="sh-figure">
                    <dt>{metricSpec(k).label}</dt>
                    <dd>{formatMetricKey(value, k)}</dd>
                    <span className="sh-figure__vs">{vs ?? (value == null ? 'Not reported yet' : '')}</span>
                  </div>
                );
              })}
              <div className="sh-figure">
                <dt>Cost to make</dt>
                <dd>{formatUsd(post.costMicros)}</dd>
                <span className="sh-figure__vs">{views != null && post.costMicros ? `${formatMetric(perDollar(views, post.costMicros), 'count')} views per $` : post.costNote ? `Reused content, ${post.costNote}` : ''}</span>
              </div>
            </dl>
            {rest.length ? (
              <details className="sh-more">
                <summary>All metrics</summary>
                <dl className="sh-figures sh-figures--small">
                  {rest.map((m) => (
                    <div key={m.key} className="sh-figure">
                      <dt>{m.label}</dt>
                      <dd>{formatMetricKey(postMetric(post, m.key), m.key)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
          </>
        ) : (
          <p className="sh-muted">Not posted yet. Numbers appear about 48 hours after it posts.{post.costMicros != null ? ` Cost to make so far: ${formatUsd(post.costMicros)}.` : ''}</p>
        )}
      </section>

      {posted && post.history.length ? (
        <section className="sh-post__chart" aria-labelledby={`chart-${post.id}`}>
          <h3 className="sh-post__h" id={`chart-${post.id}`}>Over time</h3>
          <MetricChart key={post.id} history={post.history} options={chartOptions} initial={KEY_METRICS[post.format][0]!} accent={`var(--sh-v-${post.vertical})`} />
        </section>
      ) : null}

      <div className="sh-post__more">
        {/* The state line already names the last try; list tries here only when there's more to say. */}
        {post.tries?.length && (post.tries.length > 1 || !/^Last try/.test(state.line ?? '')) ? (
          <details className="sh-more">
            <summary>Earlier tries <span className="sh-count">{post.tries.length}</span></summary>
            <ul className="sh-plain">
              {post.tries.map((t, i) => <li key={i}><strong>{t.status === 'failed' ? 'Failed' : 'Didn’t post'}</strong> {t.at ? when(t.at, o.now) : ''}{t.note ? ` · ${t.note}` : ''}</li>)}
            </ul>
          </details>
        ) : null}
        {post.reviewNotes?.length ? (
          <details className="sh-more">
            <summary>Review notes <span className="sh-count">{post.reviewNotes.length}</span></summary>
            <ul className="sh-plain">{post.reviewNotes.map((n, i) => <li key={`${i}-${n}`}>{n}</li>)}</ul>
          </details>
        ) : null}
        {groups.length ? (
          <details className="sh-more">
            <summary>Details</summary>
            <div className="sh-meta">
              {groups.map(({ group, fields }) => (
                <div key={group} className="sh-meta__group">
                  <h4 className="sh-meta__h">{GROUP_LABEL[group]}</h4>
                  <dl className="sh-meta__list">
                    {fields.map((f) => (
                      <div key={`${group}-${f.label}`}>
                        <dt>{f.label}</dt>
                        <dd>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </details>
        ) : null}
        {post.versions.length > 1 ? (
          <details className="sh-more">
            <summary>Versions <span className="sh-count">{post.versions.length}</span></summary>
            <ol className="sh-plain">
              {[...post.versions].reverse().map((v) => (
                <li key={v.id}>{when(v.createdAt, o.now)} · {v.trigger}{v.current ? <span className="sh-chip">Current version</span> : null}</li>
              ))}
            </ol>
          </details>
        ) : null}
        {post.sources.length ? (
          <details className="sh-more">
            <summary>Sources <span className="sh-count">{post.sources.length}</span></summary>
            <ul className="sh-plain">
              {post.sources.map((s, i) => (
                <li key={`${i}-${s.url}`}>
                  <a className="sh-link" href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.url}</a>
                  <span className="sh-subtle"> · {sourceDomain(s.url)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </article>
  );
}
