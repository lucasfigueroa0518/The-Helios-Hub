#!/usr/bin/env node
/**
 * True first-load JS per App Router page: the union of the chunks of the root
 * layout, every nested layout on the route, and the page itself, gzipped.
 * `next build`'s "First Load JS" column leaves the layouts out, so for this app
 * it understates every signed-in page by the root layout's ~50 KB.
 *
 *   node perf/lib/bundle-sizes.mjs                 # table for every page
 *   node perf/lib/bundle-sizes.mjs --json out.json # also write JSON
 *   node perf/lib/bundle-sizes.mjs --check perf/budgets.json   # exit 1 over budget
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const NEXT = path.join(ROOT, '.next');
const manifest = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-build-manifest.json'), 'utf8')).pages;

const gzCache = new Map();
function gz(file) {
  if (!gzCache.has(file)) gzCache.set(file, gzipSync(fs.readFileSync(path.join(NEXT, file)), { level: 9 }).length);
  return gzCache.get(file);
}

/** "/hub/queue/page" -> ["/layout", "/hub/layout", "/hub/queue/page"] (only entries that exist). */
function chain(page) {
  const segments = page.replace(/\/page$/, '').split('/').filter(Boolean);
  const out = ['/layout'];
  for (let i = 1; i <= segments.length; i += 1) {
    const key = `/${segments.slice(0, i).join('/')}/layout`;
    if (manifest[key]) out.push(key);
  }
  out.push(page);
  return out;
}

/** Route path users see: route groups and slots removed. */
export function routeOf(page) {
  return page.replace(/\/page$/, '').split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@')).join('/').replace(/^/, '/');
}

export function firstLoad(page) {
  const files = new Set();
  for (const entry of chain(page)) for (const f of manifest[entry] ?? []) if (f.endsWith('.js')) files.add(f);
  const pageOnly = (manifest[page] ?? []).filter((f) => f.endsWith('.js'));
  const shared = new Set(manifest['/layout'].filter((f) => f.endsWith('.js')));
  return {
    page,
    route: routeOf(page),
    kb: Math.round([...files].reduce((s, f) => s + gz(f), 0) / 102.4) / 10,
    files: [...files],
    pageOnlyKb: Math.round(pageOnly.filter((f) => !shared.has(f)).reduce((s, f) => s + gz(f), 0) / 102.4) / 10,
  };
}

export function allPages() {
  return Object.keys(manifest).filter((k) => k.endsWith('/page') && !k.startsWith('/_')).map(firstLoad).sort((a, b) => b.kb - a.kb);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const pages = allPages();
  const jsonAt = args.indexOf('--json');
  if (jsonAt >= 0) fs.writeFileSync(args[jsonAt + 1], JSON.stringify(pages.map(({ files, ...rest }) => rest), null, 2));
  const checkAt = args.indexOf('--check');
  if (checkAt >= 0) {
    const budgets = JSON.parse(fs.readFileSync(args[checkAt + 1], 'utf8')).bundles;
    let failed = 0;
    for (const [route, limitKb] of Object.entries(budgets)) {
      const hit = pages.find((p) => p.route === route);
      if (!hit) { console.log(`?    ${route}: not in this build`); continue; }
      const ok = hit.kb <= limitKb;
      if (!ok) failed += 1;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${route.padEnd(44)} ${String(hit.kb).padStart(7)} KB gz  (budget ${limitKb})`);
    }
    process.exit(failed ? 1 : 0);
  }
  for (const p of pages) console.log(`${String(p.kb).padStart(7)} KB  ${p.route}`);
}
