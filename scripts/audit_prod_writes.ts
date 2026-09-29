import fs from 'node:fs';
import path from 'node:path';

{
  const root = path.resolve(__dirname, '..');
  const envPath = path.join(root, '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/\r$/, '');
    }
  }
}

import { dbQuery } from '@/lib/db';

// Every article id the test runner touched tonight (batch + single-story
// runs). Includes the earlier session's e045bc07 + fab9b61a per plan doc.
const IDS = [
  'e045bc07-19d2-4cb0-ab4e-91ab16474290', // California Newsom (earlier session)
  'fab9b61a-9653-4208-b7b4-7b8ec7340aa9', // Google CC agent (earlier session)
  'c72fb8e1-ec30-4ee0-835b-4f07ae41e8ad', // Suleyman (tonight, story 1 of batch)
  '76c067dd-f7a9-463d-a6a2-3f97aeb1f795', // Claude Docs (tonight, batch story 2 — ENOSPC before run)
  'b8e0f3ec-27e6-48a8-87e0-d83b079d3fec', // Newsom kill switch (tonight — ENOSPC)
  'd6b3a9fa-eb12-4c4f-879d-9057bc67ae32', // Claude hack OpenAI (tonight — ENOSPC)
  '099e9a9e-083e-4595-8ac8-8726d6980599', // Novo Nordisk (tonight — ENOSPC)
];

async function main() {
  const rows = await dbQuery(`
    SELECT
      id, source, headline,
      pipeline_version,
      ingest_status,
      copy_json IS NOT NULL AS has_copy,
      pipeline_v2_debug IS NOT NULL AS has_v2_debug,
      render_post_json IS NOT NULL AS has_render,
      render_slug,
      compose_status,
      compose_error IS NOT NULL AS has_compose_error,
      review_status,
      review_note IS NOT NULL AS has_review_note,
      generation_started_at
    FROM helios_social.article_queue
    WHERE id = ANY($1::uuid[])
    ORDER BY id
  `, [IDS]);
  console.log(`Rows found: ${rows.rows.length} of ${IDS.length}`);
  console.log('');
  for (const r of rows.rows) {
    const wrote_v2 = r.has_v2_debug || r.has_render || r.compose_status !== null || r.has_compose_error;
    const wrote_review = r.review_status !== null || r.has_review_note;
    console.log(`${r.id}`);
    console.log(`  headline: ${r.headline}`);
    console.log(`  pipeline_version: ${r.pipeline_version}`);
    console.log(`  ingest_status:    ${r.ingest_status}`);
    console.log(`  legacy copy_json: ${r.has_copy}`);
    console.log(`  v2 write columns: has_v2_debug=${r.has_v2_debug} | has_render=${r.has_render} | render_slug=${r.render_slug ?? 'null'} | compose_status=${r.compose_status ?? 'null'} | has_compose_error=${r.has_compose_error}`);
    console.log(`  review columns:   review_status=${r.review_status ?? 'null'} | has_review_note=${r.has_review_note}`);
    console.log(`  generation_started_at: ${r.generation_started_at ?? 'null'}`);
    console.log(`  → tests wrote v2 columns: ${wrote_v2 ? 'YES' : 'no'} | wrote review columns: ${wrote_review ? 'YES' : 'no'}`);
    console.log('');
  }
  process.exit(0);
}

void main();
