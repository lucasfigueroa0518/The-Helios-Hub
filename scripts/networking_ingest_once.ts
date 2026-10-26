// scripts/networking_ingest_once.ts
/**
 * One networking ingest by hand, in-process (AI Events plan, M1): the weekly ingest across all
 * sources and the four metros, then the detail fetches (networking.event_details) for kept
 * events in the next ten days, then the public calendar snapshot (public-feeds/networking/
 * events.v1.json, plan M3) as the worker's details job does. Prints per-source and per-metro
 * counts and the signal coverage of upcoming events.
 *
 *   npx tsx scripts/networking_ingest_once.ts
 *
 * Plain HTTP to Luma, Meetup, GDG and developers.events: no model calls, no web_search, $0
 * (CLAUDE.md Rule 1 is not touched). It WRITES networking.* in the database .env.local points
 * at, which is production: Lucas runs it, agents do not. The VM keeps its own schedule.
 */
import path from 'node:path';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '-');

async function main(): Promise<number> {
  const { closeDbPool } = await import('@/lib/db');
  const { runWeeklyIngest } = await import('@/lib/networking/ingest');
  const { runEventDetails, DETAILS_WINDOW_DAYS } = await import('@/lib/networking/details');
  const { listKeptEvents } = await import('@/lib/networking/repository');
  const { signalCoverage } = await import('@/lib/networking/signals');
  const { METROS } = await import('@/lib/networking/types');

  try {
    const started = Date.now();
    console.log('Ingest: fetching every source...');
    const ingest = await runWeeklyIngest();
    console.log(`Ingest ${ingest.weekKey} (run ${ingest.runId}): kept ${ingest.keptCount}, rejected ${ingest.rejectedCount}, anchors ${ingest.anchorCount}`);
    if (ingest.anchorError) console.log(`  anchors failed: ${ingest.anchorError}`);
    console.table(
      ingest.sourceResults.map((r) => ({
        source: r.source,
        fetched: r.fetched,
        kept: r.kept,
        rejected: r.rejected,
        error: r.error ? r.error.slice(0, 120) : '',
      })),
    );

    console.log(`Details: fetching kept events in the next ${DETAILS_WINDOW_DAYS} days...`);
    const details = await runEventDetails();
    console.log(
      `Details: ${details.targets} events, ${details.completed} done, ${details.pending} left pending, ` +
        `${details.descriptionsAdded} descriptions added; Luma ${details.luma.ok} ok / ${details.luma.failed} failed, ` +
        `Meetup ${details.meetup.ok} ok / ${details.meetup.failed} failed, calendars ${details.calendars.resolved} resolved / ${details.calendars.failed} failed`,
    );
    for (const error of details.errors) console.log(`  ${error}`);

    // Best effort, as in the worker: a missing bucket or a hook problem never fails the ingest.
    try {
      const { publishSnapshot } = await import('@/lib/networking/public-snapshot');
      const snap = await publishSnapshot({ reason: 'networking_ingest_once' });
      const hook = snap.hook.fired ? (snap.hook.ok ? 'fired' : `failed (${snap.hook.status ?? 'network'})`) : `skipped (${snap.hook.reason})`;
      console.log(`Snapshot: ${snap.events} events, ${snap.picks} picks, ${snap.changed ? 'changed' : 'unchanged'}; deploy hook ${hook}. ${snap.url}`);
    } catch (err) {
      console.log(`Snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const now = new Date();
    const soon = new Date(now.getTime() + DETAILS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const upcoming = await listKeptEvents({ metros: METROS, from: now });
    console.log('Scheduled events by metro:');
    console.table(
      METROS.map((metro) => {
        const inMetro = upcoming.filter((e) => e.metro === metro);
        return {
          metro,
          upcoming: inMetro.length,
          [`next ${DETAILS_WINDOW_DAYS} days`]: inMetro.filter((e) => new Date(e.startAt) < soon).length,
          'tech or both': inMetro.filter((e) => e.bucket !== 'vertical').length,
          luma: inMetro.filter((e) => e.listings.some((l) => l.source === 'luma')).length,
          meetup: inMetro.filter((e) => e.listings.some((l) => l.source === 'meetup')).length,
        };
      }),
    );

    const nearTerm = upcoming.filter((e) => new Date(e.startAt) < soon);
    console.log(`Signal coverage, events in the next ${DETAILS_WINDOW_DAYS} days:`);
    console.table(
      METROS.map((metro) => {
        const c = signalCoverage(nearTerm.filter((e) => e.metro === metro));
        return {
          metro,
          events: c.events,
          organizer: pct(c.organizer, c.events),
          hosts: pct(c.hosts, c.events),
          guests: pct(c.guestCount, c.events),
          description: pct(c.description, c.events),
          price: pct(c.price, c.events),
          capacity: pct(c.capacity, c.events),
          approval: pct(c.requiresApproval, c.events),
          'track record': pct(c.organizerTrackRecord, c.events),
          tags: pct(c.sourceTags, c.events),
          details: pct(c.detailsFetched, c.events),
        };
      }),
    );
    console.log(`Finished in ${Math.round((Date.now() - started) / 1000)} s.`);
    return 0;
  } finally {
    await closeDbPool();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.stack || err.message : err);
    process.exit(1);
  },
);
