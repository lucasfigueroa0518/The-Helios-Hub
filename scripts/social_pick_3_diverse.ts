// scripts/social_pick_3_diverse.ts — Pick 3 random high-scored queue
// articles across DIFFERENT primary subjects. Ensures cross-carousel
// diversity — no all-OpenAI, all-Anthropic runs.

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

type Row = {
  source: string;
  headline: string;
  url: string;
  published_at: string;
  relevance_score: string;
  relevance_reason: string;
  people: string[] | null;
  companies: string[] | null;
  products: string[] | null;
  topics: string[] | null;
  notable_number: string | null;
  bullets: string[] | null;
  body: string;
};

async function main() {
  const { dbQuery } = await import('../lib/db');

  // Fetch a wide candidate pool — 30 top-scored articles — then in-app
  // dedupe by "primary company" so the final 3 are on distinct actors.
  const { rows } = await dbQuery<Row>(
    `SELECT source, headline, source_url AS url, published_at::text,
            relevance_score::text, relevance_reason,
            people::text::jsonb AS people,
            companies::text::jsonb AS companies,
            products::text::jsonb AS products,
            topics::text::jsonb AS topics,
            notable_number,
            bullets::text::jsonb AS bullets,
            body
       FROM helios_social.article_queue
      WHERE relevance_score IS NOT NULL
        AND relevance_score >= 0.65
        AND companies IS NOT NULL
        AND jsonb_array_length(companies) > 0
      ORDER BY relevance_score DESC, published_at DESC
      LIMIT 30`,
  );

  const seenPrimary = new Set<string>();
  const picks: Row[] = [];

  // First pass: strict — one story per distinct primary company.
  for (const r of rows) {
    const primary = (r.companies?.[0] ?? '').toLowerCase();
    if (!primary) continue;
    if (seenPrimary.has(primary)) continue;
    seenPrimary.add(primary);
    picks.push(r);
    if (picks.length >= 3) break;
  }

  if (picks.length < 3) {
    // Second pass: relax the constraint if fewer than 3 distinct
    // companies exist in the top 30.
    for (const r of rows) {
      if (picks.includes(r)) continue;
      picks.push(r);
      if (picks.length >= 3) break;
    }
  }

  console.log(JSON.stringify(picks, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('[social_pick_3_diverse] Fatal:', err);
  process.exit(1);
});
