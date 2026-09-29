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

async function main() {
  const rows = await dbQuery(`
    SELECT id, source, headline, length(body) AS body_len, ingest_status,
           source_url
    FROM helios_social.article_queue
    WHERE ingest_status = 'approved_for_draft'
      AND body IS NOT NULL AND length(body) > 800
      AND (pipeline_version IS NULL OR pipeline_version <> 'creator')
      AND compose_status IS DISTINCT FROM 'composed'
      AND compose_status IS DISTINCT FROM 'needs_human_review'
    ORDER BY length(body) DESC
    LIMIT 40
  `);
  for (const r of rows.rows) {
    console.log(`${r.id} | body=${r.body_len} | ${r.source} | ${r.headline}`);
  }
  process.exit(0);
}

void main();
