import fs from 'node:fs';
import path from 'node:path';

// Load .env.local before pg pool imports (same pattern as social_v2_test.ts).
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
    SELECT id, source, headline, published_at
    FROM helios_social.article_queue
    WHERE ingest_status = 'approved_for_draft'
      AND body IS NOT NULL AND length(body) > 500
      AND pipeline_version IS NULL OR pipeline_version <> 'creator'
    ORDER BY published_at DESC
    LIMIT 30
  `);
  for (const r of rows.rows) {
    console.log(`${r.id} | ${r.source} | ${r.headline}`);
  }
  process.exit(0);
}

void main();
