#!/usr/bin/env node
/**
 * Same screens, two builds: drives /trello on build A (before) and build B (after)
 * side by side as one seeded user and compares what each shows: Home, the
 * notification bell, the Activity view, the Profile, a board's card faces, and
 * open cards (comments, then activity). Used to check that loading card details
 * on demand changed what loads, not what the person sees.
 *   source perf/env.sh
 *   node perf/lib/trello-ab-check.mjs --a /path/to/before --b . [--user <uuid>] [--email <email>] [--cards 4]
 * Local database only. No paid API is reachable (perf/env.sh stub modes).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mintSessionCookie } from './session.mjs';

const PERF_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []));
const user = { id: args.user ?? '00000000-0000-4000-8000-00000000f001', email: args.email ?? 'perf.tester@heliosgroup.ai' };
const CARDS = Number(args.cards ?? 4);
const sides = { A: { dir: path.resolve(args.a), port: 3101 }, B: { dir: path.resolve(args.b), port: 3102 } };
const domain = user.email.split('@')[1];
const proxied = new URL(process.env.DATABASE_URL);
const target = `${proxied.hostname}:${proxied.port || 5432}`;
proxied.port = '6543';
const procs = [spawn(process.execPath, [path.join(PERF_DIR, 'lib/latency-proxy.mjs'), '--listen', '6543', '--target', target, '--one-way-ms', '2.5'], { stdio: 'ignore' })];
for (const s of Object.values(sides)) {
  procs.push(spawn(path.join(s.dir, 'node_modules/.bin/next'), ['start', '-p', String(s.port), '-H', '127.0.0.1'], {
    cwd: s.dir, stdio: 'ignore', detached: true,
    env: { ...process.env, NODE_ENV: 'production', VERCEL: '1', DATABASE_URL: proxied.toString(), DIRECT_DATABASE_URL: proxied.toString(), ALLOWED_EMAIL_DOMAINS: `${process.env.ALLOWED_EMAIL_DOMAINS ?? ''},${domain}` },
  }));
}
const stop = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch { /* gone */ } } } };
process.on('exit', stop);
const cookie = await mintSessionCookie({ user });
const ping = (port) => new Promise((resolve) => { http.get(`http://127.0.0.1:${port}/api/health`, (res) => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0)); });
for (const s of Object.values(sides)) for (let i = 0; i < 300 && (await ping(s.port)) === 0; i += 1) await new Promise((r) => setTimeout(r, 200));

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const pages = {};
const base = (name) => `http://127.0.0.1:${sides[name].port}`;
// Views switch by URL (lib/trello/viewUrl.ts); each visit is a fresh load of the workspace.
async function visit(page, name, url) {
  const t0 = Date.now();
  await page.goto(`${base(name)}${url}`, { waitUntil: 'networkidle', timeout: 180000 });
  return Date.now() - t0;
}
for (const name of Object.keys(sides)) {
  const [k, ...v] = cookie.split('=');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: k, value: v.join('='), domain: '127.0.0.1', path: '/' }]);
  pages[name] = await ctx.newPage();
  await visit(pages[name], name, '/trello'); // warm
  console.log(`${name}: /trello loaded to network idle in ${await visit(pages[name], name, '/trello')} ms`);
}

// Settled: no "Loading…" on screen and the text unchanged across 600 ms (hydration and
// on-demand loads finish at different times on the two builds).
const settle = async (page, sel = 'body') => {
  let last = null;
  for (let i = 0; i < 120; i += 1) {
    await page.waitForTimeout(600);
    const now = await page.locator(sel).first().innerText().catch(() => '');
    if (now === last && !now.includes('Loading…')) return;
    last = now;
  }
};
const text = (page, sel = 'body') => page.locator(sel).first().innerText();
const results = [];
async function compare(label, act, sel = 'body') {
  const out = {};
  for (const name of ['A', 'B']) {
    await act(pages[name]);
    await settle(pages[name], sel);
    out[name] = await text(pages[name], sel);
  }
  const same = out.A === out.B;
  // Same lines in another order: rows with equal timestamps, whose order neither build fixes.
  const sameLines = !same && out.A.split('\n').sort().join('\n') === out.B.split('\n').sort().join('\n');
  results.push({ label, same, sameLines, chars: out.A.length });
  console.log(`${same ? 'SAME' : sameLines ? 'SAME LINES, ORDER DIFFERS' : 'DIFF'}  ${label} (${out.A.length} chars)`);
  if (!same) {
    const slug = label.replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
    for (const n of ['A', 'B']) fs.writeFileSync(path.join(PERF_DIR, '.local', `diff-${slug}-${n}.txt`), out[n]);
    const a = out.A.split('\n'), b = out.B.split('\n');
    for (let i = 0, shown = 0; i < Math.max(a.length, b.length) && shown < 8; i += 1) if (a[i] !== b[i]) { console.log(`   A: ${a[i]}\n   B: ${b[i]}`); shown += 1; }
  }
}

const go = (url) => async (p) => { await visit(p, p === pages.A ? 'A' : 'B', url); };
await compare('home (incl. notification bell)', go('/trello'));
await compare('activity view', go('/trello?view=activity'));
await compare('profile', go('/trello?view=profile'));
await compare('my cards', go('/trello?view=mine'));
await compare('due this week', go('/trello?view=week'));
// The first board on Home, then its card faces (badges: checklist, comments, attachments).
// Click until the board opens: the old build may still be hydrating its large document.
await compare('board', async (p) => {
  await go('/trello')(p);
  for (let i = 0; i < 60 && !/board=/.test(p.url()); i += 1) {
    await p.locator('button[class*="h-[128px]"]').first().click().catch(() => {});
    await p.waitForTimeout(500);
  }
  await p.locator('h3').first().waitFor({ timeout: 60000 });
});
// Open cards from My cards (many boards): titles that appear exactly once, so both builds open the same card.
for (const p of Object.values(pages)) { await go('/trello?view=mine')(p); await settle(p); }
// CardRow (components/trello/views/CardRow.tsx) shows the title in a truncated font-medium div.
const titles = (await pages.A.locator('li div.truncate.font-medium').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
console.log(`${titles.length} card rows in My cards`);
const unique = titles.filter((t) => titles.indexOf(t) === titles.lastIndexOf(t));
let opened = 0;
for (const title of unique) {
  if (opened >= CARDS) break;
  if ((await pages.B.getByText(title, { exact: true }).count()) !== 1) continue;
  await compare(`card "${title.slice(0, 40)}": comments`, (p) => p.getByText(title, { exact: true }).click(), '[role="dialog"]');
  await compare(`card "${title.slice(0, 40)}": activity`, (p) => p.locator('[role="dialog"] [role="tab"]', { hasText: 'Activity' }).click(), '[role="dialog"]');
  for (const p of Object.values(pages)) { await p.keyboard.press('Escape'); await p.waitForTimeout(400); }
  opened += 1;
}
await browser.close();
const diffs = results.filter((r) => !r.same && !r.sameLines).length;
const reordered = results.filter((r) => r.sameLines).length;
console.log(`${results.length - diffs - reordered}/${results.length} screens identical, ${reordered} with the same lines in another order, ${diffs} different`);
if (args.out) fs.writeFileSync(args.out, JSON.stringify({ user: user.id, results }, null, 2));
stop();
process.exit(diffs ? 1 : 0);
