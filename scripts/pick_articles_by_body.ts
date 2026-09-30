/**
 * Read-only queue browse. Lists approved-for-draft articles with body
 * length ≥ 1500 chars, ordered by most-recent published_at. No writes.
 * User authorized this one browse for candidate selection.
 */
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
    SELECT id, source, headline, length(body) as body_len, published_at,
           substring(body, 1, 300) as body_preview
    FROM helios_social.article_queue
    WHERE ingest_status = 'approved_for_draft'
      AND body IS NOT NULL AND length(body) >= 1500
      AND (pipeline_version IS NULL OR pipeline_version <> 'creator')
    ORDER BY published_at DESC
    LIMIT 30
  `);
  for (const r of rows.rows) {
    console.log(`${String(r.body_len).padStart(6)} | ${r.id} | ${String(r.source).slice(0, 22).padEnd(22)} | ${String(r.headline).slice(0, 90)}`);
    console.log(`         preview: ${String(r.body_preview).replace(/\s+/g, ' ').slice(0, 200)}...`);
    console.log('');
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
