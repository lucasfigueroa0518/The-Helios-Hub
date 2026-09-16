// scripts/social_ingest.ts — Manual runner for the Helios Social RSS ingest.
//
// Human-triggered per the porting-report's "human-led live enrichment" rule.
// The daily 9am cron wraps this in a worker job kind (Phase 1b — not yet built).
//
// Run:
//   npm run helios-social:ingest

import fs from 'node:fs';
import path from 'node:path';

// Load .env.local before any module that reads process.env.* (Anthropic client,
// pg pool). Same pattern as scripts/apply_*_schema.js. Runs at import time so
// process.env is populated before the dynamic import below evaluates.
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\r$/, '');
  }
}

async function main() {
  // Dynamic import so lib modules initialize AFTER env is loaded.
  const { runIngest } = await import('../lib/social/ingest/run-ingest');

  const start = Date.now();
  console.log('[helios-social] Ingest starting…');

  try {
    const summary = await runIngest();
    console.log(JSON.stringify(summary, null, 2));
    console.log(
      `[helios-social] Ingest finished in ${((Date.now() - start) / 1000).toFixed(1)}s`,
    );
    if (summary.errors.length > 0) {
      console.error(`[helios-social] Completed with ${summary.errors.length} error(s).`);
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    console.error('[helios-social] Fatal:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[helios-social] Unhandled:', err);
  process.exit(1);
});
