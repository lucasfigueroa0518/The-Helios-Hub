/**
 * Nightly Postmaster writer.
 *
 * Reads the last three days because Google's data lags one to two days, and
 * records `no_data` as a first-class state rather than a zero, so the Inboxes
 * tab can say "below Google's reporting threshold" and the lifecycle can treat
 * silence as neutral.
 */
import { writeHealth } from '@/lib/inboxes/health';
import { activeDomains } from '@/lib/inboxes/repository';
import { getOrgSetting } from '@/lib/org-settings';
import {
  fetchTrafficStats,
  postmasterCredentials,
  trafficStatDay,
  type PostmasterCredentials,
} from '@/lib/postmaster/client';

/** Google's data lags; asking for three days backfills what arrived late. */
const LOOKBACK_DAYS = 3;

export type PostmasterSnapshotReport = {
  skipped?: true;
  detail?: string;
  day: string;
  domains: number;
  rowsWritten: number;
  noData: string[];
  errors: Array<{ domain: string; error: string }>;
};

export async function runPostmasterSnapshot(
  dayKey?: string,
  options: { credentials?: PostmasterCredentials | null } = {},
): Promise<PostmasterSnapshotReport> {
  const day = dayKey ?? new Date().toISOString().slice(0, 10);
  const credentials = options.credentials !== undefined
    ? options.credentials
    : postmasterCredentials();

  if (!credentials) {
    return {
      skipped: true,
      detail: 'POSTMASTER_CLIENT_ID/SECRET/REFRESH_TOKEN missing',
      day,
      domains: 0,
      rowsWritten: 0,
      noData: [],
      errors: [],
    };
  }

  const configured = await getOrgSetting<string[]>('postmaster.domains', []);
  const domains = [...new Set([...(await activeDomains()), ...configured])].filter(Boolean);

  const report: PostmasterSnapshotReport = {
    day,
    domains: domains.length,
    rowsWritten: 0,
    noData: [],
    errors: [],
  };

  const startDate = addDays(day, -LOOKBACK_DAYS);
  for (const domain of domains) {
    const result = await fetchTrafficStats(credentials, domain, startDate, day);

    if (result.status === 'no_data') {
      await writeHealth({
        day,
        scope: 'domain',
        scopeKey: domain,
        source: 'postmaster',
        status: 'no_data',
        detail: { reason: 'below_google_reporting_threshold', window: [startDate, day] },
      });
      report.noData.push(domain);
      report.rowsWritten += 1;
      continue;
    }

    if (result.status === 'error') {
      await writeHealth({
        day,
        scope: 'domain',
        scopeKey: domain,
        source: 'postmaster',
        status: 'error',
        detail: { error: result.detail },
      });
      report.errors.push({ domain, error: result.detail });
      report.rowsWritten += 1;
      continue;
    }

    for (const stats of result.stats) {
      await writeHealth({
        day: trafficStatDay(stats.name, day),
        scope: 'domain',
        scopeKey: domain,
        source: 'postmaster',
        status: 'ok',
        reputation: stats.domainReputation ?? null,
        spamRate: stats.userReportedSpamRatio ?? null,
        spfRatio: stats.spfSuccessRatio ?? null,
        dkimRatio: stats.dkimSuccessRatio ?? null,
        dmarcRatio: stats.dmarcSuccessRatio ?? null,
        detail: {
          ipReputations: stats.ipReputations ?? [],
          deliveryErrors: stats.deliveryErrors ?? [],
          spammyFeedbackLoops: stats.spammyFeedbackLoops ?? [],
          outboundEncryptionRatio: stats.outboundEncryptionRatio ?? null,
        },
      });
      report.rowsWritten += 1;
    }
  }

  return report;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}
