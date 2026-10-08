import type { AccountSummary } from '@/lib/social-hub/account';
import { formatMetric } from '@/lib/social-hub/metrics';
import { dateTimeLabel, WEEKDAY_SHORT } from '@/lib/social-hub/time';

const BREAKDOWN_LABEL: Record<string, string> = { age: 'Age', gender: 'Gender', country: 'Country', city: 'City' };

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="sh-tile">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {sub ? <span className="sh-subtle">{sub}</span> : null}
    </div>
  );
}

/** Profile analytics (spec §5.1) from the social_hub tables, trimmed to META_API_CHECK. */
export function AccountSection({ summary }: { summary: AccountSummary }) {
  const count = (v: number | null) => formatMetric(v, 'count');
  const max = summary.online ? Math.max(...summary.online.flat(), 1) : 1;
  return (
    <>
      <section className="sh-card">
        <header className="sh-card__head">
          <h2 className="sh-card__title">Account</h2>
          <span className="sh-muted">{summary.days} days collected{summary.lastRefresh ? ` · refreshed ${dateTimeLabel(summary.lastRefresh)} ET` : ''}</span>
        </header>
        <div className="sh-card__body">
          <dl className="sh-tiles">
            <Tile label="Accounts reached" value={count(summary.reach)} sub="summed daily" />
            <Tile label="Views" value={count(summary.views)} sub="summed daily" />
            <Tile label="Follower share of reach" value={formatMetric(summary.followerShare, 'rate')} sub="followers ÷ (followers + non-followers)" />
            <Tile label="Accounts engaged" value={count(summary.accountsEngaged)} sub="summed daily" />
            <Tile label="Interactions" value={count(summary.interactions)} sub="summed daily" />
            <Tile label="Link-in-bio taps" value={count(summary.linkTaps)} sub="summed daily" />
            <Tile label="Net follows" value={summary.netFollows == null ? '—' : `${summary.netFollows >= 0 ? '+' : ''}${count(summary.netFollows)}`} sub="follows − unfollows" />
            {summary.followerCount != null ? <Tile label="Followers" value={count(summary.followerCount)} sub="latest" /> : null}
          </dl>
        </div>
      </section>
      {summary.demographics.length ? (
        <section className="sh-card">
          <header className="sh-card__head"><h2 className="sh-card__title">Followers by group</h2><span className="sh-muted">Meta&apos;s top groups, latest snapshot</span></header>
          <div className="sh-card__body sh-demo">
            {summary.demographics.map((d) => (
              <div key={d.breakdown}>
                <h3 className="sh-meta__h">{BREAKDOWN_LABEL[d.breakdown] ?? d.breakdown}</h3>
                <ul className="sh-demo__list">
                  {d.rows.map((r) => (
                    <li key={r.key}>
                      <span>{r.key}</span>
                      <span className="sh-bars__track" aria-hidden="true"><span className="sh-bars__bar sh-demo__bar" style={{ width: `${Math.max(2, r.share * 100)}%` }} /></span>
                      <span className="sh-num">{formatMetric(r.share, 'rate')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {summary.online ? (
        <section className="sh-card">
          <header className="sh-card__head"><h2 className="sh-card__title">Most active times</h2><span className="sh-muted">Average online followers, last 30 days (hour as Meta reports it)</span></header>
          <div className="sh-card__body sh-table-wrap" role="region" aria-label="Most active times" tabIndex={0}>
            <table className="sh-heat">
              <thead><tr><th scope="col"><span className="sh-sr">Day</span></th>{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {summary.online.map((hours, w) => (
                  <tr key={w}>
                    <th scope="row">{WEEKDAY_SHORT[w]}</th>
                    {hours.map((v, h) => (
                      <td key={h} title={`${WEEKDAY_SHORT[w]} ${h}:00 · ${Math.round(v)}`} style={{ background: `color-mix(in srgb, var(--color-primary) ${Math.round((v / max) * 85)}%, var(--color-surface))` }}>
                        <span className="sh-sr">{Math.round(v)}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
