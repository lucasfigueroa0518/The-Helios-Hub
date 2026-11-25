#!/usr/bin/env node
/**
 * Splits one page's per-frame rendering cost into style and layout, at 4x CPU, against a
 * running server (perf/lib/serve.mjs). Writes are blocked as in the harness.
 *   node perf/interaction/render-cost.mjs /hub/queue
 */
import { mintSessionCookie } from '../lib/session.mjs';

const route = process.argv[2] ?? '/hub/queue';
const PORT = Number(process.env.PERF_APP_PORT ?? 3100);
const cookie = await mintSessionCookie();
const [k, ...v] = cookie.split('=');
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: k, value: v.join('='), domain: '127.0.0.1', path: '/' }]);
await ctx.route('**/*', (r) => (r.request().method() === 'GET' ? r.continue() : r.fulfill({ status: 503, body: '' })));
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(1000);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const out = await page.evaluate(() => {
  const n = document.getElementsByTagName('*').length;
  const med = (f) => { const xs = []; for (let i = 0; i < 7; i += 1) xs.push(f()); xs.sort((a, b) => a - b); return +xs[3].toFixed(1); };
  // Style: invalidate every element's style, then read one computed value.
  const style = med(() => { const t = performance.now(); document.body.classList.toggle('__rc'); getComputedStyle(document.body.lastElementChild || document.body).color; return performance.now() - t; });
  // Layout: change the root width by one pixel and force layout.
  let w = 0;
  const layout = med(() => { w = 1 - w; document.documentElement.style.width = w ? 'calc(100% - 1px)' : ''; const t = performance.now(); void document.body.offsetHeight; return performance.now() - t; });
  const sels = ['.send-queue-day-panel', '.send-queue-board-scroller', 'main', '.hub-sidebar'];
  const counts = Object.fromEntries(sels.map((s) => [s, document.querySelectorAll(s).length]));
  const scroller = document.querySelector('.send-queue-board-scroller');
  const inside = scroller ? scroller.getElementsByTagName('*').length : 0;
  const visible = scroller ? [...scroller.children].filter((c) => { const r = c.getBoundingClientRect(); const s = scroller.getBoundingClientRect(); return r.right > s.left && r.left < s.right; }).length : 0;
  return { elements: n, styleMs: style, layoutMs: layout, counts, boardElements: inside, panelsVisible: visible };
});
console.log(JSON.stringify(out));
await browser.close();
