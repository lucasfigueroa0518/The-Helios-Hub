import type { HubQuery } from '@/lib/social-hub/db';
import type { StoredReport } from '@/lib/social-hub/health/types';

export async function saveReport(q: HubQuery, r: StoredReport, mode: 'replace' | 'missing-only'): Promise<void> {
  await q(
    `INSERT INTO social_hub.health_reports (night, built_at, verdict, reports, failures)
     VALUES ($1::date, $2::timestamptz, $3::jsonb, $4::jsonb, $5::jsonb)
     ON CONFLICT (night) DO ${mode === 'replace' ? 'UPDATE SET built_at = EXCLUDED.built_at, verdict = EXCLUDED.verdict, reports = EXCLUDED.reports, failures = EXCLUDED.failures' : 'NOTHING'}`,
    [r.night, r.builtAt, JSON.stringify(r.verdict), JSON.stringify(r.reports), JSON.stringify(r.failures)],
  );
}

export async function readReports(q: HubQuery, from: string, to: string): Promise<StoredReport[]> {
  const { rows } = await q<{ night: string; built_at: string; verdict: StoredReport['verdict']; reports: StoredReport['reports']; failures: StoredReport['failures'] }>(
    `SELECT to_char(night, 'YYYY-MM-DD') AS night, built_at::text, verdict, reports, failures
       FROM social_hub.health_reports WHERE night >= $1::date AND night <= $2::date ORDER BY night`,
    [from, to],
  );
  return rows.map((r) => ({ night: r.night, builtAt: new Date(r.built_at).toISOString(), verdict: r.verdict, reports: r.reports, failures: r.failures }));
}

export async function storedNights(q: HubQuery, from: string, to: string): Promise<Set<string>> {
  const { rows } = await q<{ night: string }>(
    `SELECT to_char(night, 'YYYY-MM-DD') AS night FROM social_hub.health_reports WHERE night >= $1::date AND night <= $2::date`,
    [from, to],
  );
  return new Set(rows.map((r) => r.night));
}
