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
for (const [name, s] of Object.entries(sides)) {
  const [k, ...v] = cookie.split('=');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: k, value: v.join('='), domain: '127.0.0.1', path: '/' }]);
  pages[name] = await ctx.newPage();
  const t0 = Date.now();
  await pages[name].goto(`http://127.0.0.1:${s.port}/trello`, { waitUntil: 'load', timeout: 120000 });
  await pages[name].getByText('Views', { exact: true }).first().waitFor({ timeout: 120000 });
  console.log(`${name}: /trello interactive in ${Date.now() - t0} ms`);
}

const settle = async (page) => {
  for (let i = 0; i < 100 && (await page.getByText('Loading…').count()) > 0; i += 1) await page.waitForTimeout(100);
  await page.waitForTimeout(400);
};
const text = (page, sel = 'body') => page.locator(sel).first().innerText();
const results = [];
async function compare(label, act, sel) {
  const out = {};
  for (const name of ['A', 'B']) {
    await act(pages[name]);
    await settle(pages[name]);
    out[name] = await text(pages[name], sel);
  }
  const same = out.A === out.B;
  results.push({ label, same, chars: out.A.length });
  console.log(`${same ? 'SAME' : 'DIFF'}  ${label} (${out.A.length} chars)`);
  if (!same) {
    const a = out.A.split('\n'), b = out.B.split('\n');
    for (let i = 0, shown = 0; i < Math.max(a.length, b.length) && shown < 8; i += 1) if (a[i] !== b[i]) { console.log(`   A: ${a[i]}\n   B: ${b[i]}`); shown += 1; }
  }
}

await compare('home', async () => {});
await compare('activity view', (p) => p.getByText('Activity', { exact: true }).first().click());
// The profile pill sits next to the Sign out button.
await compare('profile', (p) => p.getByLabel('Sign out').locator('xpath=preceding-sibling::button[1]').click());
await compare('home again', (p) => p.getByLabel('Go to workspace home').click());
// The first board on Home, then its card faces (badges: checklist, comments, attachments).
await compare('board', (p) => p.locator('button[class*="h-[128px]"]').first().click());
const titles = await pages.A.locator('h3').allInnerTexts();
let opened = 0;
for (const title of titles) {
  if (opened >= CARDS || !title.trim()) continue;
  const found = await pages.B.getByText(title, { exact: true }).count();
  if (!found) continue;
  await compare(`card "${title.slice(0, 40)}": comments`, (p) => p.getByText(title, { exact: true }).first().click(), '[role="dialog"]');
  await compare(`card "${title.slice(0, 40)}": activity`, (p) => p.locator('[role="dialog"] [role="tab"]', { hasText: 'Activity' }).click(), '[role="dialog"]');
  for (const p of Object.values(pages)) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
  opened += 1;
}
await browser.close();
const diffs = results.filter((r) => !r.same).length;
console.log(`${results.length - diffs}/${results.length} screens identical`);
if (args.out) fs.writeFileSync(args.out, JSON.stringify({ user: user.id, results }, null, 2));
stop();
process.exit(diffs ? 1 : 0);
