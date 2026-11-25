// readAllProgress() with whatever backlog the DB holds: time and statement count.
import pg from 'pg';
let queries = 0;
const orig = pg.Client.prototype.query;
(pg.Client.prototype as any).query = function (...a: any[]) { queries += 1; return (orig as any).apply(this, a); };
const root = process.cwd();
const { readAllProgress } = await import(root + '/lib/content-type/progress.ts');
const { closeDbPool } = await import(root + '/lib/db.ts');
const times: number[] = [];
let count = 0;
for (let i = 0; i < 6; i += 1) { queries = 0; const t0 = performance.now(); await readAllProgress(); if (i) { times.push(performance.now() - t0); count = queries; } }
times.sort((a, b) => a - b);
console.log(JSON.stringify({ checkout: root, medianMs: Math.round(times[2]), queries: count }));
await closeDbPool();
