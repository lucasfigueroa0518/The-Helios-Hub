/**
 * Social Hub load benchmark (read-only). Times what each hub page reads from
 * the database, counts queries, and sizes the shared dataset. Every write is
 * refused at the driver, so a run never changes data (loadDataset's
 * consumeMoves UPDATE falls back to its catch, as it does on any failure).
 *
 *   npx tsx scripts/bench_social_hub.ts [runs=3]
 *
 * Numbers from a laptop include the laptop→Supabase distance; the RTT line
 * at the top says how much each round trip costs from here.
 */
import { loadEnvConfig } from '@next/env';
import { performance } from 'node:perf_hooks';
import { gunzipSync, gzipSync } from 'node:zlib';
import pg from 'pg';

loadEnvConfig(process.cwd());

const WRITE = /^\s*(UPDATE|INSERT|DELETE|ALTER|CREATE|DROP|TRUNCATE|SET|GRANT|REVOKE)\b/i;
let queries = 0;
let blocked = 0;
const qlog: Array<{ ms: number; text: string; params: unknown[] | undefined }> = [];
let capture = false;
const squash = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 180);
const originalQuery = pg.Client.prototype.query;
// Refuse writes and count every statement this process sends.
pg.Client.prototype.query = function guarded(this: pg.Client, ...args: unknown[]) {
  const first = args[0];
  const config = typeof first === 'string' ? null : (first as { text?: string; values?: unknown[] } | undefined);
  const text = typeof first === 'string' ? first : config?.text ?? '';
  const params = typeof first === 'string' ? (Array.isArray(args[1]) ? args[1] as unknown[] : undefined) : config?.values;
  if (WRITE.test(text)) {
    blocked += 1;
    const error = new Error('bench: writes are blocked');
    const callback = args.find((a) => typeof a === 'function') as ((e: Error) => void) | undefined;
    if (callback) { callback(error); return undefined; }
    return Promise.reject(error);
  }
  queries += 1;
  const started = performance.now();
  const note = () => { if (capture) qlog.push({ ms: performance.now() - started, text, params }); };
  // The pool calls client.query with a callback, and that form returns nothing until the callback.
  const cbIndex = args.findIndex((a) => typeof a === 'function');
  if (cbIndex >= 0) {
    const cb = args[cbIndex] as (err: Error | undefined, res?: unknown) => void;
    args[cbIndex] = (err: Error | undefined, res?: unknown) => { note(); cb(err, res); };
    return (originalQuery as (...a: unknown[]) => unknown).apply(this, args);
  }
  const result = (originalQuery as (...a: unknown[]) => unknown).apply(this, args) as { then?: (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => unknown };
  if (result && typeof result.then === 'function') {
    return result.then((value) => { note(); return value; }, (error: unknown) => { note(); throw error; });
  }
  note();
  return result;
} as typeof pg.Client.prototype.query;

type Row = { label: string; ms: number; queries: number; note?: string };
const rows: Row[] = [];

async function timed<T>(label: string, work: () => Promise<T>, note?: (value: T) => string): Promise<T> {
  const q0 = queries;
  const t0 = performance.now();
  const value = await work();
  rows.push({ label, ms: performance.now() - t0, queries: queries - q0, note: note?.(value) });
  return value;
}

const kb = (s: string | Buffer) => `${Math.round(Buffer.byteLength(s) / 1024).toLocaleString()} KB`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  const runs = Math.max(1, Number(process.argv[2] ?? 3));
  const { dbQuery } = await import('@/lib/db');
  const { liveHubQuery } = await import('@/lib/social-hub/db');
  const { loadDataset, readAll, readOne, withSharedSpine } = await import('@/lib/social-hub/load');
  const { readCosts } = await import('@/lib/social-hub/queries/costs');
  const { refreshState } = await import('@/lib/social-hub/refresh');
  const { loadLibraries } = await import('@/lib/social-hub/views/libraries');
  const { readAllProgress } = await import('@/lib/content-type/progress');
  const { readRunMisses } = await import('@/lib/content-type/run-misses');
  const { loadHealthPage } = await import('@/lib/social-hub/health/load');
  const { readSlotSource, readTemplate, readCaps, readOverrides } = await import('@/lib/social-hub/slots/load');
  const { readLfdSettings } = await import('@/lib/lfd/settings');
  const { explainersHubQuery } = await import('@/lib/social-hub/db');

  // Network: the first query pays the connection, later ones one round trip each.
  await timed('connect + first query', () => dbQuery('SELECT 1'));
  const rtts: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const t0 = performance.now();
    await dbQuery('SELECT 1');
    rtts.push(performance.now() - t0);
  }
  rows.push({ label: 'one round trip (median of 10)', ms: median(rtts), queries: 1 });

  // A cache miss: what the first visit after a minute, a deploy, or any action pays.
  const missTimes: number[] = [];
  let dataset: Awaited<ReturnType<typeof loadDataset>> | null = null;
  let missQueries = 0;
  for (let i = 0; i < runs; i += 1) {
    const q0 = queries;
    const t0 = performance.now();
    dataset = await loadDataset();
    missTimes.push(performance.now() - t0);
    missQueries = queries - q0;
  }
  rows.push({ label: `loadDataset (cache miss) median of ${runs}`, ms: median(missTimes), queries: missQueries, note: `runs: ${missTimes.map((t) => Math.round(t)).join(', ')} ms` });

  // The same miss with the cost part already cached (what an action or a minute's expiry pays now).
  const { loadCostPart } = await import('@/lib/social-hub/load');
  const part = await loadCostPart();
  const cachedPart = JSON.parse(JSON.stringify({ ...part, ledger: { rows: [], allocations: [], unattributed: [] } }));
  rows.push({ label: '  cached cost part size', ms: 0, queries: 0, note: kb(JSON.stringify(cachedPart)) });
  const contentTimes: number[] = [];
  let contentQueries = 0;
  for (let i = 0; i < runs; i += 1) {
    const q0 = queries;
    const t0 = performance.now();
    await loadDataset(liveHubQuery, new Date(), Promise.resolve(cachedPart));
    contentTimes.push(performance.now() - t0);
    contentQueries = queries - q0;
  }
  rows.push({ label: `loadDataset (costs cached) median of ${runs}`, ms: median(contentTimes), queries: contentQueries, note: `runs: ${contentTimes.map((t) => Math.round(t)).join(', ')} ms` });

  // Its parts, one at a time, so each cost stands alone. Query times are this one readAll.
  capture = true;
  qlog.length = 0;
  const reads = await timed('  readAll (6 content types)', () => readAll());
  capture = false;
  const grouped = new Map<string, { n: number; ms: number; params?: unknown[] }>();
  for (const q of qlog) {
    const hit = grouped.get(q.text) ?? { n: 0, ms: 0, params: q.params };
    hit.n += 1;
    hit.ms += q.ms;
    grouped.set(q.text, hit);
  }
  const slowest = [...grouped.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 12);
  for (const [text, stat] of slowest) {
    rows.push({ label: `    sql ${Math.round(stat.ms)}ms x${stat.n}`, ms: 0, queries: stat.n, note: squash(text) });
  }
  const verticals = ['reels', 'explainers', 'carousels', 'stories', 'last_few_days', 'ai_events'] as const;
  await timed('  readOne x6, one shared spine', () => withSharedSpine(liveHubQuery, () => Promise.all(verticals.map((vertical) => readOne(liveHubQuery, vertical)))));
  for (const vertical of verticals) await timed(`  readOne ${vertical}`, () => readOne(liveHubQuery, vertical));
  for (const [type, value] of Object.entries(reads)) {
    rows.push({ label: `    ${type} size`, ms: 0, queries: 0, note: value instanceof Error ? `ERROR ${value.message}` : kb(JSON.stringify(value)) });
  }
  await timed('  readCosts (ledger)', () => readCosts(liveHubQuery, explainersHubQuery()), (c) => kb(JSON.stringify(c)));

  // What the cache stores and what a cache hit pays to unpack.
  const full = JSON.stringify(dataset);
  const slim = JSON.stringify(dataset?.cost ? { ...dataset, cost: { rows: [], allocations: [], unattributed: [] } } : dataset);
  const t0 = performance.now();
  const packed = gzipSync(slim).toString('base64');
  const packMs = performance.now() - t0;
  const t1 = performance.now();
  JSON.parse(gunzipSync(Buffer.from(packed, 'base64')).toString('utf8'));
  const unpackMs = performance.now() - t1;
  rows.push({ label: 'dataset full / slim / gzipped', ms: 0, queries: 0, note: `${kb(full)} / ${kb(slim)} / ${kb(packed)}` });
  rows.push({ label: 'pack (on miss)', ms: packMs, queries: 0 });
  rows.push({ label: 'unpack (every request, cache hit)', ms: unpackMs, queries: 0 });
  rows.push({ label: 'posts in dataset', ms: 0, queries: 0, note: String(dataset?.posts.length ?? 0) });

  // Reads that are never cached and run on every request.
  await timed('refreshState (every hub page)', () => refreshState(liveHubQuery));
  await timed('Content: loadLibraries', () => loadLibraries(liveHubQuery));
  await timed('Content: readAllProgress', () => readAllProgress());
  await timed('Content: readRunMisses', () => readRunMisses(liveHubQuery));
  await timed('Content: all four extras in parallel', () => Promise.all([refreshState(liveHubQuery), loadLibraries(liveHubQuery), readAllProgress(), readRunMisses(liveHubQuery)]));
  await timed('Health: loadHealthPage(14)', () => loadHealthPage(new Date(), 14));

  // Calendar week view: three dependent steps, as the page runs them.
  const q = liveHubQuery as Parameters<typeof readSlotSource>[0];
  await timed('Calendar: loadWeek (3 serial steps)', async () => {
    const source = await readSlotSource(q);
    await Promise.all([readTemplate(q).catch(() => null), readLfdSettings(q).catch(() => null), readCaps(q)]);
    if (source === 'template') await readOverrides(q, '2026-10-26', '2026-11-01');
    return source;
  }, (s) => `source=${s}`);

  // Where the stories read's bytes sit (payload keys, frames, insights). Aggregates only, one connection.
  const bytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);
  const probe = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await probe.connect();
    await probe.query('BEGIN READ ONLY');
    const keys = await probe.query<{ key: string; sets: number; bytes: string }>(`
      SELECT e.key, count(*)::int AS sets, sum(octet_length(e.value::text))::bigint AS bytes
        FROM stories.sets s
        CROSS JOIN LATERAL jsonb_each(COALESCE(s.payload, '{}'::jsonb)) AS e(key, value)
       WHERE s.status NOT IN ('requested', 'building', 'rejected')
       GROUP BY e.key
       ORDER BY sum(octet_length(e.value::text)) DESC`);
    const totals = await probe.query<{ sets: number; payload_bytes: string; frames: number; insights: number; insight_bytes: string }>(`
      SELECT
        (SELECT count(*)::int FROM stories.sets WHERE status NOT IN ('requested', 'building', 'rejected')) AS sets,
        (SELECT coalesce(sum(octet_length(payload::text)), 0)::bigint FROM stories.sets WHERE status NOT IN ('requested', 'building', 'rejected')) AS payload_bytes,
        (SELECT count(*)::int FROM stories.frames) AS frames,
        (SELECT count(*)::int FROM stories.insights) AS insights,
        (SELECT coalesce(sum(octet_length(i::text)), 0)::bigint FROM stories.insights i) AS insight_bytes`);
    const explain = [...grouped.entries()].sort((a, b) => b[1].ms - a[1].ms).filter(([, stat]) => stat.ms >= 150).slice(0, 3);
    for (const [text, stat] of explain) {
      try {
        const plan = await probe.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, BUFFERS) ${text}`, stat.params);
        const lines = plan.rows.map((row) => row['QUERY PLAN']).filter((line) => /Seq Scan|Index|actual time|Sort /.test(line)).slice(0, 3);
        rows.push({ label: `    explain ${Math.round(stat.ms)}ms`, ms: 0, queries: 0, note: lines.join(' | ').slice(0, 240) });
      } catch (error) {
        rows.push({ label: `    explain ${Math.round(stat.ms)}ms`, ms: 0, queries: 0, note: error instanceof Error ? error.message.slice(0, 180) : String(error) });
      }
    }
    await probe.query('ROLLBACK');
    const t = totals.rows[0];
    rows.push({
      label: 'stories bytes (sets / payload / frames / insights)',
      ms: 0,
      queries: 0,
      note: t ? `${t.sets} sets, payload ${bytes(Number(t.payload_bytes))}, ${t.frames} frames, ${t.insights} insights ${bytes(Number(t.insight_bytes))}` : 'none',
    });
    for (const row of keys.rows.slice(0, 8)) {
      rows.push({ label: `    payload.${row.key}`, ms: 0, queries: row.sets, note: bytes(Number(row.bytes)) });
    }
  } catch (error) {
    await probe.query('ROLLBACK').catch(() => undefined);
    rows.push({ label: 'stories bytes', ms: 0, queries: 0, note: error instanceof Error ? error.message : String(error) });
  } finally {
    await probe.end().catch(() => undefined);
  }

  console.log('\nSocial Hub load benchmark (read-only; writes blocked: %d)\n', blocked);
  const width = Math.max(...rows.map((r) => r.label.length));
  for (const r of rows) {
    const ms = r.ms ? `${Math.round(r.ms).toLocaleString().padStart(6)} ms` : '         ';
    const qs = r.queries ? `${String(r.queries).padStart(3)} q` : '     ';
    console.log(`${r.label.padEnd(width)}  ${ms}  ${qs}  ${r.note ?? ''}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
