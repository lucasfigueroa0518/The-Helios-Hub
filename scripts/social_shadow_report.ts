// scripts/social_shadow_report.ts — Reads the judge_shadow_ledger and reports
// the Jev-vs-Haiku A/B comparison: agreement rate, cost delta, and a sample
// of the most recent disagreements. Read-only, no LLM calls.
//
// Run:
//   npx tsx scripts/social_shadow_report.ts

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\r$/, '');
  }
}

type Stats = {
  total: string;
  agreements: string;
  prod_approved_shadow_rejected: string;
  prod_rejected_shadow_approved: string;
  total_shadow_cost: string;
};

type Disagreement = {
  headline: string;
  source: string;
  production_score: string;
  shadow_score: string;
  shadow_reason: string;
  production_approved: boolean;
  shadow_would_approve: boolean;
};

async function main() {
  const { dbQuery } = await import('../lib/db');

  const { rows: statsRows } = await dbQuery<Stats>(
    `SELECT COUNT(*)::text AS total,
            SUM(CASE WHEN agrees_with_production THEN 1 ELSE 0 END)::text AS agreements,
            SUM(CASE WHEN production_approved AND NOT shadow_would_approve THEN 1 ELSE 0 END)::text AS prod_approved_shadow_rejected,
            SUM(CASE WHEN NOT production_approved AND shadow_would_approve THEN 1 ELSE 0 END)::text AS prod_rejected_shadow_approved,
            COALESCE(SUM(shadow_cost_usd), 0)::text AS total_shadow_cost
       FROM helios_social.judge_shadow_ledger`,
  );

  const stats = statsRows[0];
  const total = Number(stats?.total ?? 0);

  console.log('===== SHADOW LEDGER REPORT =====');
  console.log(`Total shadow judgments: ${total}`);
  if (total === 0) {
    console.log(
      '(No shadow data yet. Enable with HELIOS_SOCIAL_SHADOW_HAIKU_JUDGE=1 in .env.local, then run an ingest.)',
    );
    process.exit(0);
  }

  const agreements = Number(stats.agreements);
  const rate = (agreements / total) * 100;
  const approvedRejected = Number(stats.prod_approved_shadow_rejected);
  const rejectedApproved = Number(stats.prod_rejected_shadow_approved);

  console.log(`Agreement rate: ${rate.toFixed(1)}%  (${agreements} of ${total})`);
  console.log(`Disagreements: ${total - agreements}`);
  console.log(`  - Prod approved, shadow would REJECT: ${approvedRejected}`);
  console.log(`  - Prod rejected, shadow would APPROVE: ${rejectedApproved}`);
  console.log(`Total Haiku shadow cost: $${Number(stats.total_shadow_cost).toFixed(4)}`);
  console.log('');

  const { rows: disagreements } = await dbQuery<Disagreement>(
    `SELECT aq.headline, aq.source,
            l.production_score::text, l.shadow_score::text,
            COALESCE(l.shadow_reason, '') AS shadow_reason,
            l.production_approved, l.shadow_would_approve
       FROM helios_social.judge_shadow_ledger l
       JOIN helios_social.article_queue aq ON aq.id = l.article_id
      WHERE NOT l.agrees_with_production
      ORDER BY l.created_at DESC
      LIMIT 10`,
  );

  if (disagreements.length === 0) {
    console.log('No disagreements to sample. (Perfect agreement on all shadowed articles.)');
    process.exit(0);
  }

  console.log('===== RECENT DISAGREEMENTS (last 10) =====');
  for (const d of disagreements) {
    const direction = d.production_approved && !d.shadow_would_approve
      ? '[PROD YES, SHADOW NO]'
      : '[PROD NO, SHADOW YES]';
    console.log(`${direction} ${d.source}: ${d.headline.slice(0, 80)}`);
    console.log(`  prod: ${Number(d.production_score).toFixed(2)}  |  shadow: ${Number(d.shadow_score).toFixed(2)}`);
    console.log(`  shadow reason: ${d.shadow_reason.slice(0, 120)}`);
    console.log('');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[social_shadow_report] Fatal:', err);
  process.exit(1);
});
