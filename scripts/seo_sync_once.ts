import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env.local');
try {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] == null) process.env[match[1]] = match[2];
  }
} catch {
  // Worker env may already be loaded.
}

async function main() {
  const mode = process.argv[2] ?? 'sync';
  if (mode === 'probe') {
    const { listSites } = await import('@/lib/seo/gsc-client');
    const sites = await listSites();
    console.log(JSON.stringify(sites, null, 2));
    return;
  }
  if (mode === 'enqueue') {
    const { enqueueWorkBatch } = await import('@/lib/orchestration/repository');
    const ids = await enqueueWorkBatch([
      {
        kind: 'seo.gsc_daily_sync',
        payload: { reason: 'manual' },
        dedupeKey: `manual:${Date.now()}`,
        scopeKey: 'seo',
        maxAttempts: 2,
        priority: -5,
      },
    ]);
    console.log('enqueued', ids);
    return;
  }
  const { runGscDailySync } = await import('@/lib/seo/sync');
  const result = await runGscDailySync();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
