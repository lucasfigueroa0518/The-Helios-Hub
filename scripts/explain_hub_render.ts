/**
 * Read-only plans for the hub render selects. One client, one transaction,
 * no session SET. Prints sizes and EXPLAIN (ANALYZE, BUFFERS) only.
 *
 *   npx tsx scripts/explain_hub_render.ts
 */
import { loadEnvConfig } from '@next/env';
import pg from 'pg';

import { AI_EVENTS_POSTS_SQL } from '@/lib/social-hub/queries/ai-events';
import { CAROUSEL_IDEAS_SQL, CAROUSEL_POSTS_SQL } from '@/lib/social-hub/queries/carousels';
import { EXPLAINER_JOBS_SQL } from '@/lib/social-hub/queries/explainers';
import { LFD_LATEST_RUN_SQL, LFD_POSTS_SQL } from '@/lib/social-hub/queries/last-few-days';

loadEnvConfig(process.cwd());

const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DIRECT_DATABASE_URL or DATABASE_URL is not set');

const STATEMENTS: Array<[string, string]> = [
  ['carousel posts', CAROUSEL_POSTS_SQL],
  ['carousel ideas', CAROUSEL_IDEAS_SQL],
  ['lfd posts', LFD_POSTS_SQL],
  ['lfd latest run', LFD_LATEST_RUN_SQL],
  ['ai events posts', AI_EVENTS_POSTS_SQL],
  ['explainer jobs', EXPLAINER_JOBS_SQL],
];

const SIZES = `
SELECT 'carousels.render' AS src, count(*)::int AS n,
       coalesce(sum(octet_length(render::text)), 0)::bigint AS bytes,
       coalesce(max(octet_length(render::text)), 0)::bigint AS max_bytes
  FROM social.posts WHERE origin = 'pipeline'
UNION ALL
SELECT 'lfd.render', count(*)::int, coalesce(sum(octet_length(render::text)), 0)::bigint, coalesce(max(octet_length(render::text)), 0)::bigint FROM lfd.posts
UNION ALL
SELECT 'lfd.stories', count(*)::int, coalesce(sum(octet_length(stories::text)), 0)::bigint, coalesce(max(octet_length(stories::text)), 0)::bigint FROM lfd.posts
UNION ALL
SELECT 'lfd.run', count(*)::int, coalesce(sum(octet_length(record::text)), 0)::bigint, coalesce(max(octet_length(record::text)), 0)::bigint
  FROM (SELECT record FROM lfd.runs WHERE status IN ('ok', 'partial') ORDER BY COALESCE(started_at, requested_at) DESC LIMIT 1) s
UNION ALL
SELECT 'ai_events.render', count(*)::int, coalesce(sum(octet_length(render::text)), 0)::bigint, coalesce(max(octet_length(render::text)), 0)::bigint FROM ai_events.posts
UNION ALL
SELECT 'carousel.run', count(*)::int, coalesce(sum(octet_length(record::text)), 0)::bigint, coalesce(max(octet_length(record::text)), 0)::bigint
  FROM (
    SELECT record FROM social.runs
     WHERE kind = 'daily' AND jsonb_typeof(record->'selection'->'shortlist') = 'array'
     ORDER BY started_at DESC NULLS LAST LIMIT 1
  ) s
UNION ALL
SELECT 'reels.visual_render', count(*)::int, coalesce(sum(octet_length(render::text)), 0)::bigint, coalesce(max(octet_length(render::text)), 0)::bigint FROM reels.visual_jobs
UNION ALL
SELECT src, n, bytes, max_bytes FROM (
  SELECT 'carousel.shortlist' AS src, 1 AS n,
         coalesce(octet_length((record->'selection'->'shortlist')::text), 0)::bigint AS bytes,
         coalesce(octet_length(record::text), 0)::bigint AS max_bytes
    FROM social.runs
   WHERE kind = 'daily' AND jsonb_typeof(record->'selection'->'shortlist') = 'array'
   ORDER BY started_at DESC NULLS LAST
   LIMIT 1
) shortlist
`;

const FRAMES = `
SELECT f.id::text AS id, f.seq, f.role, (f.storage_path IS NOT NULL) AS has_path,
       s.id::text AS set_id, s.ny_date::text AS ny_date, s.status, s.series
  FROM stories.frames f
  JOIN stories.sets s ON s.id = f.set_id
 WHERE f.id = ANY($1::uuid[])
`;

const kb = (n: string | number) => {
  const v = Number(n);
  return v >= 1024 * 1024 ? `${(v / 1024 / 1024).toFixed(2)} MB` : `${Math.round(v / 1024)} KB`;
};

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const sizes = await client.query<{ src: string; n: number; bytes: string; max_bytes: string }>(SIZES);
    for (const row of sizes.rows) console.log(`${row.src}\t${row.n} rows\t${kb(row.bytes)} total\t${kb(row.max_bytes)} max`);
    const frames = await client.query(FRAMES, [[
      '1517e5d7-f50f-41b7-aaeb-16dab71be26a',
      '5ac1ff72-5507-4193-9c2e-bb637a797fd8',
      '1c191b0e-2bcd-4c18-8072-7853b5ccc5ee',
      '1ec7d627-1b51-46a1-b039-cd3939bf5088',
    ]]);
    console.log('frames', JSON.stringify(frames.rows));
    for (const [label, sql] of STATEMENTS) {
      await client.query('SAVEPOINT hub_explain');
      try {
        const plan = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
        const lines = plan.rows.map((row) => row['QUERY PLAN']);
        const time = lines.find((line) => line.startsWith('Execution Time')) ?? '';
        const head = lines.filter((line) => /Seq Scan|Index|Sort |Bitmap|Nested Loop|Hash/.test(line)).slice(0, 6);
        console.log(`\n## ${label}\n${time}`);
        for (const line of head) console.log(line);
        await client.query('RELEASE SAVEPOINT hub_explain');
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT hub_explain');
        console.log(`\n## ${label}\nFAILED ${error instanceof Error ? error.message.split('\n')[0] : error}`);
      }
    }
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
