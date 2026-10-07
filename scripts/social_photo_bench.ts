/**
 * Photo-finder bench (link B; Tommy, 2026-10-06): runs the photo finder on
 * the fixed request set (fixtures/social/photo-bench/requests.json). No
 * Writer, no Claude. Jev only (stock pre-screen; subject requests also use
 * the identity check), capped at $0.05. Openverse, Wikidata and Commons are
 * free. Nothing is written to the used-photo log.
 *
 * Each request runs on its own (a fresh post context, so results don't
 * depend on order); identity checks are shared per story. The bench ignores
 * the used-photo log (no 7-day rule; Tommy, 2026-10-06): it never reads or
 * writes it.
 *
 * Fixed inputs: Openverse results are frozen in
 * fixtures/social/photo-bench/openverse-cache.json (recorded on the first
 * run, replayed after; --refresh-stock records again), so two runs differ
 * only by the code under test (e.g. pre-screen v2 vs v3).
 *
 * Output (runs/photo-bench-<ts>-<version>/): contact-sheet.png,
 * table.md (request → photo or none → source → trace), bench.json.
 *
 * --vision adds the photo vision check (a Claude vision call per checked
 * candidate; Tommy approved 2026-10-06), under one budget with Jev.
 *
 *   npx tsx scripts/social_photo_bench.ts [--prescreen v2|v3|v4] [--vision] [--cap-usd 0.05]
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

import { capped, createJevAsk, createJevTally, tallied } from '@/lib/social/jev/client';
import { findPhoto, newPhotoContext, type PhotoTrace, type StockSearch } from '@/lib/social/photos/find';
import { searchOpenverse, type OpenverseCandidate } from '@/lib/social/editorial/v2/image-step/openverse';
import type { IdentityResult } from '@/lib/social/photos/identity';
import { createVisionCheck } from '@/lib/social/photos/vision';
import { OFFICIAL_COMPANIES } from '@/lib/social/photos/official';
import { createRunBudget } from '@/lib/social/pipeline/live-stages';
import { liveMessagesCreate } from '@/lib/social/reporter/reporter';

type BenchRequest = {
  id: string;
  story: string;
  request: { kind: 'subject' | 'article' | 'stock'; value: string };
  why?: string;
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
// Hits: a photo from the request's own chain (incl. official images and logo cards); starter and text-only are misses.
const HIT_VIA = new Set(['article', 'official', 'subject', 'logo', 'stock', 'bank']);

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
  const version = (arg('--prescreen') ?? 'v4') as 'v2' | 'v3' | 'v4';
  const capUsd = Number(arg('--cap-usd') ?? 0.05);
  const fixture = JSON.parse(await fsp.readFile('fixtures/social/photo-bench/requests.json', 'utf8'));
  // Fixed company stories (image strategy (a)/(b), Tommy 2026-10-07): same stories and pages, hand-set requests.
  const company = JSON.parse(await fsp.readFile('fixtures/social/photo-bench/company-stories.json', 'utf8'));
  const only = arg('--only');
  // --only: comma-separated IDs or ID prefixes ("C", "R14,R35").
  const onlyIds = only ? only.split(',') : null;
  const requests: BenchRequest[] = [...fixture.requests, ...company.requests].filter((r: BenchRequest) => !onlyIds || onlyIds.some((o) => (o.length > 1 && /\d/.test(o) ? r.id === o : r.id.startsWith(o))));
  // --preview-allowlist: every allow-list row treated as approved, for THIS bench run only (to show what approval
  // would give). The production list (official.ts) is untouched: rows stay TBD until Tommy approves them.
  const previewAllowlist = process.argv.includes('--preview-allowlist');
  const officialList = previewAllowlist ? OFFICIAL_COMPANIES.map((c) => ({ ...c, approved: true, editorialUse: 'permitted' as const })) : undefined;
  const out = path.join('runs', `photo-bench-${new Date().toISOString().replace(/[:.]/g, '-')}-${version}${process.argv.includes('--vision') ? '-vision' : ''}${process.argv.includes('--preview-allowlist') ? '-PREVIEW-ALLOWLIST' : ''}${arg('--only') ? `-only-${arg('--only')}` : ''}`);
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
  const withVision = process.argv.includes('--vision');
  const budget = createRunBudget({ capUsd, otherSpendUsd: () => tally.costUsd, reserveUsd: 0.01 });
  const vision = withVision ? createVisionCheck({ create: budget.guard(liveMessagesCreate(new (await import('@anthropic-ai/sdk')).default())) }) : undefined;
  const identities = new Map<string, Map<string, Promise<IdentityResult>>>();
  const rows: Array<BenchRequest & { trace: PhotoTrace }> = [];
  for (const r of requests) {
    const story = fixture.stories[r.story];
    const ctx = newPhotoContext(story.brief, story.pages);
    ctx.identities = identities.get(r.story) ?? new Map();
    identities.set(r.story, ctx.identities);
    const trace = await findPhoto(r.request, ctx, { jev, prescreen: version, stock, vision, officialList }, { text: r.slideText, speaker: r.speaker, slot: r.slot, cover: r.cover });
    rows.push({ ...r, trace });
    console.log(`${r.id} ${r.request.kind}: ${r.request.value.slice(0, 50)} (${r.slot}${r.cover ? ', cover' : ''}) → ${trace.via}${trace.photo ? ` ${trace.photo.source}` : ''}${trace.visionUsd ? ` · vision $${trace.visionUsd.toFixed(4)}` : ''}`);
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
    `# Photo-finder bench · pre-screen ${version} · ${new Date().toISOString()}${previewAllowlist ? ' · PREVIEW ALLOW-LIST (every row treated as approved for this run only; production rows are TBD)' : ''}`,
    '',
    `Hit rate (a photo from the request's own chain: article, official, subject, logo card, stock or bank): **${hits.length}/${rows.length}** · by kind ${JSON.stringify(byKind)} · Jev $${tally.costUsd.toFixed(4)} · vision $${budget.claudeUsd().toFixed(4)} · cap $${capUsd}`,
    '',
    '| ID | Request | Slot | Result | Source | Photo | Vision $ | Trace |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((x) => `| ${x.id} | ${x.request.kind}: ${x.request.value.slice(0, 60).replace(/\|/g, '/')} | ${x.slot}${x.cover ? ' (cover)' : ''} | ${x.trace.via ?? 'none'} | ${x.trace.photo?.source ?? '—'} | ${x.trace.photo ? short(x.trace.photo.url) : '—'} | ${x.trace.visionUsd ? x.trace.visionUsd.toFixed(4) : '—'} | ${x.trace.steps.join(' → ').replace(/\|/g, '/').replace(/\n/g, ' ')} |`),
  ].join('\n');
  await fsp.writeFile(path.join(out, 'table.md'), table);
  const verdicts = rows.flatMap((x) => {
    const v = x.trace.steps.filter((st) => st.startsWith('vision '));
    return v.length ? [`## ${x.id} ${x.request.kind}: ${x.request.value} → ${x.trace.via}${x.trace.visionUsd ? ` ($${x.trace.visionUsd.toFixed(4)})` : ''}`, ...v.map((st) => `- ${st}`), ''] : [];
  });
  if (verdicts.length) await fsp.writeFile(path.join(out, 'verdicts.md'), [`# Vision verdicts · ${new Date().toISOString()}`, '', ...verdicts].join('\n'));
  await fsp.writeFile(path.join(out, 'bench.json'), JSON.stringify({ version, vision: withVision, capUsd, jevUsd: tally.costUsd, visionUsd: budget.claudeUsd(), capRefused: budget.exhausted(), hits: hits.length, total: rows.length, byKind, rows }, null, 2));

  // Contact sheet: 6 across.
  const sharp = (await import('sharp')).default;
  const W = 300, H = 300, gap = 10, cols = 6;
  const tiles: Buffer[] = [];
  for (const x of rows) {
    tiles.push(await tile(x.trace.photo?.url ?? null, [`${x.id} ${x.request.kind}: ${x.request.value.startsWith('http') ? 'article photo' : x.request.value}`, `→ ${x.trace.via ?? 'none'}${x.trace.photo ? ` (${x.trace.photo.source})` : ''} · ${x.slot}${x.cover ? ' cover' : ''}${x.trace.visionUsd ? ` · vision $${x.trace.visionUsd.toFixed(3)}` : ''}`, x.trace.photo?.subject ?? (x.trace.photo?.credit ?? '').slice(0, 44)], W, H));
  }
  const rowsN = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * W + (cols + 1) * gap, height: rowsN * H + (rowsN + 1) * gap, channels: 3, background: '#000' } })
    .composite(tiles.map((input, i) => ({ input, left: gap + (i % cols) * (W + gap), top: gap + Math.floor(i / cols) * (H + gap) })))
    .png()
    .toFile(path.join(out, 'contact-sheet.png'));

  console.log(`\nHit rate ${hits.length}/${rows.length} ${JSON.stringify(byKind)} · Jev $${tally.costUsd.toFixed(4)} · vision $${budget.claudeUsd().toFixed(4)} · total $${budget.spent().toFixed(4)} of $${capUsd}${budget.exhausted() ? ' (the guard refused a call)' : ''}`);
  console.log(`Output: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
