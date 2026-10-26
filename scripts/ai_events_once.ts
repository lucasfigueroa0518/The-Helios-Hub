// scripts/ai_events_once.ts
/**
 * AI Events This Week, one queued run carried out by hand, in-process (plan, hand-off step 7):
 * the helios-social worker's claim and carry-out with the new code, while the VM keeps its own.
 *
 *   npx tsx scripts/ai_events_once.ts          claims the queued run (Generate or Rebuild post on /ai-events) and carries it out
 *   npx tsx scripts/ai_events_once.ts --peek   shows what is queued; claims nothing
 *
 * It only carries out a run a person queued: it never queues one itself. A build asks Jev
 * event-pick@1 about the week's events not scored yet (about $0.02 a week), capped at
 * ai_events.settings.run_cap_usd; a rebuild asks nothing. No Claude, no web_search. It renders
 * with local Chromium, uploads the slides, writes ai_events.* and the spine in the database
 * .env.local points at (production), and publishes the public calendar snapshot. Lucas runs it;
 * agents do not (CLAUDE.md Rule 1).
 */
import fs from 'node:fs';
import path from 'node:path';

import type { HubQuery } from '@/lib/social-hub/db';

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'ai-events-once', message, ...fields }));
}

async function main(): Promise<number> {
  const { socialQuery } = await import('@/lib/social/store');
  const { closeDbPool } = await import('@/lib/db');
  const query = (await socialQuery()) as unknown as HubQuery;
  try {
    if (process.argv.includes('--peek')) {
      const { rows } = await query<{ id: string; status: string; kind: string; trigger: string; requested_by: string | null; week_key: string | null }>(
        `SELECT id::text AS id, status, kind, trigger, requested_by, week_key FROM ai_events.runs WHERE status IN ('requested', 'running') ORDER BY requested_at`,
      );
      console.log(rows.length ? JSON.stringify(rows, null, 2) : 'Nothing queued. Click Generate (or Rebuild post) on /ai-events first.');
      return 0;
    }

    const store = await import('@/lib/ai-events/store');
    const { carryOutAiEventsRun, withAiEventsTimeout } = await import('@/lib/ai-events/worker');
    const { liveAiEventsDeps, liveAiEventsSnapshot } = await import('@/lib/ai-events/live');
    const { AI_EVENTS_RUN_TIMEOUT_MS } = await import('@/lib/ai-events/config');

    const claimed = await store.claimRun(query);
    if (!claimed) {
      console.log('Nothing to claim: no AI Events run is queued, or one is already running. Click Generate (or Rebuild post) on /ai-events first.');
      return 1;
    }
    log('claimed', { ...claimed });
    const out = await withAiEventsTimeout(
      carryOutAiEventsRun(
        {
          query,
          now: () => new Date(),
          log,
          engine: (_run, capUsd) => liveAiEventsDeps(query, { capUsd }),
          snapshot: liveAiEventsSnapshot(query),
        },
        claimed,
      ),
      AI_EVENTS_RUN_TIMEOUT_MS,
      async () => {
        await store.failRun(query, claimed.id, 'timed out after 30 minutes').catch(() => undefined);
        return { runId: claimed.id, status: 'failed' as const, note: 'timed out after 30 minutes' };
      },
    );
    const row = (await query<{ status: string; jev_usd: number; stop_reason: string | null; error: string | null }>(
      `SELECT status, jev_usd, stop_reason, error FROM ai_events.runs WHERE id = $1`,
      [claimed.id],
    )).rows[0];
    console.log(JSON.stringify({ ...out, run: row ?? null }, null, 2));
    return out.status === 'failed' ? 1 : 0;
  } finally {
    await closeDbPool().catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  },
);
