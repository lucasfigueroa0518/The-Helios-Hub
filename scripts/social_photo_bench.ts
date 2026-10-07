/**
 * Photo-finder bench (link B): runs the photo finder (spec §5.1 Photo chain
 * v1) on the fixed request set (fixtures/social/photo-bench/requests.json +
 * company-stories.json). No Writer, no Claude text calls. Never reads or
 * writes the used-photo log.
 *
 * Fixed inputs: Openverse results are frozen in
 * fixtures/social/photo-bench/openverse-cache.json (--refresh-stock records
 * them again), so runs differ only by the code under test.
 *
 * Two modes:
 *   live      Jev (pre-screen, identity) and, with --vision, the vision check;
 *             Wikidata / Commons for P18 and logos. Capped by --cap-usd.
 *   --replay  the frozen stock link, NO live calls: every stock request runs
 *             with the Jev and vision answers saved from the accepted run
 *             (fixtures/social/photo-bench/accepted-stock.json), the network
 *             blocked, and must pick exactly what was accepted. Stat-slide
 *             requests run as story slides: chain v1 gives stat slides a
 *             designed background, but the stock step itself must be unchanged.
 *
 * Each request runs on its own (a fresh post context). Output
 * (runs/photo-bench-<ts>[-replay]/): contact-sheet.png, table.md, bench.json.
 *
 *   npx tsx scripts/social_photo_bench.ts [--vision] [--cap-usd 0.05] [--only R1,C]
 *   npx tsx scripts/social_photo_bench.ts --replay
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { searchOpenverse, type OpenverseCandidate } from '@/lib/social/editorial/v2/image-step/openverse';
import { capped, createJevAsk, createJevTally, tallied } from '@/lib/social/jev/client';
import { replayDeps, stockOutcome, type AcceptedStock } from '@/lib/social/photos/bench-replay';
import { findPhoto, newPhotoContext, type PhotoTrace, type StockSearch } from '@/lib/social/photos/find';
import type { IdentityCache } from '@/lib/social/photos/p18';
import { createVisionCheck } from '@/lib/social/photos/vision';
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
/** Hits: a photo from the request's own chain; starter, text-only and plain are misses. */
const HIT_VIA = new Set(['article', 'subject', 'logo', 'stock']);

async function tile(url: string | null, label: string[], w: number, h: number, offline: boolean): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const photoH = h - 92;
  let photo: Buffer;
  try {
    if (!url) throw new Error('none');
    const local = url.startsWith('/') ? path.join(process.cwd(), 'public', url) : null;
    if (!local && offline) throw new Error('offline');
    const buf = local
      ? await fsp.readFile(local)
      : Buffer.from(await (await fetch(url, { headers: { 'user-agent': 'HeliosPhotoBench/1.0 (tppozo27@gmail.com)' } })).arrayBuffer());
    photo = await sharp(buf).resize(w, photoH, { fit: 'cover' }).png().toBuffer();
  } catch {
    photo = await sharp({ create: { width: w, height: photoH, channels: 3, background: '#2a2a2a' } })
      .composite([{ input: Buffer.from(`<svg width="${w}" height="${photoH}"><text x="50%" y="50%" fill="#888" font-family="Helvetica" font-size="22" text-anchor="middle">${url ? (offline ? 'photo (offline)' : 'failed to load') : 'no photo'}</text></svg>`) }])
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
  const replay = process.argv.includes('--replay');
  if (!replay) process.loadEnvFile(path.join(process.cwd(), '.env.local'));
  const capUsd = Number(arg('--cap-usd') ?? 0.05);
  const fixture = JSON.parse(await fsp.readFile('fixtures/social/photo-bench/requests.json', 'utf8'));
  const company = JSON.parse(await fsp.readFile('fixtures/social/photo-bench/company-stories.json', 'utf8'));
  const annotations: Record<string, string> = JSON.parse(await fsp.readFile('fixtures/social/photo-bench/annotations.json', 'utf8')).requests;
  const accepted = new Map<string, AcceptedStock>((JSON.parse(await fsp.readFile('fixtures/social/photo-bench/accepted-stock.json', 'utf8')).requests as AcceptedStock[]).map((a) => [a.id, a]));
  // --only: comma-separated IDs or ID prefixes ("C", "R14,R35").
  const onlyIds = arg('--only')?.split(',') ?? null;
  const requests: BenchRequest[] = ([...fixture.requests, ...company.requests] as BenchRequest[])
    .filter((r) => !onlyIds || onlyIds.some((o) => (o.length > 1 && /\d/.test(o) ? r.id === o : r.id.startsWith(o))))
    .filter((r) => !replay || accepted.has(r.id));
  const out = path.join('runs', `photo-bench-${new Date().toISOString().replace(/[:.]/g, '-')}${replay ? '-replay' : process.argv.includes('--vision') ? '-vision' : ''}`);
  await fsp.mkdir(out, { recursive: true });

  if (replay) {
    // No live calls: any network access fails the request.
    globalThis.fetch = (async (url: unknown) => { throw new Error(`replay: network blocked (${String(url).slice(0, 80)})`); }) as typeof fetch;
  }
  const CACHE = 'fixtures/social/photo-bench/openverse-cache.json';
  const cache: Record<string, OpenverseCandidate[]> = process.argv.includes('--refresh-stock') && !replay ? {} : JSON.parse(await fsp.readFile(CACHE, 'utf8').catch(() => '{}'));
  let recorded = 0;
  const stock: StockSearch = async (q, o) => {
    const key = `${q}|${o.minShortSide}`;
    if (!cache[key]) {
      if (replay) throw new Error(`replay: Openverse search "${q}" not in the frozen cache`);
      cache[key] = await searchOpenverse(q, { minShortSide: o.minShortSide });
      recorded++;
    }
    return structuredClone(cache[key]!);
  };
  const tally = createJevTally();
  const budget = createRunBudget({ capUsd, otherSpendUsd: () => tally.costUsd, reserveUsd: 0.01 });
  const liveJev = replay ? null : capped(tallied(createJevAsk(), tally), tally, capUsd);
  const liveVision = replay || !process.argv.includes('--vision') ? undefined : createVisionCheck({ create: budget.guard(liveMessagesCreate(new (await import('@anthropic-ai/sdk')).default())) });
  const identities = new Map<string, IdentityCache>();
  const rows: Array<BenchRequest & { trace: PhotoTrace; replay?: { expected: string; got: string; ok: boolean } }> = [];
  for (const r of requests) {
    const story = fixture.stories[r.story];
    const ctx = newPhotoContext(story.brief, story.pages);
    ctx.identities = identities.get(r.story) ?? new Map();
    identities.set(r.story, ctx.identities);
    const deps = replay ? { ...replayDeps(accepted.get(r.id)!), stock } : { jev: liveJev!, stock, vision: liveVision };
    // Replay: stat-slide requests run as story slides (the stock step is what's frozen).
    const slot = replay && r.slot === 'backdrop' ? 'split' : r.slot;
    const trace = await findPhoto(r.request, ctx, deps, { text: r.slideText, speaker: r.speaker, slot, cover: r.cover });
    const row: (typeof rows)[number] = { ...r, trace };
    if (replay) {
      const expected = accepted.get(r.id)!.outcome;
      const got = stockOutcome(trace);
      row.replay = { expected, got, ok: expected === got };
    }
    rows.push(row);
    console.log(`${r.id} ${r.request.kind}: ${r.request.value.slice(0, 50)} (${r.slot}${r.cover ? ', cover' : ''}) → ${trace.via}${trace.photo ? ` ${trace.photo.source}` : ''}${row.replay ? ` · replay ${row.replay.ok ? 'SAME' : `DIFFERENT (accepted ${row.replay.expected}, now ${row.replay.got})`}` : ''}${trace.visionUsd ? ` · vision $${trace.visionUsd.toFixed(4)}` : ''}`);
  }

  if (recorded) await fsp.writeFile(CACHE, JSON.stringify(cache, null, 2));
  const hits = rows.filter((x) => x.trace.via && HIT_VIA.has(x.trace.via));
  const byKind = Object.fromEntries(['subject', 'article', 'stock'].map((k) => {
    const all = rows.filter((x) => x.request.kind === k);
    return [k, `${all.filter((x) => x.trace.via && HIT_VIA.has(x.trace.via)).length}/${all.length}`];
  }));
  const different = rows.filter((x) => x.replay && !x.replay.ok);

  const short = (u: string) => (u.startsWith('/') ? u : u.replace(/^https?:\/\//, '').split('?')[0]!.slice(0, 70));
  const table = [
    `# Photo-finder bench · ${replay ? 'REPLAY of the frozen stock link (no live calls)' : 'live'} · ${new Date().toISOString()}`,
    '',
    replay
      ? `Stock requests replayed: ${rows.length} · same as accepted: ${rows.length - different.length} · different: ${different.length}`
      : `Hit rate (article, subject, logo card or stock): **${hits.length}/${rows.length}** · by kind ${JSON.stringify(byKind)} · Jev $${tally.costUsd.toFixed(4)} · vision $${budget.claudeUsd().toFixed(4)} · cap $${capUsd}`,
    '',
    '| ID | Request | Slot | Result | Source | Photo | Vision $ | Note | Trace |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((x) => `| ${x.id} | ${x.request.kind}: ${x.request.value.slice(0, 60).replace(/\|/g, '/')} | ${x.slot}${x.cover ? ' (cover)' : ''} | ${x.trace.via ?? 'none'}${x.replay ? (x.replay.ok ? ' · same as accepted' : ' · DIFFERENT') : ''} | ${x.trace.photo?.source ?? '—'} | ${x.trace.photo ? short(x.trace.photo.url) : '—'} | ${x.trace.visionUsd ? x.trace.visionUsd.toFixed(4) : '—'} | ${(annotations[x.id] ?? '').replace(/\|/g, '/')} | ${x.trace.steps.join(' → ').replace(/\|/g, '/').replace(/\n/g, ' ')} |`),
  ].join('\n');
  await fsp.writeFile(path.join(out, 'table.md'), table);
  await fsp.writeFile(path.join(out, 'bench.json'), JSON.stringify({ replay, annotations, capUsd, jevUsd: tally.costUsd, visionUsd: budget.claudeUsd(), hits: hits.length, total: rows.length, byKind, different: different.map((x) => x.id), rows }, null, 2));

  const sharp = (await import('sharp')).default;
  const W = 300, H = 300, gap = 10, cols = 6;
  const tiles: Buffer[] = [];
  for (const x of rows) {
    tiles.push(await tile(x.trace.photo?.url ?? null, [`${x.id} ${x.request.kind}: ${x.request.value.startsWith('http') ? 'article photo' : x.request.value}`, `→ ${x.trace.via ?? 'none'}${x.trace.photo ? ` (${x.trace.photo.source})` : ''} · ${x.slot}${x.cover ? ' cover' : ''}${x.replay ? (x.replay.ok ? ' · same' : ' · DIFFERENT') : ''}`, annotations[x.id] ? `NOTE: ${annotations[x.id]!.split(':')[0]}` : x.trace.photo?.subject ?? (x.trace.photo?.credit ?? '').slice(0, 44)], W, H, replay));
  }
  const rowsN = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * W + (cols + 1) * gap, height: rowsN * H + (rowsN + 1) * gap, channels: 3, background: '#000' } })
    .composite(tiles.map((input, i) => ({ input, left: gap + (i % cols) * (W + gap), top: gap + Math.floor(i / cols) * (H + gap) })))
    .png()
    .toFile(path.join(out, 'contact-sheet.png'));

  if (replay) console.log(`\nReplay: ${rows.length - different.length}/${rows.length} stock requests pick exactly what was accepted${different.length ? `; DIFFERENT: ${different.map((x) => x.id).join(', ')}` : ''}`);
  else console.log(`\nHit rate ${hits.length}/${rows.length} ${JSON.stringify(byKind)} · Jev $${tally.costUsd.toFixed(4)} · vision $${budget.claudeUsd().toFixed(4)} · total $${budget.spent().toFixed(4)} of $${capUsd}`);
  console.log(`Output: ${out}`);
  if (different.length) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
