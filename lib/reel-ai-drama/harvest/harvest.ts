import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { loadCutouts } from '@/lib/real-case/bank';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import { jsonlLog } from '@/lib/reel-ai-drama/reporting/llm';
import type { ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Asset, FactSheet, Mode, Pitch, VisualKind, VisualsInventory } from '@/lib/reel-ai-drama/types';

import { trustedCutouts } from './bank-verdicts';
import { writeSidecars } from './boxes';
import { coverageOf, cutoutSource, isCutout, needsSketch, pickAnchor, sketchReference, type CastCoverage } from './cast';
import { mainFace } from './faces';
import { phash } from './filters';
import { anchorUpscale, checkedUpscale, isGarbledUpscale } from './media';
import { offerToBank } from './photo-bank';
import { gather, makePipeline, saveAsset, type Cand } from './pipeline';
import { castPeople, isNewsStory, lookTarget, planWants, slug, topUpWants, type CastPerson } from './plan';
import { MAX_SKETCHES, SKETCH_USD_ESTIMATE, sketchPrompt } from './sketch';
import { removePaper } from './transparent';
import type { HarvestDeps, Want } from './types';

/**
 * P3 Media harvest (PROCESS.md; research 04 §7; MD-02, MD-14, MD-16, MD-31, MD-33, MD-41, MD-45, MD-46).
 * Plan wants from the pitch (and the fact sheet when it is ready) → gather from every adapter → screen
 * (pipeline.ts: pre-screen, download, file metadata, near-duplicates, the 20-day rule, Haiku looks, identity
 * and dates, size) → number the usable ones V1…, save them under `<jobDir>/media/`, write every candidate
 * to `reel_ai_drama.assets`, and kill the story with fewer than `settings.min_visuals` usable visuals.
 *
 * Cast coverage (MD-60, MD-68, MD-75; iteration 3): every named person (pitch and fact-sheet cast) is
 * searched until they have NAMED_LOOKS verified portraits (at least one), central people until they have
 * CENTRAL_LOOKS verified, distinct ones (a second, wider round for them). The local detector boxes every
 * face; each person gets one anchor (their character image), upscaled when low-res and checked for a
 * garbled result; every central person gets a transparent cutout of their best portrait (rembg), which
 * becomes their anchor; a main or central character with no confirmed solo photo, or anyone with no photo
 * at all, gets a line sketch traced from a reference photo (MD-14). Every saved raster is re-encoded with
 * its long edge ≤ 2160 px (media.ts).
 */

export const HARVEST_CAP_USD = 1;
/** How long the harvest waits for its photo-bank offers to be written (the bank's ingest goes on in the background). */
export const BANK_FLUSH_MS = 5_000;
export { ADAPTERS, MAX_DOWNLOADS, PER_SOURCE_CAP } from './pipeline';

export type HarvestInput = {
  pitch: Pitch;
  /**
   * The fact sheet, or the reporting still under way: given a promise, the first pass runs on the pitch and
   * the cast passes wait for the facts, so fact-sheet people get their portraits too (a rejection = no facts).
   */
  facts: FactSheet | null | PromiseLike<FactSheet | null>;
  jobDir: string;
  jobId: string | null;
  mode: Mode;
  settings: ReelAiDramaSettings;
};

export type RejectedCandidate = { ref: string; source: Cand['source']; want: string; url: string | null; source_page: string | null; caption: string; reason: string };

export type HarvestResult = { inventory: VisualsInventory; rejected: RejectedCandidate[]; notes: string[]; wants: Want[]; cast: CastCoverage[] };

const isPromiseLike = <T>(x: unknown): x is PromiseLike<T> => !!x && typeof (x as PromiseLike<T>).then === 'function';

const personNames = (pitch: Pitch, facts: FactSheet | null) => [...new Set([...pitch.cast, ...(facts?.cast ?? [])].filter((m) => m.kind === 'person').map((m) => m.name))];

export async function runHarvest(deps: HarvestDeps, input: HarvestInput): Promise<HarvestResult> {
  const now = deps.now?.() ?? new Date();
  const { pitch, jobDir, jobId, mode, settings } = input;
  const log = deps.log ?? jsonlLog('harvest', jobId ?? 'nojob');
  const capUsd = deps.capUsd ?? HARVEST_CAP_USD;
  const mediaDir = path.join(jobDir, 'media');
  const tmpDir = path.join(mediaDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const isNews = isNewsStory(pitch.event_date, now, settings.news_window_days);
  // MD-81: a banked cutout the identity check found to be someone else is never used.
  const cutouts = trustedCutouts(deps.cutouts ?? loadCutouts(deps.root ?? process.cwd()), deps.root ?? process.cwd());
  const pending = isPromiseLike<FactSheet | null>(input.facts) ? input.facts : null;
  let facts: FactSheet | null = pending ? null : (input.facts as FactSheet | null);
  const wants = planWants(pitch, facts, { isNews, cutouts });
  let sketchUsd = 0;
  const p = makePipeline({
    deps: { ...deps, cutouts },
    pitch,
    settings,
    jobId,
    mode,
    now,
    isNews,
    tmpDir,
    capUsd,
    log,
    wants,
    cast: personNames(pitch, facts),
    spentElsewhere: () => sketchUsd,
  });
  const { run } = p;
  log({ event: 'plan', isNews, wants: wants.map((w) => ({ id: w.id, kind: w.kind, sources: w.sources, key: w.key_moment })) });

  // Pass 1: every want, every adapter.
  await p.screen(p.intake(await gather(wants, run)));

  // The fact sheet, when reporting ran beside us: its people are named in the reel, so they need pictures too (MD-75).
  if (pending) {
    try {
      facts = await pending;
    } catch (error) {
      run.notes.push(`cast: no fact sheet for the cast passes (${error instanceof Error ? error.message.slice(0, 120) : String(error)})`);
    }
    if (facts) {
      for (const n of personNames(pitch, facts)) if (!run.cast.includes(n)) run.cast.push(n);
      const known = new Set(wants.map((w) => w.id));
      const people = planWants(pitch, facts, { isNews, cutouts }).filter((w) => w.kind === 'person_photo' && w.id.startsWith('person:') && !known.has(w.id));
      if (people.length) {
        log({ event: 'fact_cast', wants: people.map((w) => w.id) });
        await p.pass(people);
      }
    }
  }

  // Cast passes: everyone short of verified looks gets narrower searches; central people still short get a second, wider round.
  const cast = castPeople(pitch, facts).sort((a, b) => Number(b.central) - Number(a.central) || Number(b.main) - Number(a.main));
  const year = pitch.event_date?.slice(0, 4) ?? '';
  for (const round of [1, 2] as const) {
    const short = cast.filter((person) => (round === 1 || person.central) && coverageOf(p.live(), person).verified < lookTarget(person));
    const more = short.flatMap((person) => topUpWants(person, coverageOf(p.live(), person), { round, year }));
    if (!more.length) continue;
    log({ event: 'cast_topup', round, wants: more.map((w) => ({ id: w.id, terms: w.terms })) });
    await p.pass(more);
  }

  // Faces: the local detector boxes every usable picture that can show a person (no AI spend).
  await p.boxFaces(p.live());

  // Anchors: one per person, their character image (MD-41, MD-60). Low-res anchors are upscaled and checked; it fails open.
  for (const person of cast) {
    const anchor = pickAnchor(p.live(), person.name);
    if (!anchor) continue;
    anchor.anchor_for = person.name;
    anchor.character_image = true;
    anchor.flags.push(`anchor:${person.name}`);
    await upscaleAnchor(anchor, person);
  }

  async function upscaleAnchor(anchor: Cand, person: CastPerson) {
    const factor = anchorUpscale(anchor.width ?? 0, anchor.height ?? 0);
    if (!factor || anchor.upscaled) return;
    if (!deps.upscale) {
      anchor.flags.push('low_res_anchor');
      run.notes.push(`anchor for ${person.name} is ${Math.min(anchor.width ?? 0, anchor.height ?? 0)}px on its short edge; no upscaler is installed`);
      return;
    }
    const out = path.join(tmpDir, `anchor-${slug(person.name)}.png`);
    try {
      const up = await checkedUpscale(deps.upscale, anchor.file!, out, factor);
      anchor.file = out;
      anchor.width = up.width;
      anchor.height = up.height;
      anchor.upscaled = true;
      anchor.flags.push(`upscaled:anchor:${factor}x`);
    } catch (error) {
      if (isGarbledUpscale(error)) {
        anchor.flags.push('upscale_garbled', 'low_res_anchor');
        run.notes.push(`anchor upscale for ${person.name} came out garbled (${error.message}); kept the original`);
        return;
      }
      anchor.flags.push(`upscale_failed:${error instanceof Error ? error.message.slice(0, 80) : String(error)}`);
      run.notes.push(`anchor upscale failed for ${person.name}; kept the original`);
    }
  }

  // Cutouts: every central person gets a transparent cutout of their best portrait, which becomes their anchor,
  // so cutout treatments never fall back to a boxed photo. A banked cutout already is one.
  const cutFrom = new Map<Cand, Cand>();
  for (const person of cast.filter((x) => x.central)) {
    const anchor = p.live().find((c) => c.anchor_for === person.name);
    if (anchor && isCutout(anchor)) continue;
    const src = cutoutSource(p.live(), person.name);
    if (!src) {
      run.notes.push(`cutout: ${person.name} is central but has no confirmed solo photo to cut out`);
      continue;
    }
    if (!deps.cutout) {
      run.notes.push(`cutout: ${person.name} needs one but no background remover is set`);
      continue;
    }
    if (!src.anchor_for) await upscaleAnchor(src, person);
    const out = path.join(tmpDir, `cutout-${slug(person.name)}.png`);
    try {
      const res = await deps.cutout(src.file!, out);
      if (!res.ok) {
        run.notes.push(`cutout of ${person.name} failed: ${res.error.slice(0, 160)}`);
        continue;
      }
      const [c] = p.intake([
        {
          source: src.source,
          want: src.wants[0],
          kind: 'person_photo',
          url: null,
          localFile: out,
          source_page: src.source_page ?? src.url,
          credit: src.credit,
          license: src.license,
          caption: `Cutout of ${person.name}`,
          people: [person.name],
          qids: src.qids,
          place: src.place,
          date_taken: src.date_taken,
          date_basis: src.date_basis,
          width: res.width,
          height: res.height,
          character_image: true,
          made: false,
          trusted: true,
          shows: `${person.name}, cut out of a photo onto a transparent background (their character image).`,
          flags: ['cutout', 'cutout_made', 'identity:verified'],
        },
      ]);
      c.wants = [...src.wants];
      c.file = out;
      c.bytes = fs.readFileSync(out);
      c.phash = await phash(out);
      c.recency = src.recency;
      c.upscaled = src.upscaled;
      if (deps.detectFaces) {
        try {
          c.faces = (await deps.detectFaces([out])).get(out) ?? null;
          c.face = mainFace(c.faces);
        } catch {
          // no face box for the cutout; the kit centres it
        }
      }
      if (src.anchor_for === person.name) {
        src.anchor_for = null;
        src.character_image = false;
        src.flags = src.flags.filter((f) => f !== `anchor:${person.name}`);
      }
      c.anchor_for = person.name;
      c.flags.push(`anchor:${person.name}`);
      cutFrom.set(c, src);
    } catch (error) {
      run.notes.push(`cutout of ${person.name} failed: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
    }
  }

  // Sketches (MD-14): a main or central character with no confirmed solo photo, or anyone with none at all.
  let sketches = 0;
  const coverage: CastCoverage[] = [];
  for (const person of cast) {
    const cov = coverageOf(p.live(), person);
    const anchor = p.live().find((c) => c.anchor_for === person.name);
    let sketched = false;
    if (needsSketch(cov, Boolean(anchor))) {
      const ref = sketchReference(p.cands, person.name);
      const spent = run.spend.serperUsd + run.spend.lookUsd + sketchUsd;
      if (!ref) run.notes.push(`cast: no photo of ${person.name} anywhere, not even one to trace a sketch from`);
      else if (!deps.sketch) run.notes.push(`cast: ${person.name} needs a sketch but no sketch generator is set`);
      else if (sketches >= MAX_SKETCHES) run.notes.push(`cast: ${person.name} needs a sketch; sketch cap ${MAX_SKETCHES} reached`);
      else if (spent + SKETCH_USD_ESTIMATE > capUsd) run.notes.push(`cast: ${person.name} needs a sketch; harvest cap $${capUsd.toFixed(2)} reached`);
      else {
        try {
          sketches += 1;
          const made = await deps.sketch({ prompt: sketchPrompt(), reference: ref.file! });
          sketchUsd += made.usd;
          await recordCost(deps.db, { jobId, mode, vendor: 'openai', component: 'harvest_sketch', usd: made.usd });
          const file = path.join(tmpDir, `sketch-${slug(person.name)}.png`);
          // Iteration 4: the sketch's white paper is removed (lines on transparent), so it never shows as a white square.
          const clear = await removePaper(made.png, 'ink').catch(() => null);
          const png = clear?.png ?? made.png;
          fs.writeFileSync(file, png);
          const m = await sharp(file).metadata();
          const [c] = p.intake([
            {
              source: 'sketch',
              want: `person:${slug(person.name)}`,
              kind: 'person_photo',
              url: null,
              localFile: file,
              source_page: ref.source_page ?? ref.url,
              credit: `Line sketch by Helios, traced from: ${ref.credit}`,
              license: null,
              caption: `Line sketch of ${person.name}`,
              people: [person.name],
              qids: ref.qids,
              place: null,
              date_taken: null,
              date_basis: 'unknown',
              width: m.width,
              height: m.height,
              character_image: !anchor,
              made: true,
              made_kind: 'sketch',
              trusted: true,
              shows: `A black line sketch of ${person.name}, head and shoulders ${clear ? 'on a transparent background' : 'on white'}, traced from a reference photo (a drawing, not a photograph).`,
              flags: ['sketch', ...(clear ? ['transparent'] : []), `traced_from:${(ref.url ?? ref.source_page ?? ref.source).slice(0, 160)}`],
            },
          ]);
          c.file = file;
          c.bytes = png;
          c.phash = await phash(file);
          if (!anchor) {
            c.anchor_for = person.name;
            c.flags.push(`anchor:${person.name}`);
          }
          sketched = true;
        } catch (error) {
          run.notes.push(`cast: sketch of ${person.name} failed (${error instanceof Error ? error.message.slice(0, 120) : String(error)})`);
        }
      }
    }
    coverage.push({ ...coverageOf(p.live(), person), target: lookTarget(person), anchor: null, sketch: sketched, cutout: null });
  }

  // Number and save, normalised (long edge ≤ 2160 px). Wants come first in plan order (cast, key moment, expected visuals, pages…).
  const wantRank = new Map(wants.map((w, i) => [w.id, i]));
  const usable = p.live().sort((a, b) => (wantRank.get(a.wants[0]) ?? 999) - (wantRank.get(b.wants[0]) ?? 999) || Number(b.character_image) - Number(a.character_image) || b.recency - a.recency || a.order - b.order);
  const idOf = new Map(usable.map((c, i) => [c, `V${i + 1}`]));
  const assets: Asset[] = [];
  for (const c of usable) {
    const id = idOf.get(c)!;
    const src = cutFrom.get(c);
    const asset = await saveAsset(c, id, jobDir, src && idOf.has(src) ? [`cutout_of:${idOf.get(src)}`] : []);
    for (const cov of coverage) {
      if (c.anchor_for === cov.name) cov.anchor = id;
      if (isCutout(c) && c.people.length === 1 && c.people[0] === cov.name && !cov.cutout) cov.cutout = id;
    }
    assets.push(asset);
  }

  // Box sidecars (iteration 4): faces, words, picture regions and a lift for every saved image, before the rows are written.
  run.notes.push(
    ...(await writeSidecars(
      jobDir,
      usable.map((c, i) => ({ asset: assets[i], faces: c.faces, textHeavy: c.look?.text_heavy === true })),
      { readWords: deps.readWords ?? null, detectFaces: deps.detectFaces ?? null, cutout: deps.cutout ?? null },
    )),
  );

  for (const cov of coverage) {
    const label = cov.central ? ' (central)' : cov.main ? ' (main)' : '';
    run.notes.push(
      `cast: ${cov.name}${label}: ${cov.portraits} look(s), ${cov.verified} confirmed, anchor ${cov.anchor ?? 'none'}${cov.sketch ? ' (sketch)' : ''}${cov.central ? `, cutout ${cov.cutout ?? 'none'}` : ''}${cov.verified < cov.target ? ` (target ${cov.target} confirmed)` : ''}`,
    );
  }

  // Rejected: files kept under media/rejected/ for review; every candidate gets a row.
  const rejected: RejectedCandidate[] = [];
  const rejects = p.cands.filter((x) => x.reject);
  for (const [i, c] of rejects.entries()) {
    const ref = `R${i + 1}`;
    if (c.file && (!c.localFile || c.made) && fs.existsSync(c.file)) {
      fs.mkdirSync(path.join(mediaDir, 'rejected'), { recursive: true });
      fs.renameSync(c.file, path.join(mediaDir, 'rejected', `${ref}${path.extname(c.file)}`));
    }
    rejected.push({ ref, source: c.source, want: c.wants.join(','), url: c.url, source_page: c.source_page, caption: c.caption.slice(0, 200), reason: c.reject! });
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  for (const [i, a] of assets.entries()) {
    await deps.db.query(
      `INSERT INTO reel_ai_drama.assets (job_id, asset_key, ref, kind, status, data) VALUES ($1, $2, $3, $4, 'usable', $5::jsonb)`,
      [jobId, assetKey(a, usable[i].bytes), a.id, a.kind, JSON.stringify(a)],
    );
  }
  for (const [i, r] of rejected.entries()) {
    const c = rejects[i];
    await deps.db.query(
      `INSERT INTO reel_ai_drama.assets (job_id, asset_key, ref, kind, status, reject_reason, data) VALUES ($1, $2, $3, $4, 'rejected', $5, $6::jsonb)`,
      [jobId, assetKey({ phash: c.phash, url: c.url, file: c.localFile ?? null }, c.bytes), r.ref, c.kind, r.reason, JSON.stringify({ ...r, credit: c.credit, flags: c.flags })],
    );
  }

  if (run.spend.serperQueries) {
    await recordCost(deps.db, { jobId, mode, vendor: 'serper', component: 'harvest_search', usd: run.spend.serperUsd });
  }

  // The hub's photo bank (2026-11-03): every kept photo from the web, with its identities, credit and look.
  // Every passing candidate is kept here, so there are no runners-up to offer (the wish search has some).
  offerToBank(deps.photoBank, { jobId, pitch, facts, wants, kept: usable.map((c, i) => ({ c, slide: i + 1, outcome: 'picked' as const })), at: now }, run.notes);
  await deps.photoBank?.flush?.(BANK_FLUSH_MS);

  const counts: Partial<Record<VisualKind, number>> = {};
  for (const a of assets) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  // Only too few visuals kills (MD-33: "The bar should be 15 usable visuals", and made visuals count).
  // A key moment nobody photographed is a warning: the director tells it with what exists (MD-56).
  const kill = assets.length < settings.min_visuals ? { reason: 'too_few_visuals' } : null;
  if (!assets.some((a) => a.flags.includes('key_moment'))) run.notes.push('no image of the key moment');
  const usd = Number((run.spend.serperUsd + run.spend.lookUsd + sketchUsd).toFixed(6));
  const inventory: VisualsInventory = { assets, usable_count: assets.length, counts, kill, usd };
  const summary = { usable: assets.length, rejected: rejected.length, kill, usd, cast: coverage, notes: run.notes };
  fs.writeFileSync(path.join(mediaDir, 'harvest.json'), JSON.stringify({ ...summary, rejected }, null, 2));
  log({ event: 'done', ...summary });
  return { inventory, rejected, notes: run.notes, wants: wants, cast: coverage };
}

/** The key a picture is recorded under for the 20-day rule (its pHash when known). */
export function assetKey(a: { phash: string | null; url: string | null; file?: string | null }, bytes?: Buffer | null): string {
  return a.phash ?? a.url ?? `sha256:${crypto.createHash('sha256').update(bytes ?? a.file ?? '').digest('hex')}`;
}

/** CONTRACT § B2. `inventory.kill` set means kill (`too_few_visuals` or `no_key_moment_image`). */
export async function harvestVisuals(deps: HarvestDeps, input: HarvestInput): Promise<VisualsInventory> {
  return (await runHarvest(deps, input)).inventory;
}
