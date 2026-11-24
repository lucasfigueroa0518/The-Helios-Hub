/**
 * Third seed pass: JSON documents whose shape is easiest to get right with the
 * app's own builders. Local loopback databases only.
 *   source perf/env.sh && npx tsx perf/db/seed-shapes.ts
 */
import pg from 'pg';

import { emptyReport } from '@/lib/social-hub/health/reporters/shared';
import { nightsEnding } from '@/lib/social-hub/health/time';
import type { NightReport } from '@/lib/social-hub/health/types';
import { nightVerdict } from '@/lib/social-hub/health/verdict';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';

const url = process.env.DATABASE_URL ?? '';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error('Refusing: DATABASE_URL must be a loopback database (source perf/env.sh).');

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  // Social Hub health: one stored report per night for the last 120 nights.
  const today = new Date().toISOString().slice(0, 10);
  await client.query('DELETE FROM social_hub.health_reports');
  for (const night of nightsEnding(today, 120)) {
    const reports: NightReport[] = VERTICAL_IDS.map((v, i) => ({
      ...emptyReport(v, night), due: true, ran: true, target: 2, made: (i + night.length) % 5 === 0 ? 1 : 2, needed: 2, ready: 2,
      scheduledYesterday: 2, postedYesterday: 2, spendUsd: 1.8,
    }));
    const verdict = nightVerdict(night, reports, 'worked');
    await client.query(
      'INSERT INTO social_hub.health_reports (night, built_at, verdict, reports, failures) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [night, `${night}T11:30:00Z`, JSON.stringify(verdict), JSON.stringify(reports), '[]'],
    );
  }
  // Client dashboards: context updates carry { bullets: [{ text, sources: [{ eventId }] }] }.
  await client.query(`
    UPDATE dashboards.context_updates u SET bullets = jsonb_build_object('bullets', (
      SELECT jsonb_agg(jsonb_build_object('text', 'Shipped work item ' || g || ' for this client.',
               'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('eventId', e.id)) FROM (
                  SELECT id FROM dashboards.repo_events r WHERE r.project_id = u.project_id ORDER BY r.id LIMIT 2 OFFSET g) e), '[]'::jsonb)))
        FROM generate_series(1, 4) g))`);
  await client.end();
  console.log('shape fixtures ready');
}
main().catch((e) => { console.error(e); process.exit(1); });
