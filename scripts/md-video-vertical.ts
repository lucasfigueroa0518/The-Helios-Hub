/**
 * Vertical fit + upscale for found MD clips (lab, 2026-11-23). Per clip: scene cuts → shots → Jev subject box per
 * sample (the photo `ESSENTIAL` prompt, D20) → crop when every shot shows ≥50% of its subject, else blur-fit →
 * Real-ESRGAN when stretched ≥1.25× (D22). Spend goes to the video ledger.
 *
 * Sharded (Lucas: "shard anything whenever possible"): --shard i/n takes every n-th clip; each finished clip writes
 * vertical/<run>-<id>.json, so a rerun skips it. A rendered mp4 without its json (an interrupted run) is reused
 * unless listed in --rerender. Then --merge writes vertical/results.json and books the spend once.
 *
 *   npx tsx scripts/md-video-vertical.ts --yes [--shard i/n] [--only run:id,...] [--rerender run:id,...] [--no-upscale]
 *   npx tsx scripts/md-video-vertical.ts --merge
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { box, image, TypeSafeClient, type Questions } from '@typesafe-ai/sdk';

import { findUpscaler } from '@/lib/reel-ai-drama/harvest/live';
import { jevCostUsd } from '@/lib/social/jev/client';
import { probe } from '@/lib/video-finder/media';
import { decideVideoFit, detectCuts, needsUpscale, renderVertical, shotsFrom, VIDEO_H, VIDEO_W, type Box } from '@/lib/video-finder/vertical';

import { ESSENTIAL } from './story-crop';

const run = promisify(execFile);
const LAB = path.join(process.cwd(), '.memes-local/news-ranker-lab/video');
const OUT = path.join(LAB, 'vertical');
const LEDGER = path.join(LAB, 'ledger.json');
const CAP_USD = 2.0; // this step is ~$0.0005 per clip

type Review = { run: string; id: string; verdict: string; note: string };
const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);

function merge() {
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const rows = fs.readdirSync(OUT).filter((f) => /^[a-z0-9]+-[0-9a-f]{8}\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')));
  const unbooked = rows.filter((r) => !r.booked);
  const cost = unbooked.reduce((s, r) => s + (r.jevUsd ?? 0), 0);
  ledger.spent += cost; ledger.runs.push({ tag: 'vertical', clips: unbooked.length, cost, at: new Date().toISOString() });
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
  for (const r of unbooked) fs.writeFileSync(path.join(OUT, `${r.run}-${r.id}.json`), JSON.stringify({ ...r, booked: true }, null, 1));
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results: rows }, null, 1));
  console.log(`merged ${rows.length} clips; booked $${cost.toFixed(4)}; ledger $${ledger.spent.toFixed(3)}`);
}

async function main() {
  if (process.argv.includes('--merge')) return merge();
  if (!process.argv.includes('--yes')) return console.log('dry run: add --yes');
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const only = arg('--only')?.split(',');
  const rerender = new Set(arg('--rerender')?.split(',') ?? []);
  const [si, sn] = (arg('--shard') ?? '0/1').split('/').map(Number) as [number, number];
  const reviews = (JSON.parse(fs.readFileSync(path.join(LAB, 'review.json'), 'utf8')) as Review[])
    .filter((r) => r.verdict !== 'wrong' && (!only || only.includes(`${r.run}:${r.id}`)))
    .filter((_, k) => k % sn === si)
    .filter((r) => !fs.existsSync(path.join(OUT, `${r.run}-${r.id}.json`)));
  const esrgan = process.argv.includes('--no-upscale') ? null : findUpscaler();
  const jev = new TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' } });
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`shard ${si}/${sn}: ${reviews.length} clips`);
  for (const rv of reviews) {
    const key = `${rv.run}:${rv.id}`;
    let jevUsd = 0, calls = 0;
    const res = JSON.parse(fs.readFileSync(path.join(LAB, rv.run, 'results.json'), 'utf8')) as { results: { story: { id: string; headline: string }; pick: { clip: string } | null }[] };
    const row = res.results.find((x) => x.story.id === rv.id);
    if (!row?.pick?.clip) continue;
    const src = path.join(LAB, row.pick.clip);
    const p = await probe(src);
    if (!p) continue;
    const shots = shotsFrom(await detectCuts(src), p.duration);
    const boxes: (Box | null)[][] = [];
    for (const [s, shot] of shots.entries()) {
      boxes.push(await Promise.all(shot.samples.map(async (t, k) => {
        if (ledger.spent + jevUsd > CAP_USD) return null;
        const f = path.join(OUT, `${rv.run}-${rv.id}-s${s}-${k}.jpg`);
        await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', src, '-frames:v', '1', '-q:v', '3', f]);
        try {
          const a = await jev.systemOne({ state: image(fs.readFileSync(f)), questions: { essential: box(ESSENTIAL) } as unknown as Questions, model: 'jev-preview' } as never);
          calls++;
          jevUsd += jevCostUsd({ input_tokens: a.usage.input_tokens ?? 0, output_tokens: a.usage.output_tokens ?? 0 });
          return (a.answers as Record<string, { box?: Box }>).essential?.box ?? null;
        } catch (e) { console.error(`box failed ${f}: ${e instanceof Error ? e.message.slice(0, 100) : e}`); return null; }
      })));
    }
    const fit = decideVideoFit(p.width, p.height, shots, boxes);
    const out = path.join(OUT, `${rv.run}-${rv.id}.mp4`);
    const t0 = Date.now();
    const done = fs.existsSync(out) && !rerender.has(key) ? await probe(out) : null;
    let r: { upscaled: boolean; note?: string; stretch: number };
    if (done && done.width === VIDEO_W && done.height === VIDEO_H && done.duration > 1) {
      const stretch = fit.mode === 'blur' ? Math.min(VIDEO_W / p.width, VIDEO_H / p.height) : VIDEO_H / p.height;
      r = { upscaled: Boolean(esrgan) && needsUpscale(stretch), stretch: Math.round(stretch * 100) / 100, note: 'reused the render from the interrupted run' };
    } else {
      r = await renderVertical(src, fit, p.width, p.height, out, OUT, esrgan);
    }
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-i', out, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', out.replace(/\.mp4$/, '.jpg')]);
    const summary = { run: rv.run, id: rv.id, verdict: rv.verdict, headline: row.story.headline, w: p.width, h: p.height, duration: Math.round(p.duration * 10) / 10, mode: fit.mode, reason: 'reason' in fit ? fit.reason : undefined, shots: fit.shots.map((s) => ({ start: s.shot.start, end: s.shot.end, shown: s.shown, left: s.left })), ...r, renderSec: Math.round((Date.now() - t0) / 1000), jevUsd, calls, file: path.relative(LAB, out) };
    fs.writeFileSync(path.join(OUT, `${rv.run}-${rv.id}.json`), JSON.stringify(summary, null, 1));
    console.log(`${key} ${p.width}x${p.height} ${shots.length} shots → ${fit.mode}${'reason' in fit ? ` (${fit.reason})` : ''}; ${r.upscaled ? 'upscaled' : 'not upscaled'} ×${r.stretch} in ${summary.renderSec}s${r.note ? `; ${r.note}` : ''}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
