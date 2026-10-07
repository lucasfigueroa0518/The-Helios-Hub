/**
 * Helios-designed graphics (spec §5.1a, Photo chain v1), made from the
 * Helios design system: the near-black canvas (#0A0A0A), the logo's radial
 * sun gradient (#FF8A4F → #FF5E1A → #E63946) and 1px hairlines. No photos,
 * no patterns, textures or grain, no AI imagery, nothing that draws or
 * implies data. Off in the daily run until Tommy approves them once
 * (lib/social/photos/designed.ts).
 *
 *   npx tsx scripts/social_designed_graphics.ts generate
 *     → public/social/bank/stat/*.png + manifest entries (kind stat-background)
 *   npx tsx scripts/social_designed_graphics.ts samples
 *     → runs/designed-graphics-2026-10-07/: every background, and 3 stat
 *       slides + 3 branded cover cards rendered on real saved drafts
 *
 * Offline: no AI calls, no network (the render check loads fonts only).
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { BANK_MANIFEST, loadBank, type BankEntry } from '@/lib/social/photos/bank';
import { checkRenderFit } from '@/lib/social/render/fit-check';
import type { Post, SlideCopy } from '@/lib/social/render/types';

const W = 1080;
const H = 1350;
const CANVAS = '#0A0A0A';
const OUT = 'runs/designed-graphics-2026-10-07';

/** The logo's radial sun, as an SVG gradient (opacity scales the whole glow). */
const sun = (id: string, opacity: number) => `
  <radialGradient id="${id}" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#FF8A4F" stop-opacity="${opacity}"/>
    <stop offset="38%" stop-color="#FF5E1A" stop-opacity="${(opacity * 0.62).toFixed(3)}"/>
    <stop offset="70%" stop-color="#E63946" stop-opacity="${(opacity * 0.22).toFixed(3)}"/>
    <stop offset="100%" stop-color="#E63946" stop-opacity="0"/>
  </radialGradient>`;
const hair = 'rgba(255,255,255,0.10)';

type Design = { id: string; theme: string; tags: string[]; svg: string };

function svg(body: string, defs: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs><rect width="${W}" height="${H}" fill="${CANVAS}"/>${body}</svg>`;
}

/** 5 themes × 3 variants. Every motif is the sun or a hairline; positions vary so no two read alike. */
export function designs(): Design[] {
  const out: Design[] = [];
  // Sunrise: the sun rising from the bottom edge (behind the big number), three positions.
  [[540, 0.9], [220, 0.8], [860, 0.8]].forEach(([cx, o], i) =>
    out.push({ id: `sunrise-${i + 1}`, theme: 'sunrise', tags: ['sunrise', 'radial sun', 'bottom edge'], svg: svg(`<circle cx="${cx}" cy="${H + 120}" r="760" fill="url(#g)"/>`, sun('g', o as number)) }));
  // Corner: the sun from one corner, three corners.
  [[W + 80, -80], [-80, -80], [-80, H + 80]].forEach(([cx, cy], i) =>
    out.push({ id: `corner-${i + 1}`, theme: 'corner', tags: ['corner glow', 'radial sun'], svg: svg(`<circle cx="${cx}" cy="${cy}" r="820" fill="url(#g)"/>`, sun('g', 0.75)) }));
  // Eclipse: a dark disc rimmed by the sun's glow, partly off-canvas.
  [[W - 140, 260, 300], [160, H - 300, 340], [W / 2, -60, 380]].forEach(([cx, cy, r], i) =>
    out.push({ id: `eclipse-${i + 1}`, theme: 'eclipse', tags: ['eclipse', 'radial sun', 'ring'], svg: svg(`<circle cx="${cx}" cy="${cy}" r="${(r as number) * 1.55}" fill="url(#g)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${CANVAS}"/>`, sun('g', 0.85)) }));
  // Horizon: one hairline across the slide with the sun's glow resting on it.
  [[H * 0.62], [H * 0.7], [H * 0.55]].forEach(([y], i) =>
    out.push({ id: `horizon-${i + 1}`, theme: 'horizon', tags: ['horizon', 'hairline', 'radial sun'], svg: svg(`<circle cx="${[540, 300, 780][i]}" cy="${y}" r="520" fill="url(#g)"/><rect x="0" y="${y}" width="${W}" height="${H - (y as number)}" fill="${CANVAS}" opacity="0.88"/><line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(255,138,79,0.55)" stroke-width="1"/>`, sun('g', 0.7)) }));
  // Frame: an inset hairline frame (structure, as in the design system's hairline borders) with a faint sun inside.
  [[540, 675], [800, 420], [280, 980]].forEach(([cx, cy], i) =>
    out.push({ id: `frame-${i + 1}`, theme: 'frame', tags: ['frame', 'hairline', 'radial sun'], svg: svg(`<circle cx="${cx}" cy="${cy}" r="640" fill="url(#g)"/><rect x="48.5" y="48.5" width="${W - 97}" height="${H - 97}" fill="none" stroke="${hair}" stroke-width="1"/>`, sun('g', 0.45)) }));
  return out;
}

async function generate() {
  const sharp = (await import('sharp')).default;
  const dir = path.join('public', 'social', 'bank', 'stat');
  await fsp.mkdir(dir, { recursive: true });
  const kept = (await loadBank()).filter((e) => !e.url.startsWith('/social/bank/stat/'));
  const entries: BankEntry[] = [];
  for (const d of designs()) {
    await sharp(Buffer.from(d.svg)).png().toFile(path.join(dir, `${d.id}.png`));
    entries.push({ id: `stat-${d.id}`, url: `/social/bank/stat/${d.id}.png`, kind: 'stat-background', tags: d.tags, credit: 'Helios', width: W, height: H, addedAt: '2026-10-07' });
  }
  await fsp.writeFile(BANK_MANIFEST, JSON.stringify([...kept, ...entries], null, 2));
  console.log(`${entries.length} stat backgrounds → ${dir}; manifest ${BANK_MANIFEST}`);
}

/** Real saved posts: the PREVIEW run's two posts and the 2026-10-06 run's two. */
async function savedPosts(): Promise<Array<{ name: string; post: Post }>> {
  const out: Array<{ name: string; post: Post }> = [];
  for (const dir of ['runs/daily-2026-10-07T03-45-32-722Z', 'runs/daily-2026-10-06T21-17-07-066Z']) {
    const run = JSON.parse(await fsp.readFile(path.join(dir, 'run.json'), 'utf8'));
    for (const p of run.result.posts) out.push({ name: p.title, post: p.render });
  }
  return out;
}

async function samples() {
  const sharp = (await import('sharp')).default;
  await fsp.mkdir(OUT, { recursive: true });
  // Every background, as a contact sheet.
  const bank = (await loadBank()).filter((e) => e.kind === 'stat-background');
  const tw = 270, th = 338, gap = 12, cols = 5;
  const tiles = await Promise.all(bank.map((e) => sharp(path.join('public', e.url)).resize(tw, th).png().toBuffer()));
  const rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * tw + (cols + 1) * gap, height: rows * th + (rows + 1) * gap, channels: 3, background: '#222' } })
    .composite(tiles.map((input, i) => ({ input, left: gap + (i % cols) * (tw + gap), top: gap + Math.floor(i / cols) * (th + gap) })))
    .png()
    .toFile(path.join(OUT, 'stat-backgrounds-all.png'));

  const posts = await savedPosts();
  // 3 stat slides on real saved drafts, each with a different background (as the 7-day rule would pick).
  const stats: Array<{ name: string; slide: SlideCopy; post: Post }> = [];
  for (const { name, post } of posts) for (const sl of post.slides) if ((sl.layoutVariant === 'stat' || sl.layoutVariant === 'split_stat') && stats.length < 3) stats.push({ name, slide: sl, post });
  const picks = ['sunrise-1', 'eclipse-1', 'horizon-1'];
  for (const [i, s] of stats.entries()) {
    const bg = bank.find((e) => e.id === `stat-${picks[i]}`)!;
    const slide: SlideCopy = { ...s.slide, position: 0, photoUrl: bg.url, photoCredit: '', photoKind: 'scene', photoFocus: undefined };
    // A neighbour slide makes the render check load both fonts.
    const post: Post = { ...s.post, slides: [slide, { position: 1, layoutVariant: 'text', headline: [{ text: 'x', role: 'narrative' }], body: [{ text: 'x', role: 'narrative' }], altText: 'x' }] };
    const fit = await checkRenderFit(post, { screenshotDir: path.join(OUT, '.tmp'), name: `stat-${i + 1}` });
    await fsp.rename(path.join(OUT, '.tmp', `stat-${i + 1}-slide-01.png`), path.join(OUT, `stat-sample-${i + 1}-${picks[i]}.png`));
    console.log(`stat sample ${i + 1} (${picks[i]}) on "${s.name}": ${fit.ok ? 'render check PASS' : JSON.stringify([...fit.problems, ...fit.violations])}`);
  }
  // 3 branded cover cards on real saved drafts.
  for (const [i, { name, post }] of posts.slice(0, 3).entries()) {
    const cover: SlideCopy = { ...post.slides[0]!, photoUrl: undefined, photoCredit: undefined, photoKind: undefined, photoFocus: undefined, logoPlate: undefined, logoWide: undefined, coverCard: true };
    const p: Post = { ...post, slides: [cover, post.slides[1]!] };
    const fit = await checkRenderFit(p, { screenshotDir: path.join(OUT, '.tmp'), name: `cover-${i + 1}` });
    await fsp.rename(path.join(OUT, '.tmp', `cover-${i + 1}-slide-01.png`), path.join(OUT, `cover-card-sample-${i + 1}.png`));
    console.log(`cover card sample ${i + 1} on "${name}": ${fit.ok ? 'render check PASS' : JSON.stringify([...fit.problems, ...fit.violations])}`);
  }
  await fsp.rm(path.join(OUT, '.tmp'), { recursive: true, force: true });
  console.log(`Samples: ${OUT}`);
}

const cmd = process.argv[2];
(cmd === 'generate' ? generate() : cmd === 'samples' ? samples() : Promise.reject(new Error('usage: generate | samples'))).catch((err) => {
  console.error(err);
  process.exit(1);
});
