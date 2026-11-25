/**
 * The cutout bank (planning/Real Case Reels/DECISIONS.md RC-34): one photo cutout per blue-chip person.
 *
 *   npx tsx scripts/real_case_cutout_bank.ts            build every missing cutout, then the review sheet
 *   npx tsx scripts/real_case_cutout_bank.ts --sheet    rebuild only the review sheet
 *   npx tsx scripts/real_case_cutout_bank.ts --approve <id,…|all>   mark cutouts Lucas approved
 *   npx tsx scripts/real_case_cutout_bank.ts --manual <id> <photo> <qid>   bank a photo Lucas supplied (it replaces a built one)
 *
 * Per person: the Wikidata QID (pinned below once checked; otherwise resolved by exact label + "human"
 * and printed for review), its main image (P18) from Commons through the Hub's own Commons code (licence
 * allow-list PD / CC0 / CC BY / CC BY-SA, a credited author, a minimum size), a 2160px copy saved under
 * explainers/real-case/bank/source/, the background removed locally (macOS Vision:
 * explainers/real-case/bank/tools/cutout.swift), and the manifest entry with `approved: false`. Nothing
 * reaches a reel until Lucas approves it on the sheet. No model call, no paid API.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { buildCredit, fetchEntityP18, fetchImageInfo, toCandidate } from '@/lib/social/editorial/v2/image-step/commons';
import { BLUE_CHIP_PLAYERS } from '@/lib/social-hub/blue-chip-players';
import { CUTOUT_DIR, CUTOUT_MANIFEST, type BankedCutout } from '@/lib/real-case/bank';

const ROOT = process.cwd();
const SOURCE_DIR = path.join('explainers', 'real-case', 'bank', 'source');
const SHEET = path.join('.explainers-local', 'previews', 'cutout-bank', 'cutout-sheet.png');
const USER_AGENT = 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)';
/** QIDs checked by hand; a person missing here is resolved by exact label and printed for review. */
const PINNED_QIDS: Record<string, string> = {
  // Wikidata labels him "Alexander C. Karp" (businessman, Palantir); checked 2026-10-26.
  'alex-karp': 'Q19560940',
  // The entry's English label was vandalised on 2026-10-26 ("Liro Kivi"); its description is "CEO of Microsoft".
  'satya-nadella': 'Q7426870',
};

type Manifest = { cutouts: BankedCutout[]; missing: { id: string; name: string; reason: string }[] };

function readManifest(): Manifest {
  const file = path.join(ROOT, CUTOUT_MANIFEST);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest) : { cutouts: [], missing: [] };
}

function writeManifest(m: Manifest): void {
  const file = path.join(ROOT, CUTOUT_MANIFEST);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  m.cutouts.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);
}

/** The person's QID: exact English label, instance of human (Q5). Null when none or ambiguous. */
async function resolveQid(name: string): Promise<{ qid: string; description: string } | null> {
  const search = new URL('https://www.wikidata.org/w/api.php');
  Object.entries({ action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: '7', format: 'json', origin: '*' }).forEach(([k, v]) => search.searchParams.set(k, v));
  const hits = ((await (await fetch(search, { headers: { 'User-Agent': USER_AGENT } })).json()) as { search?: { id: string; label?: string; description?: string }[] }).search ?? [];
  const exact = hits.filter((h) => (h.label ?? '').toLowerCase() === name.toLowerCase());
  if (exact.length === 0) return null;
  const ids = exact.map((h) => h.id).join('|');
  const ent = new URL('https://www.wikidata.org/w/api.php');
  Object.entries({ action: 'wbgetentities', ids, props: 'claims', format: 'json', origin: '*' }).forEach(([k, v]) => ent.searchParams.set(k, v));
  const body = (await (await fetch(ent, { headers: { 'User-Agent': USER_AGENT } })).json()) as { entities: Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: { id?: string } } } }[]> }> };
  const humans = exact.filter((h) => (body.entities[h.id]?.claims?.P31 ?? []).some((c) => c.mainsnak?.datavalue?.value?.id === 'Q5'));
  return humans[0] ? { qid: humans[0].id, description: humans[0].description ?? '' } : null;
}

/**
 * When the main image is missing or unusable: Commons files whose title names the person, through the
 * same licence, author and size rules, largest first. Lucas sees every pick on the sheet.
 */
async function searchCommons(name: string): Promise<{ title: string; cand: NonNullable<ReturnType<typeof toCandidate>> } | null> {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({ action: 'query', list: 'search', srsearch: `intitle:"${name}" filetype:bitmap`, srnamespace: '6', srlimit: '20', format: 'json', origin: '*' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const hits = ((await (await fetch(u, { headers: { 'User-Agent': USER_AGENT } })).json()) as { query?: { search?: { title: string }[] } }).query?.search ?? [];
  const titles = hits.map((h) => h.title).filter((t) => /\.(jpe?g|png)$/i.test(t));
  if (!titles.length) return null;
  const infos = await fetchImageInfo(titles);
  const usable = titles
    .map((title) => ({ title, cand: infos[title] ? toCandidate(title, infos[title], 'commons-search', { minShortSide: 600 }) : null }))
    .filter((x): x is { title: string; cand: NonNullable<ReturnType<typeof toCandidate>> } => x.cand !== null)
    .sort((a, b) => Math.min(b.cand.width, b.cand.height) - Math.min(a.cand.width, a.cand.height));
  return usable[0] ?? null;
}

async function build(): Promise<void> {
  const manifest = readManifest();
  const people = BLUE_CHIP_PLAYERS.filter((p) => p.kind === 'person');
  fs.mkdirSync(path.join(ROOT, SOURCE_DIR), { recursive: true });
  fs.mkdirSync(path.join(ROOT, CUTOUT_DIR), { recursive: true });
  manifest.missing = [];
  for (const person of people) {
    if (manifest.cutouts.some((c) => c.id === person.id && fs.existsSync(path.join(ROOT, c.file)))) {
      console.log(`= ${person.name}: banked`);
      continue;
    }
    const miss = (reason: string) => {
      manifest.missing.push({ id: person.id, name: person.name, reason });
      console.log(`✗ ${person.name}: ${reason}`);
    };
    try {
      const resolved = PINNED_QIDS[person.id] ? { qid: PINNED_QIDS[person.id], description: '(pinned)' } : await resolveQid(person.name);
      if (!resolved) {
        miss('no Wikidata human with this exact name');
        continue;
      }
      const p18 = await fetchEntityP18(resolved.qid);
      let title = p18 ? `File:${p18}` : '';
      const info = p18 ? (await fetchImageInfo([title]))[title] : undefined;
      let cand = info ? toCandidate(title, info, 'P18', { minShortSide: 600 }) : null;
      let fromSearch = false;
      // A main image a little under 600px is still a usable cutout at reel size; it is flagged on the sheet.
      const small = !cand && info ? toCandidate(title, info, 'P18', { minShortSide: 480 }) : null;
      if (!cand) {
        const found = small ? null : await searchCommons(person.name);
        if (small) {
          cand = small;
          console.log(`  ${person.name}: main image is small (${info!.width}×${info!.height}); used, flagged`);
        } else if (!found) {
          miss(p18 ? `${title}: licence, author or size not usable, and no other Commons photo is` : `${resolved.qid} has no main image, and no Commons photo is usable`);
          continue;
        }
        else {
          ({ title, cand } = found);
          fromSearch = true;
          console.log(`  ${person.name}: main image ${p18 ? 'unusable' : 'missing'}; trying ${title}`);
        }
      }
      const ext = cand.mime === 'image/png' ? 'png' : 'jpg';
      const source = path.join(SOURCE_DIR, `${person.id}.${ext}`);
      const res = await fetch(cand.url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) {
        miss(`download failed: HTTP ${res.status}`);
        continue;
      }
      fs.writeFileSync(path.join(ROOT, source), Buffer.from(await res.arrayBuffer()));
      const file = path.join(CUTOUT_DIR, `${person.id}.png`);
      const out = JSON.parse(execFileSync('swift', [path.join(ROOT, 'explainers/real-case/bank/tools/cutout.swift'), path.join(ROOT, source), path.join(ROOT, file)], { encoding: 'utf8' }).trim().split('\n').pop()!) as { ok: boolean; width?: number; height?: number; error?: string; instances?: number; share?: number };
      if (!out.ok) {
        miss(`cutout failed: ${out.error}`);
        continue;
      }
      // A searched photo must show one person: with several, the largest may be someone else.
      if (fromSearch && (out.instances ?? 1) > 1) {
        fs.rmSync(path.join(ROOT, file), { force: true });
        miss(`${title} shows ${out.instances} people; no single-person licensed photo on Commons`);
        continue;
      }
      manifest.cutouts = manifest.cutouts.filter((c) => c.id !== person.id);
      manifest.cutouts.push({
        id: person.id,
        name: person.name,
        qid: resolved.qid,
        file,
        width: out.width!,
        height: out.height!,
        credit: `${buildCredit(cand)}${small && cand === small ? ' (small source)' : ''}`,
        provenance: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        approved: false,
      });
      console.log(`✓ ${person.name}: ${resolved.qid} (${resolved.description}) · ${cand.license} · ${out.instances} subject(s)`);
    } catch (error) {
      miss(error instanceof Error ? error.message : String(error));
    }
  }
  writeManifest(manifest);
}

async function sheet(): Promise<void> {
  const { chromium } = await import('playwright');
  const manifest = readManifest();
  const cards = manifest.cutouts
    .map((c) => `<figure><div class="ph"><img src="file://${path.join(ROOT, c.file)}"></div><figcaption><b>${c.name}</b><span>${c.qid} · ${c.credit.replace(/</g, '&lt;')}</span><i class="${c.approved ? 'ok' : ''}">${c.approved ? 'approved' : 'to review'}</i></figcaption></figure>`)
    .join('');
  const missing = manifest.missing.map((m) => `<li><b>${m.name}</b>: ${m.reason}</li>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:40px;background:#1a1714;font-family:Roboto,Helvetica,sans-serif;color:#eee;width:1840px}
    h1{font-size:30px;margin:0 0 6px} p{margin:0 0 26px;color:#bbb;font-size:17px}
    .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:22px}
    figure{margin:0;background:#2b2520;border-radius:10px;overflow:hidden}
    .ph{height:330px;display:flex;align-items:flex-end;justify-content:center;background:repeating-conic-gradient(#3a332c 0 25%,#2f2924 0 50%) 50%/24px 24px}
    .ph img{max-width:100%;max-height:100%;filter:drop-shadow(0 0 0 #fff) drop-shadow(3px 0 0 #fff) drop-shadow(-3px 0 0 #fff) drop-shadow(0 3px 0 #fff) drop-shadow(0 -3px 0 #fff)}
    figcaption{padding:12px 14px 14px;display:flex;flex-direction:column;gap:4px} figcaption b{font-size:18px} figcaption span{font-size:12px;color:#aaa;line-height:1.3}
    i{font-style:normal;font-size:12px;color:#f0a35e;text-transform:uppercase;letter-spacing:.12em} i.ok{color:#7cd67a}
    ul{color:#f88;font-size:16px}</style></head><body>
    <h1>Cutout bank — for Lucas's approval</h1><p>One cutout per blue-chip person: Wikidata main image (licence checked), background removed locally. Checkerboard = transparent. Approve all, or name the ones to redo.</p>
    <div class="grid">${cards}</div>${missing ? `<h1 style="margin-top:30px">Missing</h1><ul>${missing}</ul>` : ''}</body></html>`;
  const htmlFile = path.join(ROOT, SHEET.replace(/\.png$/, '.html'));
  fs.mkdirSync(path.dirname(htmlFile), { recursive: true });
  fs.writeFileSync(htmlFile, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
  await page.goto(`file://${htmlFile}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(ROOT, SHEET), fullPage: true });
  await browser.close();
  console.log(`sheet: ${SHEET}`);
}

/** A photo Lucas supplied and cleared (RC-43): cut out like the rest, provenance "supplied by Lucas". */
function manual(id: string, photo: string, qid: string): void {
  const person = BLUE_CHIP_PLAYERS.find((p) => p.kind === 'person' && p.id === id);
  if (!person) throw new Error(`no blue-chip person ${id}`);
  const file = path.join(CUTOUT_DIR, `${id}.png`);
  fs.mkdirSync(path.join(ROOT, CUTOUT_DIR), { recursive: true });
  const out = JSON.parse(execFileSync('swift', [path.join(ROOT, 'explainers/real-case/bank/tools/cutout.swift'), path.resolve(photo), path.join(ROOT, file)], { encoding: 'utf8' }).trim().split('\n').pop()!) as { ok: boolean; width?: number; height?: number; error?: string };
  if (!out.ok) throw new Error(`cutout failed: ${out.error}`);
  const manifest = readManifest();
  manifest.cutouts = manifest.cutouts.filter((c) => c.id !== id);
  manifest.missing = manifest.missing.filter((m) => m.id !== id);
  manifest.cutouts.push({
    id,
    name: person.name,
    qid,
    file,
    width: out.width!,
    height: out.height!,
    credit: 'Photo supplied by Lucas',
    provenance: `manual: ${path.relative(ROOT, path.resolve(photo))}, supplied by Lucas 2026-10-26`,
    approved: false,
  });
  writeManifest(manifest);
  console.log(`✓ ${person.name}: manual photo banked (${out.width}×${out.height})`);
}

function approve(ids: string): void {
  const manifest = readManifest();
  const want = ids === 'all' ? null : new Set(ids.split(','));
  for (const c of manifest.cutouts) if (!want || want.has(c.id)) c.approved = true;
  writeManifest(manifest);
  console.log(`approved: ${manifest.cutouts.filter((c) => c.approved).map((c) => c.id).join(', ')}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ap = args.indexOf('--approve');
  if (ap >= 0) return approve(args[ap + 1] ?? '');
  const mn = args.indexOf('--manual');
  if (mn >= 0) {
    manual(args[mn + 1], args[mn + 2], args[mn + 3]);
    return sheet();
  }
  if (!args.includes('--sheet')) await build();
  await sheet();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
