// Screenshot hub pages at 1440 px and 390 px (BUILD_PLAN §A1.3).
//   node "planning/Social Hub/shoot.mjs" <milestone> <path> [<path> ...]
// Expects `npx next dev -p 3123` running. Writes screens/<milestone>/<name>-<width>.png
// and prints, per shot: horizontal overflow on phone, console errors, HTTP status.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const [milestone, ...paths] = process.argv.slice(2);
if (!milestone || paths.length === 0) {
  console.error("usage: shoot.mjs <milestone> <path>...");
  process.exit(2);
}
const ORIGIN = process.env.SHOOT_ORIGIN ?? "http://localhost:3123";
const out = join(HERE, "screens", milestone);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const report = [];
for (const width of [1440, 390]) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  for (const p of paths) {
    const [url, action] = p.split("#click=");
    const errors = [];
    page.removeAllListeners("console");
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
    page.removeAllListeners("pageerror");
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    const res = await page.goto(ORIGIN + url, { waitUntil: "networkidle", timeout: 120000 });
    if (action) {
      await page.click(action, { timeout: 10000 }).catch((e) => errors.push(`click failed: ${e.message.slice(0, 120)}`));
      await page.waitForTimeout(600);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const name = p.replace(/^\/+/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
    // caret: "initial": the default caret hiding injects a style into inputs, which React reports as a hydration mismatch when the shot lands mid-hydration.
    await page.screenshot({ path: join(out, `${name}-${width}.png`), fullPage: true, caret: "initial" });
    report.push({ width, path: p, status: res?.status(), overflowPx: overflow, errors });
  }
  await context.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
const bad = report.filter((r) => r.status >= 400 || (r.width === 390 && r.overflowPx > 0) || r.errors.length);
if (bad.length) { console.error(`SHOOT ISSUES: ${bad.length}`); process.exitCode = 1; }
