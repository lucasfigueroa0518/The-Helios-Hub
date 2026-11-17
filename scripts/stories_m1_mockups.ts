/**
 * Stories M1 mock-ups: render every template on every backdrop from the
 * fixture sets (no model calls), write JPEGs and contact sheets.
 *
 *   npm run stories:mockups [-- --out exports/stories/m1]
 *   npm run stories:mockups -- --homemade    (S-53: Free vs. Paid in the
 *     homemade style, to exports/stories/m1-homemade)
 *
 * AI Trivia's frames are videos (lib/stories/trivia/render), not drawn here.
 */
import path from 'node:path';

import { contactSheet, openRenderer, type FrameReport } from '../lib/stories/render/render';
import { BACKDROPS, FREE_VS_PAID, MORNING_DOWNLOAD, MORNING_DOWNLOAD_TYPE, asSet } from '../lib/stories/render/fixtures/m1';
import type { Frame } from '../lib/stories/render/types';

const HOMEMADE = process.argv.includes('--homemade');
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(outArg > 0 ? process.argv[outArg + 1]! : HOMEMADE ? 'exports/stories/m1-homemade' : 'exports/stories/m1');

type Job = { sheet: string; title: string; cols: number; sets: Array<{ name: string; frames: Frame[]; labels: string[] }> };

const homemadeJobs: Job[] = [
  {
    sheet: 'free-vs-paid-homemade',
    title: 'HOMEMADE · Free vs. Paid: intro, paid, free',
    cols: 6,
    sets: BACKDROPS.map((b) => ({ name: `free-vs-paid/${b}/fvp`, frames: asSet('free_vs_paid', b, FREE_VS_PAID, 'homemade'), labels: [`${b} · intro`, `${b} · paid`, `${b} · free`] })),
  },
];

const polishedJobs: Job[] = [
  {
    sheet: 'morning-download',
    title: 'Helios Morning Download: opener, 3 story frames, closer. Every photo a bleed fade. Rows: black, white, orange, green',
    cols: 5,
    sets: BACKDROPS.map((b) => ({ name: `morning-download/${b}/md`, frames: asSet('morning_download', b, MORNING_DOWNLOAD), labels: ['opener', 'story 1', 'story 2', 'story 3', 'closer'].map((l) => `${b} · ${l}`) })),
  },
  {
    sheet: 'morning-download-typographic',
    title: 'Morning Download fallbacks with no photo: typographic opener and story frame',
    cols: 8,
    sets: BACKDROPS.map((b) => {
      const frames = asSet('morning_download', b, [...MORNING_DOWNLOAD_TYPE, { role: 'closer' }]).slice(0, 2);
      return { name: `morning-download/${b}/md-type`, frames, labels: [`${b} · opener`, `${b} · story`] };
    }),
  },
  {
    sheet: 'free-vs-paid',
    title: 'Free vs. Paid: intro, paid + tease, then free + how to get it',
    cols: 6,
    sets: BACKDROPS.map((b) => ({ name: `free-vs-paid/${b}/fvp`, frames: asSet('free_vs_paid', b, FREE_VS_PAID), labels: [`${b} · intro`, `${b} · paid`, `${b} · free`] })),
  },
];

const jobs = HOMEMADE ? homemadeJobs : polishedJobs;

async function main() {
  const renderer = await openRenderer();
  const failures: string[] = [];
  let count = 0;
  let maxBytes = 0;
  try {
    for (const job of jobs) {
      const files: string[] = [];
      const labels: string[] = [];
      for (const set of job.sets) {
        const dir = path.join(OUT, path.dirname(set.name));
        const res = await renderer.render(set.frames, { outDir: dir, name: path.basename(set.name) });
        failures.push(...res.problems.map((p) => `${set.name}: ${p}`));
        res.frames.forEach((f: FrameReport) => {
          failures.push(...f.problems.map((p) => `${set.name} frame ${f.index} (${f.role}): ${p}`));
          if (f.file) files.push(f.file);
          maxBytes = Math.max(maxBytes, f.bytes ?? 0);
          count++;
        });
        labels.push(...set.labels);
      }
      const sheet = await contactSheet(files, path.join(OUT, 'sheets', `${job.sheet}.jpg`), { cols: job.cols, scale: 0.25, labels, title: job.title });
      console.log(`sheet ${path.relative(process.cwd(), sheet)}`);
    }
  } finally {
    await renderer.close();
  }
  console.log(`${count} frames rendered, largest JPEG ${(maxBytes / 1024).toFixed(0)} KB`);
  if (failures.length) {
    console.log(`\n${failures.length} check failure(s):`);
    for (const f of failures) console.log(`  ${f}`);
    process.exitCode = 1;
  } else {
    console.log('all frame checks passed');
  }
}

void main();
