import type { ReactNode } from 'react';

import { formatUsd, perDollar } from '@/lib/social-hub/cost';
import { formatMetric, formatMetricKey, formatMetrics, postMetric } from '@/lib/social-hub/metrics';
import { sourceDomain } from '@/lib/social-hub/sources';
import { dateTimeLabel } from '@/lib/social-hub/time';
import { FORMAT_LABEL, verticalInfo } from '@/lib/social-hub/verticals';
import type { HubPost, MetaGroup } from '@/lib/social-hub/types';

import { StatusBadge, VerticalTag } from './marks';
import { MediaPreview } from './MediaPreview';
import { MetricChart } from './MetricChart';

const GROUP_LABEL: Record<MetaGroup, string> = {
  content: 'Content',
  production: 'Production',
  scoring: 'Scoring',
  scheduling: 'Scheduling',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sh-post__section">
      <h3 className="sh-post__h">{title}</h3>
      {children}
    </section>
  );
}

function approvalText(post: HubPost): string {
  const { approval } = post;
  if (approval.approvedAt) return `${approval.note ?? 'Approved'} · ${dateTimeLabel(approval.approvedAt)}`;
  if (post.status === 'published') return approval.note ?? 'Posted';
  if (approval.required) return approval.note && approval.note !== 'Approved' ? approval.note : 'Needs a person’s approval before it posts';
  return approval.note ?? 'No approval needed';
}

/**
 * The single-post view (spec §6, SH-26). The same component in the drawer,
 * on /social/post/[id], and from every list. `actions` is the Content House
 * slot for flagged buttons (M6); the view itself is read-only (SH-13).
 */
export function PostView({ post, actions }: { post: HubPost; actions?: ReactNode }) {
  const info = verticalInfo(post.vertical);
  const metrics = formatMetrics(post.format);
  const views = postMetric(post, 'views');
  const shares = postMetric(post, 'shares');
  const slotWasMissed = post.status === 'failed' || post.status === 'cancelled' || post.status === 'skipped';
  const when = post.postedAt
    ? `Posted ${dateTimeLabel(post.postedAt)} ET`
    : post.publishAt
      ? `${slotWasMissed ? 'Slot was' : 'Scheduled for'} ${dateTimeLabel(post.publishAt)} ET`
      : post.nyDate ? `Day ${post.nyDate}` : 'Not scheduled';
  const groups = (['content', 'production', 'scoring', 'scheduling'] as MetaGroup[])
    .map((group) => ({ group, fields: post.native.filter((f) => f.group === group) }))
    .filter((g) => g.fields.length > 0);

  return (
    <article className="sh-post" aria-labelledby={`post-${post.id}`}>
      <header className="sh-post__head">
        <div className="sh-post__tags">
          <VerticalTag vertical={post.vertical} />
          <span className="sh-subtle">{FORMAT_LABEL[post.format]}</span>
          <StatusBadge post={post} />
        </div>
        <h2 className="sh-post__title" id={`post-${post.id}`}>{post.name}</h2>
        {post.description ? <p className="sh-muted sh-post__desc">{post.description}</p> : null}
        <p className="sh-post__when">
          {when}
          {post.slot ? <> · {post.slot.label}</> : null}
        </p>
        {post.statusNote ? <p className="sh-note">{post.statusNote}</p> : null}
        <p className="sh-post__links">
          {post.permalink ? <a className="sh-link" href={post.permalink} target="_blank" rel="noreferrer">Open on Instagram ↗</a> : null}
          <a className="sh-link" href={post.pipelineHref}>Open in {info.label}</a>
        </p>
      </header>

      <div className="sh-post__grid">
        <div className="sh-post__media">
          <MediaPreview media={post.media} title={post.name} />
        </div>

        <div className="sh-post__side">
          <Section title="Performance">
            <dl className="sh-stats">
              {metrics.map((m) => (
                <div key={m.key} className="sh-stat">
                  <dt>{m.label}</dt>
                  <dd>{formatMetricKey(postMetric(post, m.key), m.key)}</dd>
                </div>
              ))}
            </dl>
            <p className="sh-subtle">Latest lifetime totals. A blank means Meta hasn&apos;t reported it yet.</p>
          </Section>

          <Section title="Cost to make">
            <dl className="sh-stats">
              <div className="sh-stat sh-stat--wide">
                <dt>Cost</dt>
                <dd>{formatUsd(post.costMicros)}</dd>
              </div>
              <div className="sh-stat">
                <dt>Views per $</dt>
                <dd>{formatMetric(perDollar(views, post.costMicros), 'count')}</dd>
              </div>
              <div className="sh-stat">
                <dt>Shares per $</dt>
                <dd>{formatMetric(perDollar(shares, post.costMicros), 'count')}</dd>
              </div>
            </dl>
            {post.costNote ? <p className="sh-subtle">Reused content, {post.costNote}. Posting it later added nothing.</p> : null}
            {post.costMicros == null ? <p className="sh-subtle">No spend recorded for this content yet.</p> : null}
          </Section>

          <Section title="Approval">
            <p>{approvalText(post)}</p>
            {post.reviewNotes?.length ? (
              <ul className="sh-notes">
                {post.reviewNotes.map((note, i) => <li key={`${i}-${note}`}>{note}</li>)}
              </ul>
            ) : null}
            {actions}
          </Section>
        </div>
      </div>

      <Section title="Metrics over time">
        <MetricChart
          key={post.id}
          history={post.history}
          options={metrics.map((m) => ({ key: m.key, label: m.label, display: m.display }))}
          initial="views"
        />
      </Section>

      <Section title="Details">
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
      </Section>

      {post.versions.length > 0 ? (
        <Section title="Version history">
          <ol className="sh-versions">
            {[...post.versions].reverse().map((v) => (
              <li key={v.id} className={v.current ? 'sh-versions__current' : undefined}>
                <span>{dateTimeLabel(v.createdAt)}</span>
                <span className="sh-muted">{v.trigger}</span>
                <span className="sh-muted">{v.status}</span>
                {v.current ? <span className="sh-status sh-status--ready">Current, the one that posts</span> : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {post.sources.length > 0 ? (
        <Section title="Sources">
          <ul className="sh-sources">
            {post.sources.map((s, i) => (
              <li key={`${i}-${s.url}`}>
                <a className="sh-link" href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.url}</a>
                <span className="sh-subtle"> · {sourceDomain(s.url)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </article>
  );
}
