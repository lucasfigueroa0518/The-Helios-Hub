// Debug aid (A1.3): elements wider than a 390 px viewport, outside scroll wrappers. node overflow-probe.mjs <path>
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await p.goto("http://localhost:3123" + process.argv[2], { waitUntil: "networkidle" });
console.log(JSON.stringify(await p.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  culprits: [...document.querySelectorAll("body *")]
    .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest(".sh-table-wrap, .sh-media__strip"))
    .slice(0, 8)
    .map((e) => `${e.tagName}.${[...e.classList].join(".")} right=${Math.round(e.getBoundingClientRect().right)}`),
})), null, 1));
await b.close();
