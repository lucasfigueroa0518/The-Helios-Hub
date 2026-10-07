/**
 * Photo-finder bench (link B; Tommy, 2026-10-06): runs the photo finder on
 * the fixed request set (fixtures/social/photo-bench/requests.json). No
 * Writer, no Claude. Jev only (stock pre-screen; subject requests also use
 * the identity check), capped at $0.05. Openverse, Wikidata and Commons are
 * free. Nothing is written to the used-photo log.
 *
 * Each request runs on its own (a fresh post context, so results don't
 * depend on order); identity checks are shared per story.
 *
 * Fixed inputs: Openverse results are frozen in
 * fixtures/social/photo-bench/openverse-cache.json (recorded on the first
 * run, replayed after; --refresh-stock records again), so two runs differ
 * only by the code under test (e.g. pre-screen v2 vs v3).
 *
 * Output (runs/photo-bench-<ts>-<version>/): contact-sheet.png,
 * table.md (request → photo or none → source → trace), bench.json.
 *
 *   npx tsx scripts/social_photo_bench.ts [--prescreen v2|v3] [--cap-usd 0.05]
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

import { capped, createJevAsk, createJevTally, tallied } from '@/lib/social/jev/client';
import { findPhoto, newPhotoContext, type PhotoTrace, type StockSearch } from '@/lib/social/photos/find';
import { searchOpenverse, type OpenverseCandidate } from '@/lib/social/editorial/v2/image-step/openverse';
import type { IdentityResult } from '@/lib/social/photos/identity';

type BenchRequest = {
  id: string;
  story: string;
  request: { kind: 'subject' | 'article' | 'stock'; value: string };
  slot: 'split' | 'backdrop' | 'quote';
  cover: boolean;
  where: string;
  slideText: string[];
  speaker: string | null;
};

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const HIT_VIA = new Set(['article', 'subject', 'stock', 'bank']);

async function tile(url: string | null, label: string[], w: number, h: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const photoH = h - 92;
  let photo: Buffer;
  try {
    if (!url) throw new Error('none');
    const local = url.startsWith('/') ? path.join(process.cwd(), 'public', url) : null;
    const buf = local
      ? await fsp.readFile(local)
      : Buffer.from(await (await fetch(url, { headers: { 'user-agent': 'HeliosPhotoBench/1.0 (tppozo27@gmail.com)' } })).arrayBuffer());
    photo = await sharp(buf).resize(w, photoH, { fit: 'cover' }).png().toBuffer();
  } catch {
    photo = await sharp({ create: { width: w, height: photoH, channels: 3, background: '#2a2a2a' } })
      .composite([{ input: Buffer.from(`<svg width="${w}" height="${photoH}"><text x="50%" y="50%" fill="#888" font-family="Helvetica" font-size="22" text-anchor="middle">${url ? 'failed to load' : 'no photo'}</text></svg>`) }])
      .png()
      .toBuffer();
  }
  const lines = label.map((l, i) => `<text x="8" y="${24 + i * 22}" fill="${i === 0 ? '#fff' : '#bbb'}" font-family="Helvetica" font-size="${i === 0 ? 17 : 15}">${esc(l.slice(0, 44))}</text>`).join('');
  return sharp({ create: { width: w, height: h, channels: 3, background: '#111' } })
    .composite([{ input: photo, left: 0, top: 0 }, { input: Buffer.from(`<svg width="${w}" height="92">${lines}</svg>`), left: 0, top: photoH }])
    .png()
    .toBuffer();
}

async function main() {
  const version = (arg('--prescreen') ?? 'v3') as 'v2' | 'v3';
  const capUsd = Number(arg('--cap-usd') ?? 0.05);
  const fixture = JSON.parse(await fsp.readFile('fixtures/social/photo-bench/requests.json', 'utf8'));
  const requests: BenchRequest[] = fixture.requests;
  const out = path.join('runs', `photo-bench-${new Date().toISOString().replace(/[:.]/g, '-')}-${version}`);
  await fsp.mkdir(out, { recursive: true });

  const CACHE = 'fixtures/social/photo-bench/openverse-cache.json';
  const cache: Record<string, OpenverseCandidate[]> = process.argv.includes('--refresh-stock') ? {} : JSON.parse(await fsp.readFile(CACHE, 'utf8').catch(() => '{}'));
  let recorded = 0;
  const stock: StockSearch = async (q, o) => {
    const key = `${q}|${o.minShortSide}`;
    if (!cache[key]) { cache[key] = await searchOpenverse(q, { minShortSide: o.minShortSide }); recorded++; }
    return structuredClone(cache[key]!);
  };
  const tally = createJevTally();
  const jev = capped(tallied(createJevAsk(), tally), tally, capUsd);
  const identities = new Map<string, Map<string, Promise<IdentityResult>>>();
  const rows: Array<BenchRequest & { trace: PhotoTrace }> = [];
  for (const r of requests) {
    const story = fixture.stories[r.story];
    const ctx = newPhotoContext(story.brief, story.pages);
    ctx.identities = identities.get(r.story) ?? new Map();
    identities.set(r.story, ctx.identities);
    const trace = await findPhoto(r.request, ctx, { jev, prescreen: version, stock }, { text: r.slideText, speaker: r.speaker, slot: r.slot, cover: r.cover });
    rows.push({ ...r, trace });
    console.log(`${r.id} ${r.request.kind}: ${r.request.value.slice(0, 50)} (${r.slot}${r.cover ? ', cover' : ''}) → ${trace.via}${trace.photo ? ` ${trace.photo.source}` : ''}`);
  }

  if (recorded) await fsp.writeFile(CACHE, JSON.stringify(cache, null, 2));
  console.log(`Openverse: ${recorded} searches recorded, ${Object.keys(cache).length - recorded} replayed from the fixture`);
  const hits = rows.filter((x) => x.trace.via && HIT_VIA.has(x.trace.via));
  const byKind = Object.fromEntries(['subject', 'article', 'stock'].map((k) => {
    const all = rows.filter((x) => x.request.kind === k);
    return [k, `${all.filter((x) => x.trace.via && HIT_VIA.has(x.trace.via)).length}/${all.length}`];
  }));

  // Table.
  const short = (u: string) => (u.startsWith('/') ? u : u.replace(/^https?:\/\//, '').split('?')[0]!.slice(0, 70));
  const table = [
    `# Photo-finder bench · pre-screen ${version} · ${new Date().toISOString()}`,
    '',
    `Hit rate (a photo from the request's own chain: article, subject, stock or bank): **${hits.length}/${rows.length}** · by kind ${JSON.stringify(byKind)} · Jev $${tally.costUsd.toFixed(4)} of $${capUsd}`,
    '',
    '| ID | Request | Slot | Result | Source | Photo | Trace |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((x) => `| ${x.id} | ${x.request.kind}: ${x.request.value.slice(0, 60).replace(/\|/g, '/')} | ${x.slot}${x.cover ? ' (cover)' : ''} | ${x.trace.via ?? 'none'} | ${x.trace.photo?.source ?? '—'} | ${x.trace.photo ? short(x.trace.photo.url) : '—'} | ${x.trace.steps.join(' → ').replace(/\|/g, '/').replace(/\n/g, ' ')} |`),
  ].join('\n');
  await fsp.writeFile(path.join(out, 'table.md'), table);
  await fsp.writeFile(path.join(out, 'bench.json'), JSON.stringify({ version, capUsd, jevUsd: tally.costUsd, hits: hits.length, total: rows.length, byKind, rows }, null, 2));

  // Contact sheet: 6 across.
  const sharp = (await import('sharp')).default;
  const W = 300, H = 300, gap = 10, cols = 6;
  const tiles: Buffer[] = [];
  for (const x of rows) {
    tiles.push(await tile(x.trace.photo?.url ?? null, [`${x.id} ${x.request.kind}: ${x.request.value.startsWith('http') ? 'article photo' : x.request.value}`, `→ ${x.trace.via ?? 'none'}${x.trace.photo ? ` (${x.trace.photo.source})` : ''} · ${x.slot}${x.cover ? ' cover' : ''}`, x.trace.photo?.subject ?? (x.trace.photo?.credit ?? '').slice(0, 44)], W, H));
  }
  const rowsN = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * W + (cols + 1) * gap, height: rowsN * H + (rowsN + 1) * gap, channels: 3, background: '#000' } })
    .composite(tiles.map((input, i) => ({ input, left: gap + (i % cols) * (W + gap), top: gap + Math.floor(i / cols) * (H + gap) })))
    .png()
    .toFile(path.join(out, 'contact-sheet.png'));

  console.log(`\nHit rate ${hits.length}/${rows.length} ${JSON.stringify(byKind)} · Jev $${tally.costUsd.toFixed(4)} of $${capUsd}`);
  console.log(`Output: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
