// scripts/social_topics_audit.ts — Read-only. Prints every approved article
// on the batch board with its Haiku-assigned topics, so we can see where the
// topic labels are landing loosely.

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
    relevance_score: string | null;
    topics: string[] | null;
    companies: string[] | null;
    people: string[] | null;
  }>(
    `SELECT source, headline, relevance_score, topics, companies, people
       FROM helios_social.article_queue
      WHERE ingest_status IN ('approved_for_draft','drafted')
      ORDER BY relevance_score DESC NULLS LAST, published_at DESC NULLS LAST
      LIMIT 30`,
  );

  console.log(`\nTotal approved: ${rows.length}\n`);
  console.log('─'.repeat(90));
  for (const [i, r] of rows.entries()) {
    const topics = (r.topics ?? []).join(', ') || '(none)';
    const entities = [
      ...(r.companies ?? []),
      ...(r.people ?? []),
    ].join(', ') || '(none)';
    console.log(`${(i + 1).toString().padStart(2)}. [${r.relevance_score ?? '?'}] ${r.source}`);
    console.log(`    ${r.headline.slice(0, 100)}`);
    console.log(`    topics:   ${topics}`);
    console.log(`    entities: ${entities}`);
    console.log('');
  }

  // Also tally topic frequency
  const topicCount = new Map<string, number>();
  for (const r of rows) {
    for (const t of r.topics ?? []) {
      topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
    }
  }
  console.log('─'.repeat(90));
  console.log('\nTopic frequency across the batch:');
  const sorted = [...topicCount.entries()].sort((a, b) => b[1] - a[1]);
  for (const [t, count] of sorted) {
    console.log(`  ${count.toString().padStart(3)}  ${t}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[social_topics_audit] Fatal:', err);
  process.exit(1);
});
