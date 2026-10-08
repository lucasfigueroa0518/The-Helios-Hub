/**
 * The single publisher (unification Move 6, D40; docs/social-overnight.md).
 * Runs as the `helios-publisher` systemd unit on helios-social-worker. Every
 * content type places its own content on the calendar; this process releases
 * due slots, carries ONE post at a time across every type to the one
 * Instagram account (through the account quota gate), and reads insights.
 *
 *   node_modules/.bin/tsx scripts/publisher_worker.ts
 *
 * social_hub.settings `publisher_mode`:
 *   off    – idle; each type's worker publishes, as before (the default).
 *   shadow – read only: logs what it would release and post, so a day of logs
 *            can be compared with what the type workers actually did.
 *   live   – posts; the type workers stand down from releasing and posting.
 * Each type's own publishing_live still decides whether that type posts at all.
 * No Claude, no Jev: Instagram Graph and Supabase only.
 */
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'publisher', message, ...fields }));
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const POLL_MS = 15_000;
const INSIGHTS_EVERY_MS = 30 * 60_000;

async function main(): Promise<void> {
  const { socialQuery } = await import('@/lib/social/store');
  const { closeDbPool } = await import('@/lib/db');
  const { metaConfigured } = await import('@/lib/instagram/graph');
  const { mediaBucket } = await import('@/lib/media-bucket');
  const { SLIDE_BUCKET } = await import('@/lib/social/overnight/config');
  const { createLiveCarouselClient } = await import('@/lib/social/overnight/meta');
  const { createLiveReelClient } = await import('@/lib/explainers/publish/meta');
  const { signArtifact } = await import('@/lib/explainers/storage');
  const { carouselsDriver } = await import('@/lib/publishing/drivers/carousels');
  const { explainersDriver } = await import('@/lib/publishing/drivers/explainers');
  const { publisherMode, publisherTick } = await import('@/lib/publishing/publisher');
  type PublishDriver = import('@/lib/publishing/drivers/types').PublishDriver;

  const query = await socialQuery();
  const slideBucket = mediaBucket(SLIDE_BUCKET);
  const token = () => process.env.META_USER_ACCESS_TOKEN!;
  const drivers: PublishDriver[] = [carouselsDriver({ query, meta: createLiveCarouselClient, signImage: (p, s) => slideBucket.sign(p, s), token })];

  // Explainers join only when they share the account's database (D38); a separate one has its own worker.
  if (process.env.EXPLAINERS_DB === 'supabase' && !process.env.EXPLAINERS_DATABASE_URL?.trim()) {
    const { explainersDb } = await import('@/lib/explainers/connection');
    drivers.push(explainersDriver({ db: await explainersDb(), meta: createLiveReelClient, signVideo: signArtifact, token }));
  } else {
    log('explainers_not_driven', { reason: 'Explainers are not on the shared database (EXPLAINERS_DB=supabase).' });
  }

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('shutdown_requested', { signal });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  log('started', { pollMs: POLL_MS, verticals: drivers.map((d) => d.vertical), mode: await publisherMode(query) });
  let lastShadow = '';
  let lastInsights = 0;
  let lastMode = '';
  try {
    while (!stopping) {
      try {
        if (!metaConfigured()) {
          if (lastMode !== 'unconfigured') log('meta_unconfigured');
          lastMode = 'unconfigured';
        } else {
          const result = await publisherTick(query, drivers);
          if (result.mode !== lastMode) log('mode', { mode: result.mode });
          lastMode = result.mode;
          if (result.mode === 'shadow') {
            // Log a plan only when it changes, so a day of shadow logs stays readable.
            const key = JSON.stringify(result.plan);
            if (key !== lastShadow && (result.plan.due.length > 0 || result.plan.next)) log('shadow_plan', result.plan);
            lastShadow = key;
          }
          if (result.mode === 'live') {
            if (result.released > 0) log('schedule_due', { released: result.released });
            if (result.published) {
              log('publish_complete', result.published);
              continue;
            }
            if (Date.now() - lastInsights >= INSIGHTS_EVERY_MS) {
              for (const d of drivers) {
                const r = await d.pollInsights().catch((error) => ({ considered: 0, written: 0, blocked: null, detail: errorText(error) }));
                if (r.considered > 0 || r.blocked || r.detail) log('insights', { vertical: d.vertical, ...r });
              }
              lastInsights = Date.now();
            }
          }
        }
      } catch (error) {
        log('tick_failed', { error: errorText(error) });
      }
      for (let waited = 0; waited < POLL_MS && !stopping; waited += 1000) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } finally {
    await closeDbPool().catch(() => undefined);
  }
  log('stopped');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  },
);
