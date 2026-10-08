// Print full console errors for one hub path (debug aid for A1.3). node console-dump.mjs <path>
import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
p.on("console", (m) => { if (m.type() === "error") console.log(m.text().slice(0, 4000)); });
await p.goto("http://localhost:3123" + process.argv[2], { waitUntil: "networkidle" });
await b.close();
