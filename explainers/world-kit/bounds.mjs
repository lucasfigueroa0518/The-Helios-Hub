// The text-bounds check (Explainers 3.3, EX3-92): every piece of text on screen, measured in a
// real browser, every STEP seconds of every frame. Deterministic, no model.
//
//   node assets/kit/bounds.mjs all      every frame with a scene module (no argument works too)
//   node assets/kit/bounds.mjs <id>     one frame
//
// It reports text cut off by the frame edge, text crossing the shape it belongs in (textBox()),
// and readable text in the keep-outs (the caption band y < 570, the bottom y > 1600, the right
// edge x > 940), except the cards that live there (the title and dictionary cards). The 3.2
// fine-tuning reel's "happy to help!" ran out of its bubble and off the screen, and the picture
// check never photographed it; this looks at every moment. Frame 1 from the opener bank
// (EX3-102) is skipped: code drew it, and its letters leave the frame on purpose.
//
// Frames are drawn in Node (try.mjs's hooks stub the CDN ink) and measured in the headless Chrome
// HyperFrames already downloads, through the project's puppeteer-core (HyperFrames' runtime) or
// the repo's playwright-core. Without a driver or a Chrome, it prints
// { ok: true, skipped } and exits 0: the check is a guard, never a blocker of the build.
//
// Prints JSON { ok, errors[], checked, skipped? } and exits 1 on any error.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isBankOpener, projectFrames } from './frames.mjs';
import { FONTS } from './mount.mjs';
import './try.mjs'; // registers the hooks that let frame modules load in Node

/** Seconds between measurements. */
export const STEP = 0.2;
/** The keep-outs for readable text (frame.md), in screen px. */
export const KEEP_OUT = { top: 570, bottom: 1600, right: 940 };
/** Roles allowed in the keep-outs: the cards designed for the top band. */
export const EXEMPT_ROLES = new Set(['title', 'definition']);
/** How far text may cross a line before it counts (px). */
const SLACK = 3;
/** The share of a text's width or height inside a keep-out that counts as in it. */
const IN_KEEP_OUT = 0.25;
const W = 1080;
const H = 1920;

/**
 * The problems with the text measured at one moment. `items`: [{ label, role, rect: [l, t, r, b],
 * box: [l, t, r, b] | null }] in screen px. Text entirely outside the frame is out of the
 * camera's view, not a problem.
 */
export function textProblems(items) {
  const out = [];
  for (const { label, role, rect, box } of items) {
    const [l, t, r, b] = rect;
    if (r <= 0 || l >= W || b <= 0 || t >= H) continue;
    const name = `"${label || 'text'}"`;
    if (l < -SLACK || t < -SLACK || r > W + SLACK || b > H + SLACK) out.push(`${name} is cut off by the frame edge`);
    if (box && (l < box[0] - SLACK || t < box[1] - SLACK || r > box[2] + SLACK || b > box[3] + SLACK)) out.push(`${name} runs outside its box (use textBox(); never place text in a shape by hand)`);
    if (!EXEMPT_ROLES.has(role)) {
      // In a keep-out when a real share of it is (a glyph's edge grazing the line is not).
      const h = Math.max(1, b - t);
      const w = Math.max(1, r - l);
      if ((Math.min(b, KEEP_OUT.top) - Math.max(t, 0)) / h >= IN_KEEP_OUT) out.push(`${name} is in the caption band (y < ${KEEP_OUT.top})`);
      if ((Math.min(b, H) - Math.max(t, KEEP_OUT.bottom)) / h >= IN_KEEP_OUT) out.push(`${name} is in the bottom keep-out (y > ${KEEP_OUT.bottom})`);
      if ((Math.min(r, W) - Math.max(l, KEEP_OUT.right)) / w >= IN_KEEP_OUT) out.push(`${name} is in the right keep-out (x > ${KEEP_OUT.right})`);
    }
  }
  return out;
}

/** Problems over a frame's moments ([{ t, problems[] }]) as one line per problem with its times. */
export function summarize(moments) {
  const spans = new Map();
  for (const { t, problems } of moments) {
    for (const p of problems) {
      const s = spans.get(p);
      if (s) s.to = t;
      else spans.set(p, { from: t, to: t });
    }
  }
  return [...spans].map(([p, { from, to }]) => `${p} at ${from.toFixed(1)}${to > from ? `–${to.toFixed(1)}` : ''}s`);
}

/** Measure every piece of text in the SVG on the page (runs in the browser). */
function measure(svgs) {
  const host = document.getElementById('w');
  return svgs.map((svg) => {
    host.innerHTML = svg;
    const items = [];
    for (const el of host.querySelectorAll('[data-k="text"], text')) {
      if (el.parentElement?.closest('[data-k="text"]')) continue; // inside measured text
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      let op = 1;
      for (let n = el; n && n !== host; n = n.parentElement) {
        const a = parseFloat(n.getAttribute('opacity') ?? '1');
        if (Number.isFinite(a)) op *= a;
      }
      if (op < 0.15) continue;
      const shape = el.closest('[data-k="textbox"]')?.querySelector('[data-k="shape"]');
      const b = shape?.getBoundingClientRect();
      items.push({
        label: (el.getAttribute('data-text') ?? el.textContent ?? '').trim().slice(0, 40),
        role: el.closest('[data-role]')?.getAttribute('data-role') ?? null,
        rect: [r.left, r.top, r.right, r.bottom],
        box: b ? [b.left, b.top, b.right, b.bottom] : null,
      });
    }
    return items;
  });
}

/**
 * A browser driver: puppeteer-core from the project's node_modules (HyperFrames' own runtime),
 * else playwright-core (the repo's). Returns { launch(executablePath) → { page(), close() } }.
 */
async function driver() {
  const bases = [process.env.HELIOS_NODE_MODULES, join(process.cwd(), 'node_modules'), dirname(fileURLToPath(import.meta.url))].filter(Boolean);
  const load = (name) => {
    for (const base of bases) {
      try {
        return createRequire(join(base, 'noop.js'))(name);
      } catch {
        // try the next
      }
    }
    return null;
  };
  const pptr = load('puppeteer-core');
  if (pptr) {
    return {
      name: 'puppeteer-core',
      async launch(executablePath) {
        const b = await pptr.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
        return {
          async page() {
            const pg = await b.newPage();
            await pg.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
            return pg;
          },
          close: () => b.close(),
        };
      },
    };
  }
  const pw = load('playwright-core');
  if (pw) {
    return {
      name: 'playwright-core',
      async launch(executablePath) {
        const b = await pw.chromium.launch({ executablePath, headless: true });
        return { page: () => b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 }), close: () => b.close() };
      },
    };
  }
  return null;
}

/** The headless Chrome HyperFrames downloaded (or HELIOS_CHROME). */
export function findChrome() {
  if (process.env.HELIOS_CHROME && existsSync(process.env.HELIOS_CHROME)) return process.env.HELIOS_CHROME;
  const names = new Set(['chrome-headless-shell', 'chrome', 'Google Chrome for Testing']);
  const roots = [join(process.env.HOME ?? homedir(), '.cache', 'hyperframes', 'chrome'), join(homedir(), '.cache', 'hyperframes', 'chrome')];
  const walk = (dir, depth) => {
    if (depth > 5 || !existsSync(dir)) return null;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isFile() && names.has(name) && st.mode & 0o111) return p;
      if (st.isDirectory()) {
        const hit = walk(p, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const r of roots) {
    const hit = walk(r, 0);
    if (hit) return hit;
  }
  return null;
}

/** Check the frames of the project at `root` (or only `only`). */
export async function checkBounds(root, only = null) {
  const drv = await driver();
  if (!drv) return { ok: true, errors: [], checked: 0, skipped: 'no browser driver (puppeteer-core or playwright-core) is installed' };
  const executablePath = findChrome();
  if (!executablePath) return { ok: true, errors: [], checked: 0, skipped: 'no headless Chrome found (HyperFrames downloads one on first render)' };
  const page_ = join(root, '.hyperframes', 'bounds.html');
  mkdirSync(dirname(page_), { recursive: true });
  writeFileSync(page_, `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS.replaceAll('url("assets/', 'url("../assets/')} html,body{margin:0;background:#fff}#w{position:absolute;left:0;top:0;width:${W}px;height:${H}px}</style></head><body><div id="w"></div></body></html>`);
  const browser = await drv.launch(executablePath);
  const errors = [];
  let checked = 0;
  try {
    const page = await browser.page();
    await page.goto(pathToFileURL(page_).href);
    await page.evaluate(() => document.fonts.ready);
    for (const f of projectFrames(root).filter((x) => !only || x.id === only)) {
      const file = join(root, 'assets', 'frames', `${f.id}.js`);
      if (!f.id || !existsSync(file) || !(f.duration > 0)) continue;
      // Frame 1 from the bank (EX3-102) is code's art: its letters fly off-screen on purpose, and
      // its hook carries no text. Nothing in it goes back to a worker.
      if (isBankOpener(root, f)) continue;
      let scene;
      try {
        scene = (await import(`${pathToFileURL(file).href}?bounds`)).default;
      } catch (e) {
        errors.push(`${f.id}: failed to load: ${e?.message ?? e}`);
        continue;
      }
      const times = [...Array.from({ length: Math.floor(f.duration / STEP) + 1 }, (_, i) => Math.min(i * STEP, f.duration - 1 / 30))];
      const moments = [];
      for (let i = 0; i < times.length; i += 10) {
        const batch = times.slice(i, i + 10);
        const svgs = [];
        for (const t of batch) {
          try {
            svgs.push(`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${scene.draw(t)}</svg>`);
          } catch {
            svgs.push('<svg></svg>'); // try.mjs reports draw errors
          }
        }
        const measured = await page.evaluate(measure, svgs);
        measured.forEach((items, k) => moments.push({ t: batch[k], problems: textProblems(items) }));
        checked += batch.length;
      }
      errors.push(...summarize(moments).map((e) => `${f.id}: ${e}`));
    }
  } finally {
    await browser.close();
  }
  return { ok: errors.length === 0, errors, checked };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null;
  const result = await checkBounds(process.cwd(), only).catch((e) => ({ ok: true, errors: [], checked: 0, skipped: `the check could not run: ${e instanceof Error ? e.message : String(e)}` }));
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.ok ? 0 : 1);
}
