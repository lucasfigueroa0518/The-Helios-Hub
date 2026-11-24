#!/usr/bin/env node
/**
 * Synthetic seed for the local perf database. Schema-driven: reads the catalog
 * (FKs, CHECK lists, unique keys, types) and fills every app table in FK order,
 * then perf/db/seed-fixtures.mjs layers realistic shapes onto the hot tables.
 *
 *   source perf/env.sh && node perf/db/seed.mjs [--scale 1] [--volumes perf/db/volumes.json]
 *
 * Local loopback databases only. It never connects to anything else.
 * Data is fake (example.com addresses, lorem text) and deterministic per seed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, all) => (
  cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc
), []));
const SCALE = Number(args.scale ?? 1);
const VOLUMES = JSON.parse(fs.readFileSync(args.volumes ?? path.join(HERE, 'volumes.json'), 'utf8'));
const url = process.env.DATABASE_URL;
if (!url || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to seed: DATABASE_URL must point at a loopback database (source perf/env.sh).');
  process.exit(1);
}

// ---------- deterministic randomness ----------
let state = 0x9e3779b9;
function rand() {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return ((state >>> 0) % 1_000_000) / 1_000_000;
}
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
function uuid() {
  const h = [...Array(32)].map(() => Math.floor(rand() * 16).toString(16)).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[int(0, 3)]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const WORDS = 'helios outreach signal market growth agency brand story launch content reel carousel founder capital venture partner pipeline data model insight weekly review client project board design studio north harbor summit vector atlas orbit lumen cedar pine river delta ember quartz'.split(' ');
const FIRST = 'Ava Ben Cara Dev Eli Fay Gus Hana Ivan Jade Kai Lena Milo Nora Omar Pia Quin Rosa Sam Tess Uma Vik Wes Xena Yara Zed'.split(' ');
const LAST = 'Adams Baker Chen Diaz Evans Fox Garcia Hill Ito Jones Khan Lopez Moore Nguyen Ortiz Patel Reed Shah Tran Vega Wu Young'.split(' ');
const words = (n) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
const sentence = (lo = 6, hi = 18) => { const s = words(int(lo, hi)); return s[0].toUpperCase() + s.slice(1) + '.'; };
const NOW = Date.now();
const DAY = 86_400_000;

// ---------- catalog ----------
const APP_SCHEMAS = ['outreach', 'social', 'social_hub', 'reels', 'boards', 'reel_ai_drama', 'memes', 'stories', 'explainers', 'networking', 'real_case', 'intake', 'seo', 'field_notes', 'dashboards', 'ai_events', 'media_library', 'lfd', 'revisions', 'public'];

async function catalog(client) {
  const { rows: tables } = await client.query(`
    SELECT c.oid, n.nspname AS schema, c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p') AND n.nspname = ANY($1) AND NOT c.relispartition`, [APP_SCHEMAS]);
  const { rows: cols } = await client.query(`
    SELECT a.attrelid AS oid, a.attname AS name, a.attnum AS num, a.attnotnull AS notnull,
           a.atthasdef AS hasdef, a.attidentity AS identity, a.attgenerated AS generated,
           format_type(a.atttypid, a.atttypmod) AS type,
           COALESCE(bt.typname, t.typname) AS base, t.typtype AS typtype,
           CASE WHEN t.typtype='e' THEN (SELECT array_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid=t.oid) END AS enum,
           pg_get_expr(d.adbin, d.adrelid) AS def
      FROM pg_attribute a
      JOIN pg_type t ON t.oid = a.atttypid
      LEFT JOIN pg_type bt ON t.typtype = 'd' AND bt.oid = t.typbasetype
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped AND a.attrelid = ANY($1)
     ORDER BY a.attrelid, a.attnum`, [tables.map((t) => t.oid)]);
  const { rows: cons } = await client.query(`
    SELECT conrelid AS oid, contype, conkey, confrelid, confkey, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conrelid = ANY($1) AND contype IN ('f','c','u','p')`, [tables.map((t) => t.oid)]);
  const { rows: idx } = await client.query(`
    SELECT indrelid AS oid, indkey::int2[] AS keys, indpred IS NOT NULL AS partial, indexprs IS NOT NULL AS expr
      FROM pg_index WHERE indisunique AND indrelid = ANY($1)`, [tables.map((t) => t.oid)]);
  const byOid = new Map(tables.map((t) => [t.oid, { ...t, fq: `"${t.schema}"."${t.name}"`, key: `${t.schema}.${t.name}`, cols: [], fks: [], checks: [], uniques: [] }]));
  for (const c of cols) byOid.get(c.oid).cols.push(c);
  for (const c of cons) {
    const t = byOid.get(c.oid);
    if (c.contype === 'f') t.fks.push({ cols: c.conkey, parent: c.confrelid, pcols: c.confkey });
    else if (c.contype === 'c') t.checks.push({ cols: c.conkey, def: c.def });
    else t.uniques.push(c.conkey);
  }
  for (const i of idx) if (!i.expr) byOid.get(i.oid).uniques.push(i.keys);
  return byOid;
}

/** Allowed values from CHECK (col = ANY (ARRAY['a'::text, ...])) and (col IN ...). */
function checkChoices(table, col) {
  for (const ch of table.checks) {
    if (!ch.cols || ch.cols.length !== 1 || ch.cols[0] !== col.num) continue;
    const hex = ch.def.match(/~ '\^\[0-9a-f\]\{(\d+)\}\$'/);
    if (hex) return { hex: Number(hex[1]) };
    const eq = ch.def.match(/^CHECK \(\(\w+ = '((?:[^']|'')*)'::text\)\)/);
    if (eq) return [eq[1]];
    const m = ch.def.match(/ARRAY\[(.+?)\]\)/);
    if (m) {
      const vals = [...m[1].matchAll(/'((?:[^']|'')*)'::/g)].map((x) => x[1].replace(/''/g, "'"));
      if (vals.length) return vals;
      const nums = m[1].split(',').map((s) => Number(s.replace(/[^0-9.-]/g, ''))).filter((n) => !Number.isNaN(n));
      if (nums.length) return nums;
    }
    const lo = ch.def.match(/>=?\s*\(?(-?[0-9.]+)\)?(?:::\w+)?\)?/);
    const hi = ch.def.match(/<=?\s*\(?(-?[0-9.]+)\)?(?:::\w+)?\)?/);
    if (lo || hi) return { lo: lo ? Number(lo[1]) + (/>\s*\(?-?[0-9]/.test(ch.def) && !/>=/.test(ch.def) ? 1 : 0) : 0, hi: hi ? Number(hi[1]) : (lo ? Number(lo[1]) + 100 : 100) };
  }
  return null;
}

// ---------- value generation ----------
const TOMBSTONE = /^(deleted|archived|removed|cancell?ed|rejected|failed|killed|retired|expired|bounced|unsubscribed|suppressed|errored|paused|stopped|superseded|discarded)_(at|by|on)$|^(deleted_by|error|last_error|failure_reason|reject_reason)$/;
function genValue(table, col, i, attempt) {
  const n = col.name;
  const base = col.base;
  const choices = checkChoices(table, col);
  if (Array.isArray(choices)) return pick(choices);
  if (choices && choices.hex) return Array.from({ length: choices.hex }, () => Math.floor(rand() * 16).toString(16)).join('');
  if (col.enum) return pick(col.enum);
  const range = choices && !Array.isArray(choices) && 'lo' in choices ? choices : null;
  const unique = table.uniques.some((u) => u.length === 1 && u[0] === col.num);
  if (base === 'uuid') return uuid();
  if (base === 'bool') return rand() < 0.5;
  if (['int2', 'int4', 'int8'].includes(base)) {
    if (unique) return i + 1;
    if (range) return int(Math.ceil(range.lo), Math.floor(range.hi));
    if (/year/.test(n)) return int(2015, 2026);
    if (/weekday|dow/.test(n)) return int(0, 6);
    if (/hour/.test(n)) return int(0, 23);
    if (/minute/.test(n)) return int(0, 59);
    if (/(position|sort|order|rank|index|slot|seq)/.test(n)) return i;
    return int(0, 250);
  }
  if (['numeric', 'float4', 'float8'].includes(base)) {
    if (range) return Math.round((range.lo + rand() * (range.hi - range.lo)) * 100) / 100;
    if (/cost|usd|price|amount/.test(n)) return Math.round(rand() * 400) / 100;
    if (/score|confidence|rate|ratio|pct/.test(n)) return Math.round(rand() * 100) / 100;
    return Math.round(rand() * 10_000) / 100;
  }
  if (base === 'timestamptz' || base === 'timestamp') {
    const future = /(scheduled|due|expires|next_|until|publish_at|slot|starts|run_at|not_before)/.test(n);
    const t = future ? NOW + rand() * 14 * DAY - 2 * DAY : NOW - rand() * 120 * DAY;
    return new Date(t).toISOString();
  }
  if (base === 'date') {
    const future = /(scheduled|due|slot|post|publish|day|date|week)/.test(n);
    const t = future ? NOW + (rand() * 28 - 14) * DAY : NOW - rand() * 120 * DAY;
    return new Date(t).toISOString().slice(0, 10);
  }
  if (base === 'time' || base === 'timetz') return `${String(int(0, 23)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}:00`;
  if (base === 'jsonb' || base === 'json') {
    if (/(_ids|ids|list|items|tags|steps|slides|frames|urls|history|events|entries|errors|warnings|claims|sources|links|photos|images|choices|options|candidates)$/.test(n)) return '[]';
    return '{}';
  }
  if (col.type.endsWith('[]')) return '{}';
  if (base === 'bytea') return null;
  if (base === 'inet') return `10.0.${int(0, 255)}.${int(1, 254)}`;
  if (base === 'interval') return `${int(1, 60)} minutes`;
  if (base === 'tsvector') return null;
  // text-ish
  const suffix = unique || attempt > 0 ? `-${i}-${attempt}` : '';
  if (/email/.test(n)) return `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${i}${attempt || ''}@example${int(1, 400)}.com`;
  if (/(^|_)(url|uri|link|href)$|_url$|website|domain_url/.test(n)) return `https://example.com/${table.name}/${i}${attempt || ''}`;
  if (/domain$/.test(n)) return `example${i}${attempt || ''}.com`;
  if (/^first_name$/.test(n)) return pick(FIRST);
  if (/^last_name$/.test(n)) return pick(LAST);
  if (/(^|_)name$|full_name|display_name/.test(n)) return `${pick(FIRST)} ${pick(LAST)}${suffix}`;
  if (/(company|account|org|firm)/.test(n)) return `${pick(WORDS)} ${pick(['Capital', 'Partners', 'Labs', 'Group', 'Health', 'Systems'])}${suffix}`;
  if (/title|headline|hook|subject|caption|label/.test(n)) return `${sentence(3, 9)}${suffix}`;
  if (/(body|text|content|summary|description|notes|note|prompt|reason|message|copy|script|transcript|brief)/.test(n)) return `${sentence(12, 40)} ${sentence(8, 30)}${suffix}`;
  if (/(slug|key|token|hash|code|ref)$/.test(n)) return `${n}-${i}-${attempt}-${Math.floor(rand() * 1e9).toString(36)}`;
  if (/(status|state|kind|type|mode|stage|tier|source|origin|vertical|format|role|channel)$/.test(n)) return pick(['active', 'pending', 'done', 'draft']);
  if (/phone/.test(n)) return `+1555${String(int(0, 9_999_999)).padStart(7, '0')}`;
  if (/(timezone|tz)$/.test(n)) return 'America/New_York';
  if (/color|accent|background/.test(n)) return pick(['#f97316', '#16a34a', '#0ea5e9', '#a855f7']);
  return `${words(int(1, 4))}${suffix}`;
}

function shouldGenerate(col) {
  if (col.generated) return false;
  if (col.identity) return false;
  if (col.def && /nextval\(/.test(col.def)) return false;
  if (!col.hasdef) return true;
  // Has a default: still vary timestamps, booleans, and constrained choices.
  return ['timestamptz', 'timestamp', 'date', 'bool'].includes(col.base) || /(status|state|kind|type|vertical|stage)$/.test(col.name);
}

// ---------- ordering ----------
function topoOrder(tables) {
  const order = [];
  const seen = new Set();
  const visiting = new Set();
  function visit(t) {
    if (seen.has(t.oid)) return;
    if (visiting.has(t.oid)) return; // cycle: the nullable side is filled with NULL
    visiting.add(t.oid);
    for (const fk of t.fks) {
      const parent = tables.get(fk.parent);
      if (parent && parent.oid !== t.oid) visit(parent);
    }
    visiting.delete(t.oid);
    seen.add(t.oid);
    order.push(t);
  }
  for (const t of tables.values()) visit(t);
  return order;
}

function volumeFor(table) {
  const v = VOLUMES.tables[table.key];
  if (v !== undefined) return Math.max(0, Math.round(v * SCALE));
  const hasParent = table.fks.some((fk) => fk.parent !== table.oid);
  return Math.max(1, Math.round((hasParent ? VOLUMES.defaults.child : VOLUMES.defaults.root) * SCALE));
}

// ---------- main ----------
async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const tables = await catalog(client);
  const order = topoOrder(tables);
  const keys = new Map(); // oid -> array of row objects (column name -> value) for referenced columns
  const report = [];
  await client.query('SET session_replication_role = replica'); // skip user triggers during bulk load (local db only)
  for (const t of order) {
    const target = volumeFor(t);
    const genCols = t.cols.filter(shouldGenerate);
    const fkByCol = new Map();
    for (const fk of t.fks) fk.cols.forEach((c, idx) => fkByCol.set(c, { fk, idx }));
    const parentRows = (fk) => keys.get(fk.parent) ?? [];
    const colName = (oid, num) => tables.get(oid).cols.find((c) => c.num === num)?.name;
    let inserted = 0;
    let failures = 0;
    const kept = [];
    const refCols = new Set();
    // Which columns of this table do children reference?
    for (const other of tables.values()) for (const fk of other.fks) if (fk.parent === t.oid) fk.pcols.forEach((c) => refCols.add(colName(t.oid, c)));
    for (const u of t.uniques) u.forEach((c) => refCols.add(colName(t.oid, c)));
    refCols.delete(undefined);
    // Rows the schema files already inserted (settings singletons, identities) count as parents.
    if (refCols.size) {
      const { rows: existing } = await client.query(`SELECT ${[...refCols].map((c) => `"${c}"`).join(',')} FROM ${t.fq} LIMIT 20000`);
      kept.push(...existing);
    }

    function makeRow(i, attempt) {
      const row = {};
      const fkPicked = new Map();
      for (const col of t.cols) {
        const link = fkByCol.get(col.num);
        if (link) {
          const { fk, idx } = link;
          const self = fk.parent === t.oid;
          const pool = self ? kept : parentRows(fk);
          if (!fkPicked.has(fk)) {
            const optional = fk.cols.every((c) => !t.cols.find((x) => x.num === c).notnull);
            fkPicked.set(fk, pool.length === 0 || (optional && (self ? rand() < 0.7 : rand() < 0.1 * attempt)) ? null : pick(pool));
          }
          const parent = fkPicked.get(fk);
          row[col.name] = parent ? parent[colName(fk.parent, fk.pcols[idx])] : null;
          if (row[col.name] === null && col.notnull) return null; // cannot satisfy
          continue;
        }
        if (!shouldGenerate(col)) continue;
        if (!col.notnull && (attempt >= 3 || (attempt >= 1 && rand() < 0.5))) { row[col.name] = null; continue; }
        // Tombstone columns stay empty for most rows, as in a live database.
        if (!col.notnull && TOMBSTONE.test(col.name) && rand() < 0.92) { row[col.name] = null; continue; }
        row[col.name] = genValue(t, col, i, attempt);
        if (row[col.name] === null && col.notnull) return null;
      }
      return row;
    }

    async function insertRow(row) {
      const names = Object.keys(row);
      const sql = names.length
        ? `INSERT INTO ${t.fq} (${names.map((n) => `"${n}"`).join(',')}) VALUES (${names.map((_, k) => `$${k + 1}`).join(',')}) RETURNING *`
        : `INSERT INTO ${t.fq} DEFAULT VALUES RETURNING *`;
      return client.query(sql, names.map((n) => row[n]));
    }

    await client.query('BEGIN');
    for (let i = 0; i < target; i += 1) {
      let ok = false;
      for (let attempt = 0; attempt < 6 && !ok; attempt += 1) {
        const row = makeRow(i, attempt);
        if (!row) break;
        await client.query('SAVEPOINT r');
        try {
          const res = await insertRow(row);
          await client.query('RELEASE SAVEPOINT r');
          const full = res.rows[0];
          const slim = {};
          for (const c of refCols) if (c) slim[c] = full[c];
          kept.push(slim);
          inserted += 1;
          ok = true;
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT r');
          if (attempt === 5) t.lastError = error.message;
        }
      }
      if (!ok) failures += 1;
      if (failures > 25 && inserted === 0) break;
    }
    await client.query('COMMIT');
    if (kept.length) keys.set(t.oid, kept.length > 20_000 ? kept.filter((_, k) => k % Math.ceil(kept.length / 20_000) === 0) : kept);
    report.push({ table: t.key, target, inserted, failures, error: inserted < target ? t.lastError : undefined });
    if (inserted < target) console.log(`  ${t.key}: ${inserted}/${target}${t.lastError ? ` (${t.lastError.slice(0, 140)})` : ''}`);
  }
  await client.query('SET session_replication_role = origin');
  await client.query('ANALYZE');
  const total = report.reduce((s, r) => s + r.inserted, 0);
  fs.mkdirSync(path.join(HERE, '..', '.local'), { recursive: true });
  fs.writeFileSync(path.join(HERE, '..', '.local', 'seed-report.json'), JSON.stringify(report, null, 2));
  console.log(`seeded ${total} rows across ${report.length} tables (scale ${SCALE})`);
  await client.end();
}

main().catch((error) => { console.error(error); process.exit(1); });
