import Link from 'next/link';

import { CopyBrief } from '@/components/social-hub/health/ProblemsList';
import { Breadcrumbs } from '@/components/social-hub/nav/Breadcrumbs';
import { PageHead } from '@/components/social-hub/ui/PageHead';
import { REASON_LABEL, stageLabel } from '@/lib/social-hub/health/reasons';
import type { CheckId, StoredReport, Tone } from '@/lib/social-hub/health/types';
import { cardDay, eyebrowDay, NIGHT_LOOKBACK, nightRecurrence } from '@/lib/social-hub/health/view';
import { dateTimeLabel, timeLabel } from '@/lib/social-hub/time';
import { VERTICALS } from '@/lib/social-hub/verticals';
import { crumbsFor } from '@/lib/social-hub/views/nav';

const WORD: Record<Tone, string> = { worked: 'Worked', short: 'Short', failed: 'Failed', none: "Didn't run" };
const CHECK_LABEL: Record<CheckId, string> = { made: 'Made', ready: 'Ready', posted: 'Posted', plumbing: 'Plumbing' };
const PUBLISHER: Record<Tone, string> = { worked: 'Publisher alive', failed: 'Publisher stopped', short: 'Publisher unsteady', none: 'No publisher heartbeat recorded' };

/**
 * One night, type by type: verdict, the four checks, the funnel, and every failure with its raw error.
 * `history` is the stored reports for the 14 nights ending at this one: each failure says how often it
 * was seen there (linking the other nights), and its Copy for Claude brief covers all of them.
 */
export function NightDetail({ report, history, base }: { report: StoredReport; history: readonly StoredReport[]; base: string }) {
  const seen = nightRecurrence(report.night, history.some((h) => h.night === report.night) ? history : [...history, report]);
  const v = report.verdict;
  return (
    <div className="sh-ops">
      <Breadcrumbs crumbs={crumbsFor(base, `${base}/health/night/${report.night}`)} />
      <PageHead
        title={`Night of ${eyebrowDay(report.night)}`}
        meta={<>{v.worked} of {v.total} worked · {PUBLISHER[v.publisher]} · report built {dateTimeLabel(report.builtAt)}</>}
      />
      {VERTICALS.map((info) => {
        const r = report.reports.find((x) => x.vertical === info.id);
        if (!r) return null;
        const t = v.types.find((x) => x.vertical === info.id);
        const tone = t?.tone ?? 'none';
        const broken = r.funnel.find((step) => r.failures.some((f) => f.stage === step.stage && f.severity === 'failed'))?.stage
          ?? r.funnel.find((step) => r.failures.some((f) => f.stage === step.stage))?.stage;
        return (
          <section key={info.id} className="sh-ops-panel sh-ops-type" aria-labelledby={`n-${info.id}`}>
            <div className="sh-ops-type__head">
              <h2 id={`n-${info.id}`}><i className="sh-ops-mark" style={{ background: `var(${info.colorVar})` }} aria-hidden />{info.label}</h2>
              <span className={`sh-ops-pill is-${tone}`}>{WORD[tone]}</span>
            </div>
            {t?.cause ? <p className="sh-ops-meta">{t.cause}</p> : null}
            {t?.checks.length ? (
              <dl className="sh-ops-checks">
                {t.checks.map((c) => (
                  <div key={c.id} className={`is-${c.tone}`}>
                    <dt>{CHECK_LABEL[c.id]}</dt>
                    <dd>{c.note}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {r.funnel.length > 0 && (
              <ol className="sh-ops-funnel" aria-label="Funnel">
                {r.funnel.map((step) => (
                  <li key={step.stage} className={step.stage === broken ? 'is-failed' : undefined}>
                    {stageLabel(step.stage)} <b>{step.in} → {step.out}</b>
                  </li>
                ))}
              </ol>
            )}
            {r.failures.length > 0 && (
              <ul className="sh-ops-failures">
                {r.failures.map((f, i) => {
                  const key = `${f.vertical}|${f.stage}|${f.reason}`;
                  const rec = seen.get(key);
                  return (
                    <li key={`${key}|${f.at}|${i}`}>
                      <div className="sh-ops-failures__line">
                        <span className={`sh-ops-dot is-${f.severity === 'failed' ? 'failed' : 'short'}`} aria-hidden />
                        <b>{stageLabel(f.stage)}</b>
                        <span>{REASON_LABEL[f.reason] ?? f.reason}</span>
                        {f.item ? (f.item.href ? <a className="sh-ops-link" href={f.item.href}>{f.item.label}</a> : <span>{f.item.label}</span>) : null}
                        <span className="sh-ops-num">{timeLabel(f.at)}</span>
                        {f.spentUsd != null ? <span className="sh-ops-num">${f.spentUsd.toFixed(2)} spent so far</span> : null}
                        <CopyBrief text={rec?.brief ?? ''} />
                      </div>
                      {rec ? (
                        <p className="sh-ops-meta">
                          Seen <span className="sh-ops-num">{rec.count}</span> {rec.count === 1 ? 'time' : 'times'} in {NIGHT_LOOKBACK} nights
                          {rec.others.map((n, j) => (
                            <span key={n}>
                              {j === 0 ? ' · ' : ', '}
                              <Link className="sh-ops-link" href={`${base}/health/night/${n}`} prefetch={false}>{cardDay(n)}</Link>
                            </span>
                          ))}
                        </p>
                      ) : null}
                      {f.rawError ? (
                        <details className="sh-more">
                          <summary>Raw error</summary>
                          <pre className="sh-ops-raw">{f.rawError}</pre>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {r.reportError ? <p className="sh-ops-meta">Couldn&apos;t read this type&apos;s data: {r.reportError}</p> : null}
          </section>
        );
      })}
    </div>
  );
}
