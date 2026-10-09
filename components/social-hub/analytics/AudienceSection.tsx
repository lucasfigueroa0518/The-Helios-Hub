import type { AccountSummary } from '@/lib/social-hub/account';
import { formatMetric } from '@/lib/social-hub/metrics';
import { WEEKDAY_SHORT } from '@/lib/social-hub/time';
import { relative } from '@/lib/social-hub/views/format';

const BREAKDOWN_LABEL: Record<string, string> = { age: 'Age', gender: 'Gender', country: 'Country', city: 'City' };

/**
 * The whole account, not just our pipeline posts (Instagram's account
 * insights): shown only once the nightly sweep has collected it. Neutral
 * bars and a neutral heat ramp; orange is for actions.
 */
export function AudienceSection({ summary }: { summary: AccountSummary }) {
  const count = (v: number | null) => formatMetric(v, 'count');
  const max = summary.online ? Math.max(...summary.online.flat(), 1) : 1;
  const figures = [
    { label: 'Accounts reached', value: count(summary.reach) },
    { label: 'Views, all content', value: count(summary.views) },
    { label: 'Reach from followers', value: formatMetric(summary.followerShare, 'rate') },
    { label: 'Net follows', value: summary.netFollows == null ? '—' : `${summary.netFollows >= 0 ? '+' : '−'}${count(Math.abs(summary.netFollows))}` },
    { label: 'Link-in-bio taps', value: count(summary.linkTaps) },
    ...(summary.followerCount != null ? [{ label: 'Followers', value: count(summary.followerCount) }] : []),
  ].slice(0, 6);
  return (
    <section className="sh-section" aria-labelledby="audience">
      <div className="sh-section__head">
        <h2 className="sh-title" id="audience">Audience</h2>
        <span className="sh-subtle">The whole account, from Instagram · {summary.days} days{summary.lastRefresh ? ` · updated ${relative(summary.lastRefresh, new Date())}` : ''}</span>
      </div>
      <div className="sh-panel sh-panel__body sh-audience">
        <dl className="sh-figures">
          {figures.map((f) => (
            <div key={f.label} className="sh-figure"><dt>{f.label}</dt><dd>{f.value}</dd></div>
          ))}
        </dl>
        {summary.demographics.length ? (
          <div className="sh-demo">
            {summary.demographics.map((d) => (
              <div key={d.breakdown}>
                <h3 className="sh-meta__h">{BREAKDOWN_LABEL[d.breakdown] ?? d.breakdown}</h3>
                <ul className="sh-demo__list">
                  {d.rows.map((r) => (
                    <li key={r.key}>
                      <span className="sh-demo__key">{r.key}</span>
                      <span className="sh-bar sh-bar--wide" aria-hidden="true"><span style={{ width: `${Math.max(2, r.share * 100)}%` }} /></span>
                      <span className="sh-num">{formatMetric(r.share, 'rate')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
        {summary.online ? (
          <details className="sh-more">
            <summary>When followers are online</summary>
            <div className="sh-table-wrap" role="region" aria-label="When followers are online" tabIndex={0}>
              <table className="sh-heat">
                <thead><tr><th scope="col"><span className="sh-sr">Day</span></th>{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col">{h % 3 === 0 ? h : ''}</th>)}</tr></thead>
                <tbody>
                  {summary.online.map((hours, w) => (
                    <tr key={w}>
                      <th scope="row">{WEEKDAY_SHORT[w]}</th>
                      {hours.map((v, h) => (
                        <td key={h} style={{ background: `color-mix(in srgb, var(--color-text) ${Math.round((v / max) * 70)}%, var(--color-surface))` }}>
                          <span className="sh-sr">{`${WEEKDAY_SHORT[w]} ${h}:00, ${Math.round(v)} online`}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="sh-subtle">Average followers online by hour, last 30 days, in the hours Instagram reports.</p>
          </details>
        ) : null}
      </div>
    </section>
  );
}
