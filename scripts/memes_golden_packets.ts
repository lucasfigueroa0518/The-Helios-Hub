/**
 * Build one reading packet per template for the G3 coding pass
 * (planning/Memes/GOLDEN_SET.md): our card, the picture, Know Your Meme's
 * write-up, the Imgflip winners, the tech-tag memes on the template, the
 * flops, and every meme of ours on it with Lucas's rating. Local only
 * (.memes-local/golden/packets/). Offline, no model calls.
 *
 *   npx tsx scripts/memes_golden_packets.ts [--only drake]
 */
import fs from 'node:fs';
import path from 'node:path';

import { BLUE_CHIP_PLAYERS } from '@/lib/social-hub/blue-chip-players';
import { TEMPLATE_CATALOG } from '@/lib/memes/catalog';
import { latestEvalFile, loadEvalSet, type EvalMeme } from '@/lib/memes/eval';
import { GOLDEN_DIR, isNoise, loadGoldenTemplate, pct, splitWinnersFlops, type GoldenPost, type GoldenTechPost } from '@/lib/memes/golden';
import { cardText } from '@/lib/memes/writer';

const argv = process.argv.slice(2);
const only = argv.indexOf('--only') >= 0 ? new Set(argv[argv.indexOf('--only') + 1]!.split(',')) : null;

const OUT = path.join(GOLDEN_DIR, 'packets');
fs.mkdirSync(OUT, { recursive: true });

const techFile = path.join(GOLDEN_DIR, 'tech.json');
const tech = fs.existsSync(techFile) ? (JSON.parse(fs.readFileSync(techFile, 'utf8')) as GoldenTechPost[]).filter((p) => !isNoise(p)) : [];
const evalFile = latestEvalFile();
const set = evalFile ? loadEvalSet(evalFile) : null;
const playerName = new Map(BLUE_CHIP_PLAYERS.map((p) => [p.id, p.name]));
const RATING = ['', 'Horrible', 'No', 'Yes', 'Awesome'];

const line = (p: GoldenPost) => `- [${p.upvotes}↑] ${p.title ? `(title: ${p.title}) ` : ''}${p.boxes.map((b, i) => `B${i + 1}: ${b || '∅'}`).join(' | ')}`;
const ours = (m: EvalMeme) =>
  m.fills.map((f) => `${f.slot}=${f.kind === 'entity' ? `[logo ${playerName.get(f.playerId) ?? f.playerId}]` : JSON.stringify(f.text)}`).join(' ; ');

/** The newest run per story, so superseded runs don't repeat. */
const newestRuns = (() => {
  if (!set) return new Set<string>();
  const order = new Map(set.runs.map((r, i) => [r.id, i]));
  const best = new Map<string, string>();
  for (const r of set.runs.filter((x) => x.pipeline === 'v3' && x.kind !== 'landscape')) {
    const k = r.storyIds.join(',');
    const had = best.get(k);
    if (!had || order.get(r.id)! > order.get(had)!) best.set(k, r.id);
  }
  return new Set(best.values());
})();

let written = 0;
for (const t of TEMPLATE_CATALOG) {
  if (only && !only.has(t.id)) continue;
  const file = loadGoldenTemplate(t.id);
  const kymFile = path.join(GOLDEN_DIR, 'kym', `${t.id}.md`);
  const kym = fs.existsSync(kymFile) ? fs.readFileSync(kymFile, 'utf8') : '(no Know Your Meme text harvested)';
  const clean = (file?.posts ?? []).filter((p) => !isNoise(p));
  const { flops } = splitWinnersFlops(file?.posts ?? []);
  const top = clean.filter((p) => p.seen.some((l) => l.sort !== 'latest')).sort((a, b) => b.upvotes - a.upvotes).slice(0, 70);
  const techHere = tech.filter((p) => p.templateId === t.id).sort((a, b) => b.upvotes - a.upvotes).slice(0, 40);
  const boxCounts = top.map((p) => p.boxes.length);
  const byBox = Array.from({ length: Math.max(0, ...boxCounts) }, (_, i) => {
    const xs = top.map((p) => p.boxes[i]?.trim() ?? '').filter(Boolean).map((x) => x.length);
    return xs.length >= 3 ? `B${i + 1}: n=${xs.length}, chars p50 ${pct(xs, 50)}, p75 ${pct(xs, 75)}, p90 ${pct(xs, 90)}` : null;
  }).filter(Boolean);
  const mine = (set?.memes ?? []).filter((m) => m.templateId === t.id && (m.rating != null || (m.inSlate && newestRuns.has(m.runId))));

  const md = [
    `# ${t.name} (${t.id})`,
    '',
    `Picture: lib/memes/assets/templates/${t.image} (${t.width}×${t.height}). Look at it.`,
    `Imgflip page: https://imgflip.com/meme/${file?.imgflipSlug ?? t.imgflipId}`,
    '',
    '## Our current card (what the writer sees today)',
    '```',
    cardText(t),
    '```',
    '',
    '## Know Your Meme',
    kym.slice(0, 6000),
    '',
    `## Imgflip box lengths in the top posts (${top.length} posts; usual box count ${[...boxCounts.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<number, number>())].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} boxes ×${c}`).join(', ')})`,
    ...byBox,
    '',
    `## Top real uses, by upvotes (${top.length}). B1, B2… are Imgflip's text boxes in order; "title" is the poster's caption above the image, not in it.`,
    ...top.map(line),
    '',
    `## Tech and AI memes on this template (${techHere.length}, from Imgflip tech tags)`,
    ...(techHere.length ? techHere.map(line) : ['(none)']),
    '',
    `## Flops: same template, newest posts with 0–2 upvotes (${Math.min(flops.length, 35)})`,
    ...flops.slice(0, 35).map(line),
    '',
    `## Our memes on this template (${mine.length}): every graded one, plus the latest v3 slates`,
    ...(mine.length
      ? mine.map((m) => `- ${m.pipeline} ${m.rating ? `Lucas: ${RATING[m.rating]}` : 'ungraded'}${m.note ? ` (note: ${m.note})` : ''} | story: ${m.headline.slice(0, 90)} | ${ours(m)}`)
      : ['(none)']),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, `${t.id}.md`), md);
  written += 1;
}
console.log(`Wrote ${written} packets to ${OUT}`);
