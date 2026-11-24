/**
 * Held-out Morning Download run, last stage (planning/MD-LFD Revisions, 2026-11-23). Lab only, on Lucas's go-ahead.
 * For each post the photo trial picked: Jev's main-subject box and text flag → decideFit (D20) → storyFrame
 * (band fit: the subject always whole in the photo band; Real-ESRGAN only when needed, D22) → the real StoryFrame renderer with the locked writer's copy.
 *
 *   npx tsx scripts/md-held-render.ts --yes
 */
import fs from 'node:fs';
import path from 'node:path';
import { box, image, noul, TypeSafeClient, type Questions } from '@typesafe-ai/sdk';
import sharp from 'sharp';
import { jevCostUsd } from '@/lib/social/jev/client';
import { openRenderer } from '@/lib/stories/render/render';
import type { Frame } from '@/lib/stories/render/types';
import { decideBand, ESSENTIAL, HAS_TEXT, type Box } from './story-crop';
import { bandFrame } from './story-upscale';

const LAB = path.join(process.cwd(), '.memes-local/news-ranker-lab');
const HELD = path.join(LAB, 'md-held');
const OUT = path.join(HELD, 'frames');
const POOL = process.env.POOL_JSON!;

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const outletName = (h: string) => h.split('.').slice(-2, -1)[0]?.replace(/^./, (c) => c.toUpperCase()) ?? h;

async function main() {
  if (!process.argv.includes('--yes')) return console.log('add --yes');
  fs.mkdirSync(OUT, { recursive: true });
  const final = JSON.parse(fs.readFileSync(path.join(HELD, 'final.json'), 'utf8')).days as Record<string, { posts: { id: string; photo: { file: string; src: string } | null }[] }>;
  const writer = JSON.parse(fs.readFileSync(path.join(LAB, 'writer/run-held-all.json'), 'utf8')).days as Record<string, { md: { written: { key: string; headline: string; body: string }[] } }>;
  const pool = new Map<string, { url: string; h: string }>();
  for (const s of JSON.parse(fs.readFileSync(POOL, 'utf8'))) pool.set(String(s.id).slice(0, 8), { url: String(s.url ?? ''), h: String(s.h ?? '') });
  const jev = new TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' } });
  let cost = 0;
  const report: Record<string, unknown[]> = {};
  const renderer = await openRenderer();
  try {
    for (const [day, x] of Object.entries(final).sort()) {
      const copy = writer[day]?.md.written ?? [];
      const posts = x.posts.filter((p) => copy.some((w) => w.key === p.id));
      const frames: Frame[] = [];
      const total = posts.length + 2;
      const date = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
      frames.push({ series: 'morning_download', backdrop: 'black', index: 1, total, data: { role: 'opener', date, storyCount: posts.length } });
      report[day] = [];
      for (const p of posts) {
        const w = copy.find((c) => c.key === p.id)!;
        let photo: { src: string; credit: string; kind: 'scene'; contained?: boolean } | undefined;
        let fit = 'no photo', upscaled = false;
        if (p.photo) {
          const bytes = fs.readFileSync(path.join(HELD, p.photo.file));
          const meta = await sharp(bytes).metadata();
          const res = await jev.systemOne({ state: image(bytes), questions: { essential: box(ESSENTIAL), text: noul(HAS_TEXT, { true: 'Text to read in full', false: 'No text that matters' }) } as unknown as Questions, model: 'jev-preview' } as never);
          cost += jevCostUsd({ input_tokens: res.usage.input_tokens ?? 0, output_tokens: res.usage.output_tokens ?? 0 });
          const a = res.answers as Record<string, { box?: Box; noul?: number }>;
          const d = decideBand(meta.width!, meta.height!, a.essential?.box ?? null, (a.text?.noul ?? 0) >= 0.5);
          fs.mkdirSync(path.join(OUT, 'tmp'), { recursive: true });
          const f = await bandFrame(bytes, d, path.join(OUT, 'tmp'));
          const file = path.join(OUT, `${day}-${p.id}-photo.jpg`);
          fs.writeFileSync(file, f.frame);
          photo = { src: path.relative(process.cwd(), file), credit: host(p.photo.src), kind: 'scene', contained: d.contained };
          fit = d.contained ? 'contained, centred' : 'band'; upscaled = f.upscaled;
        }
        const src = pool.get(p.id);
        // Google News links carry the outlet as the headline's " - Outlet" suffix.
        const outlet = host(src?.url ?? '') === 'news.google.com' ? (/ - ([^-]{2,40})$/.exec(src!.h)?.[1] ?? 'Google News') : outletName(host(src?.url ?? ''));
        frames.push({ series: 'morning_download', backdrop: 'black', index: frames.length + 1, total, data: { role: 'story', headline: `${w.headline}. ${w.body}`, source: { verb: 'via', name: outlet }, photo } });
        report[day]!.push({ id: p.id, headline: w.headline, body: w.body, fit, upscaled, outlet });
        console.log(`${day} ${p.id}: ${fit}${upscaled ? ' +upscaled' : ''}  ${w.headline}`);
      }
      frames.push({ series: 'morning_download', backdrop: 'black', index: total, total, data: { role: 'closer' } });
      const r = await renderer.render(frames, { outDir: OUT, name: day });
      for (const fr of r.frames) if (fr.problems.length) console.warn(`${day} frame ${fr.index}: ${fr.problems.join('; ')}`);
      (report[day] as unknown as { files?: string[] }[]).push({ files: r.frames.map((fr) => fr.file ?? '') });
    }
  } finally { await renderer.close(); }
  const ledger = path.join(LAB, 'tourney/ledger.json');
  const l = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  l.spent += cost; l.runs.push({ spec: 'md-held-render', cost, at: new Date().toISOString() });
  fs.writeFileSync(ledger, JSON.stringify(l, null, 1));
  fs.writeFileSync(path.join(HELD, 'render.json'), JSON.stringify({ costUsd: cost, days: report }, null, 1));
  console.log(`jev $${cost.toFixed(4)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
