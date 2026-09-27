// scripts/social_random_article.ts — pick one random article from the queue
// with enough shape (people/companies/relevance) to build a carousel from.

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
    url: string | null;
    published_at: string | null;
    story_type: string | null;
    relevance_score: string | null;
    relevance_reason: string | null;
    people: unknown;
    companies: unknown;
    products: unknown;
    topics: unknown;
    notable_number: string | null;
    bullets: unknown;
    body: string | null;
  }>(
    `SELECT source, headline, source_url AS url, published_at,
            NULL::text AS story_type,
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
        AND relevance_score >= 0.7
        AND companies IS NOT NULL
        AND jsonb_array_length(companies) > 0
      ORDER BY random()
      LIMIT 1`,
  );

  console.log(JSON.stringify(rows[0] ?? null, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('[social_random_article] Fatal:', err);
  process.exit(1);
});
