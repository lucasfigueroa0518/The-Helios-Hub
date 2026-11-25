// Function-level benchmark of a full Social Hub dataset rebuild (what views/cached-dataset.ts
// does on a full cache miss): every type through readOne inside withSharedSpine, then
// loadDataset with the ledger. Run from a checkout root with the DB proxy up:
//   PERF_DB_ONE_WAY_MS=2.5 npx tsx perf/lib/bench-rebuild.mts [runs]
import pg from 'pg';
const runs = Number(process.argv[2] ?? 8);
let queries = 0;
const orig = pg.Client.prototype.query;
(pg.Client.prototype as any).query = function (...a: any[]) { queries += 1; return (orig as any).apply(this, a); };
const root = process.cwd();
const { liveHubQuery } = await import(root + '/lib/social-hub/db.ts');
const { loadDataset, loadCostPart, readOne, withSharedSpine } = await import(root + '/lib/social-hub/load.ts');
const { VERTICAL_IDS } = await import(root + '/lib/social-hub/verticals.ts');
const { closeDbPool } = await import(root + '/lib/db.ts');
const times: number[] = []; const counts: number[] = [];
for (let i = 0; i < runs + 1; i += 1) {
  queries = 0;
  const t0 = performance.now();
  await withSharedSpine(liveHubQuery, async () => {
    const entries = await Promise.all(VERTICAL_IDS.map(async (v: string) => [v, await readOne(liveHubQuery, v).catch((e: Error) => e)]));
    return loadDataset(liveHubQuery, new Date(), loadCostPart(liveHubQuery), Object.fromEntries(entries));
  });
  if (i > 0) { times.push(performance.now() - t0); counts.push(queries); } // first run warms module/JIT caches
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ checkout: root, runs, medianMs: Math.round(times[Math.floor(times.length / 2)]), minMs: Math.round(times[0]), maxMs: Math.round(times[times.length - 1]), queries: counts[0] }));
await closeDbPool();
