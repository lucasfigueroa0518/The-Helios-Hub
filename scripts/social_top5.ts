// scripts/social_top5.ts — Read-only diagnostic query.
// Prints the top 5 scored articles with the LLM's reasoning so we can
// audit rubric behavior without touching the API.

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

async function main() {
  const { dbQuery } = await import('../lib/db');
  const { rows } = await dbQuery<{
    source: string;
    headline: string;
    byline: string | null;
    relevance_score: string | null;
    relevance_reason: string | null;
    people: string[] | null;
    companies: string[] | null;
    products: string[] | null;
    topics: string[] | null;
    notable_number: string | null;
    bullets: string[] | null;
    ingest_status: string;
  }>(
    `SELECT source, headline, byline, relevance_score, relevance_reason,
            people, companies, products, topics, notable_number, bullets,
            ingest_status
       FROM helios_social.article_queue
      ORDER BY relevance_score DESC NULLS LAST, published_at DESC NULLS LAST
      LIMIT 5`,
  );

  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('[social_top5] Fatal:', err);
  process.exit(1);
});
