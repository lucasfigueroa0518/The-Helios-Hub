// The asset catalog (Explainers 3.6, EX3-113): every library and bank asset with its tags, read from
// props/tags.js and props/bank/*.json only, never by loading the drawings, so the plan lint and the
// worker can read it in Node. `catalogMarkdown()` is props/CATALOG.md, the list the planner and the
// scene builder read.
//
//   node explainers/world-kit/props/catalog.mjs            writes props/CATALOG.md
//   node explainers/world-kit/props/catalog.mjs --index    also rebuilds props/bank/index.js
//
// The bank lives in EXPLAINERS_BANK_DIR (the social worker VM keeps it outside the app so deploys
// never wipe it) or, by default, props/bank beside this file.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { TAGS, tagProblems } from './tags.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export const bankDir = (dir = process.env.EXPLAINERS_BANK_DIR) => (dir && dir.trim() ? dir : join(HERE, 'bank'));

/** The bank's manifests: [{ file, props: { <name>: { tags, … } }, job, topic, added_at }]. */
export function bankManifests(dir = bankDir()) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

/** Every asset: [{ name, source: 'library' | 'bank', tags }], library first, then the bank in file order. */
export function catalogEntries(dir = bankDir()) {
  const out = Object.entries(TAGS).map(([name, tags]) => ({ name, source: 'library', tags }));
  for (const m of bankManifests(dir)) {
    for (const [name, p] of Object.entries(m.props ?? {})) out.push({ name, source: 'bank', tags: p.tags, job: m.job, file: m.file });
  }
  return out;
}

/** Problems with the catalog: an asset with a missing tag, or a name used twice. */
export function catalogProblems(entries = catalogEntries()) {
  const out = [];
  const seen = new Set();
  for (const e of entries) {
    out.push(...tagProblems(e.name, e.tags));
    if (seen.has(e.name)) out.push(`asset "${e.name}" is in the catalog twice`);
    seen.add(e.name);
  }
  return out;
}

const list = (v) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''));

export function catalogMarkdown(entries = catalogEntries()) {
  const lines = [
    '# The asset bank (generated; EX3-112, EX3-113)',
    '',
    'Reuse an asset only when its `is` line is exactly the thing the scene shows, its `setting` includes the',
    "scene's setting, and nothing in its `not` list describes the entity. Otherwise draw the object new: that is",
    'the usual case. Name it in the anchor block as `prop: <name> (exact: <its is line>, in <this setting>)`.',
    '',
  ];
  for (const e of entries) {
    lines.push(`## ${e.name}${e.source === 'bank' ? ' (bank)' : ''}`);
    lines.push(`- is: ${e.tags?.is ?? ''}`);
    lines.push(`- setting: ${list(e.tags?.setting)}`);
    lines.push(`- material: ${list(e.tags?.material)}`);
    lines.push(`- parts: ${list(e.tags?.parts)}`);
    lines.push(`- not: ${list(e.tags?.not)}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** props/bank/index.js from the manifests: each file's verified props, renamed on a clash. */
export function bankIndexSource(dir = bankDir()) {
  const manifests = bankManifests(dir);
  const lines = [
    '// The asset bank\'s drawings (Explainers 3.6, EX3-114), generated from the manifests beside it by',
    '// lib/explainers/render/bank.ts and props/catalog.mjs --index. Never edit by hand.',
    '',
  ];
  manifests.forEach((m, i) => lines.push(`import * as m${i} from './${m.file}';`));
  lines.push('', 'const pick = (mod, names) => Object.fromEntries(names.map(([key, name]) => [key, { ...mod.NEW_PROPS[name], tags: mod.NEW_PROPS[name].tags }]));', '');
  lines.push('export const BANK = {');
  manifests.forEach((m, i) => {
    const pairs = Object.entries(m.props ?? {}).map(([key, p]) => [key, p.source_name ?? key]);
    lines.push(`  ...pick(m${i}, ${JSON.stringify(pairs)}),`);
  });
  lines.push('};', '');
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = bankDir();
  if (process.argv.includes('--index')) writeFileSync(join(dir, 'index.js'), bankIndexSource(dir));
  writeFileSync(join(HERE, 'CATALOG.md'), catalogMarkdown(catalogEntries(dir)));
  const problems = catalogProblems(catalogEntries(dir));
  console.log(JSON.stringify({ ok: problems.length === 0, entries: catalogEntries(dir).length, problems }, null, 1));
  process.exit(problems.length ? 1 : 0);
}
