import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { loadCutouts } from '@/lib/real-case/bank';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import { jsonlLog } from '@/lib/reel-ai-drama/reporting/llm';
import type { ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Asset, FactSheet, Mode, Pitch, VisualKind, VisualsInventory } from '@/lib/reel-ai-drama/types';

import { coverageOf, lookCount, needsSketch, pickAnchor, PORTRAIT_KINDS, sketchReference, type CastCoverage } from './cast';
import { mainFace } from './faces';
import { downloadImage, mapLimit } from './fetch';
import {
  dedupeByHash,
  identityVerdict,
  lookVerdict,
  metadataVerdict,
  phash,
  preScreen,
  readImageMeta,
  recencyFlags,
  recencyScore,
  sizeFloor,
  upscaleFactor,
  type Look,
} from './filters';
import { lookAt } from './look';
import { anchorUpscale, normaliseImage, scaleBoxes } from './media';
import { mapSource } from './places';
import { castPeople, isNewsStory, MAIN_LOOKS, planWants, slug, SUPPORT_LOOKS, topUpWants } from './plan';
import { recentlyUsed } from './reuse';
import { articleSource, newsroomSource } from './sources/articles';
import { bankSource } from './sources/bank';
import { commonsSource } from './sources/commons';
import { documentSource, paperSource, screenSourceAdapter } from './sources/documents';
import { logoSource } from './sources/logos';
import { openverseSource } from './sources/openverse';
import { serperSource } from './sources/serper';
import { MAX_SKETCHES, SKETCH_USD_ESTIMATE, sketchPrompt } from './sketch';
import { videoSource } from './sources/video';
import { wikidataSource } from './sources/wikidata';
import type { FaceBox, HarvestDeps, RawCandidate, Source, SourceName, SourceRun, Want } from './types';

/**
 * P3 Media harvest (PROCESS.md; research 04 §7; MD-02, MD-14, MD-16, MD-31, MD-33, MD-41, MD-45, MD-46).
 * Plan wants from the pitch (and the fact sheet when it is ready) → gather from every adapter → screen
 * before download → download → file metadata → near-duplicates → the 20-day rule → Haiku looks →
 * identity and dates → size (upscale only when really needed) → number the usable ones V1…, save them
 * under `<jobDir>/media/`, write every candidate to `reel_ai_drama.assets`, and kill the story with fewer
 * than `settings.min_visuals` usable visuals or no image of the key moment.
 *
 * Cast coverage (MD-60, iteration 2): after the first pass, any person short of their looks gets a second,
 * narrower search pass through the same screens; the local detector boxes every face; each person gets one
 * anchor (their character image), upscaled when low-res; a main character with no confirmed solo photo, or
 * anyone with no photo at all, gets a line sketch traced from a reference photo (MD-14). Every saved
 * raster is re-encoded with its long edge ≤ 2160 px (media.ts).
 */

export const HARVEST_CAP_USD = 1;
export const MAX_DOWNLOADS = 220;
export const PER_SOURCE_CAP = 8;
const GATHER_CONCURRENCY = 4;
const DOWNLOAD_CONCURRENCY = 6;

export const ADAPTERS: Record<SourceName, Source> = {
  bank: bankSource,
  wikidata: wikidataSource,
  commons: commonsSource,
  openverse: openverseSource,
  serper: serperSource,
  article: articleSource,
  newsroom: newsroomSource,
  logo: logoSource,
  video: videoSource,
  screen: screenSourceAdapter,
  map: mapSource,
  paper: paperSource,
  document: documentSource,
  sketch: async () => [], // never gathered: made after the screens (sketch.ts)
};

export type HarvestInput = {
  pitch: Pitch;
  facts: FactSheet | null;
  jobDir: string;
  jobId: string | null;
  mode: Mode;
  settings: ReelAiDramaSettings;
};

export type RejectedCandidate = { ref: string; source: SourceName; want: string; url: string | null; source_page: string | null; caption: string; reason: string };

export type HarvestResult = { inventory: VisualsInventory; rejected: RejectedCandidate[]; notes: string[]; wants: Want[]; cast: CastCoverage[] };

type Cand = RawCandidate & {
  wants: string[];
  key_want: boolean;
  order: number;
  file: string | null;
  bytes: Buffer | null;
  phash: string | null;
  reject: string | null;
  look: Look | null;
  recency: number;
  upscaled: boolean;
  faces: FaceBox[] | null;
  face: { x: number; y: number; w: number; h: number } | null;
  anchor_for: string | null;
};

const urlKey = (u: string) => u.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').toLowerCase();

function dateConfidence(c: Pick<RawCandidate, 'date_taken' | 'date_basis'>): Asset['date_confidence'] {
  if (!c.date_taken) return 'unknown';
  const fullDay = /^\d{4}-\d{2}-\d{2}/.test(c.date_taken);
  return fullDay && ['event', 'exif', 'commons', 'capture'].includes(c.date_basis) ? 'exact' : 'approximate';
}

/** Which of two near-duplicates to keep: trusted, identity-tied, bigger, dated. */
function better(a: Cand, b: Cand): number {
  const score = (c: Cand) => (c.trusted ? 4 : 0) + (c.qids.length ? 2 : 0) + (c.date_taken ? 1 : 0) + Math.min(c.width ?? 0, c.height ?? 0) / 10_000;
  return score(a) - score(b) || b.order - a.order;
}

async function gather(wants: readonly Want[], run: SourceRun): Promise<RawCandidate[]> {
  const tasks = wants.flatMap((want) => want.sources.map((source) => ({ want, source })));
  const found = await mapLimit(tasks, GATHER_CONCURRENCY, async ({ want, source }) => {
    try {
      return (await ADAPTERS[source](want, run)).slice(0, PER_SOURCE_CAP);
    } catch (error) {
      run.notes.push(`${source} for ${want.id}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  });
  return found.flat();
}

export async function runHarvest(deps: HarvestDeps, input: HarvestInput): Promise<HarvestResult> {
  const now = deps.now?.() ?? new Date();
  const { pitch, facts, jobDir, jobId, mode, settings } = input;
  const log = deps.log ?? jsonlLog('harvest', jobId ?? 'nojob');
  const capUsd = deps.capUsd ?? HARVEST_CAP_USD;
  const mediaDir = path.join(jobDir, 'media');
  const tmpDir = path.join(mediaDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const isNews = isNewsStory(pitch.event_date, now, settings.news_window_days);
  const cutouts = deps.cutouts ?? loadCutouts(deps.root ?? process.cwd());
  const wants = planWants(pitch, facts, { isNews, cutouts });
  const wantById = new Map(wants.map((w) => [w.id, w]));
  const cast = castPeople(pitch, facts).sort((a, b) => Number(b.main) - Number(a.main));
  let tmpN = 0;
  const run: SourceRun = {
    deps: { ...deps, cutouts },
    notes: [],
    now,
    tmpDir,
    isNews,
    eventDate: pitch.event_date,
    cast: [...new Set([...pitch.cast, ...(facts?.cast ?? [])].filter((m) => m.kind === 'person').map((m) => m.name))],
    spend: { serperQueries: 0, serperUsd: 0, lookUsd: 0 },
    nextName: (ext) => path.join(tmpDir, `c${String(++tmpN).padStart(3, '0')}.${ext}`),
  };
  log({ event: 'plan', isNews, wants: wants.map((w) => ({ id: w.id, kind: w.kind, sources: w.sources, key: w.key_moment })) });

  const cands: Cand[] = [];
  const byUrl = new Map<string, Cand>();
  const live = () => cands.filter((c) => !c.reject);
  let downloads = 0;

  /** New candidates from raw finds; copies of the same image found for several wants are merged. */
  const intake = (raw: readonly RawCandidate[]): Cand[] => {
    const fresh: Cand[] = [];
    for (const r of raw) {
      const key_want = wantById.get(r.want)?.key_moment ?? false;
      const known = r.url ? byUrl.get(urlKey(r.url)) : undefined;
      if (known) {
        if (!known.wants.includes(r.want)) known.wants.push(r.want);
        known.key_want ||= key_want;
        known.people = [...new Set([...known.people, ...r.people])];
        continue;
      }
      const c: Cand = { ...r, wants: [r.want], key_want, order: cands.length, file: null, bytes: null, phash: null, reject: null, look: null, recency: 0.4, upscaled: false, faces: null, face: null, anchor_for: null };
      cands.push(c);
      fresh.push(c);
      if (r.url) byUrl.set(urlKey(r.url), c);
    }
    return fresh;
  };

  /** Every screen, cheapest first, over one batch (the first pass, then the cast top-up). */
  const screen = async (batch: readonly Cand[]) => {
    // Layers 1–2 and AI words in captions, before paying for any download.
    for (const c of batch) c.reject = preScreen(c);

    // Download or read, then the file's own metadata (layer 3, C2PA/IPTC AI markers, EXIF dates, embedded caption).
    await mapLimit(batch, DOWNLOAD_CONCURRENCY, async (c) => {
      if (c.reject) return;
      try {
        if (c.localFile) {
          c.bytes = fs.readFileSync(c.localFile);
          c.file = c.localFile;
        } else if (c.url) {
          if (downloads >= MAX_DOWNLOADS) {
            c.reject = `not_downloaded:cap_${MAX_DOWNLOADS}`;
            return;
          }
          downloads += 1;
          const got = await downloadImage(deps.http, c.url, path.join(tmpDir, `d${String(c.order).padStart(3, '0')}`), { sleep: deps.sleep });
          c.file = got.file;
          c.bytes = got.bytes;
        } else {
          c.reject = 'no_image';
          return;
        }
        const meta = await readImageMeta(c.bytes);
        c.width = meta.width;
        c.height = meta.height;
        if (!c.made && !c.trusted) {
          const verdict = metadataVerdict(meta);
          c.flags.push(...verdict.flags);
          if (verdict.reject) c.reject = verdict.reject;
          if (meta.taken && (c.date_basis === 'unknown' || c.date_basis === 'article')) {
            c.date_taken = meta.taken;
            c.date_basis = 'exif';
          }
          if (meta.credit && !c.credit.includes(meta.credit)) c.flags.push(`iptc_credit:${meta.credit.slice(0, 60)}`);
          if (meta.caption) c.embedded_caption = meta.caption;
        }
        c.phash = await phash(c.file);
      } catch (error) {
        c.reject = `unreadable:${error instanceof Error ? error.message.slice(0, 80) : String(error)}`;
      }
    });

    // Near-duplicates: keep the best copy of each picture (across both passes).
    const { dropped } = dedupeByHash(live(), better);
    for (const { item, of } of dropped) {
      item.reject = `duplicate_of:${of.source}:${of.url ?? of.localFile ?? ''}`.slice(0, 200);
      for (const w of item.wants) if (!of.wants.includes(w)) of.wants.push(w);
      of.key_want ||= item.key_want;
    }
    const mine = () => batch.filter((c) => !c.reject);

    // The 20-day rule. Character images and logos are exempt from the reuse window (MD-41, MD-45); everything else rests 20 days.
    const exempt = (c: RawCandidate) => c.character_image || c.kind === 'logo' || c.flags.includes('logo');
    const reuseKeys = mine().filter((c) => !exempt(c) && c.phash).map((c) => c.phash!);
    const used = await recentlyUsed(deps.db, reuseKeys, settings.reuse_days, now);
    for (const c of mine()) if (!exempt(c) && c.phash && used.has(c.phash)) c.reject = `used_within_${settings.reuse_days}_days`;

    // The look: every found (not made, not banked) image.
    const toLook = mine().filter((c) => !c.made && !c.trusted);
    if (toLook.length && deps.create) {
      const budget = Math.max(0, capUsd - run.spend.serperUsd - run.spend.lookUsd);
      const result = await lookAt(
        { db: deps.db, create: deps.create, loadPrompt: deps.loadPrompt, model: settings.vision_model, log },
        toLook.map((c) => ({ file: c.file!, claim: wantById.get(c.wants[0])?.what ?? c.kind, caption: c.caption, source: c.source })),
        { title: pitch.title, keyMoment: pitch.scene, cast: pitch.cast.map((m) => m.name), jobId, mode, capUsd: budget },
      );
      run.spend.lookUsd += result.usd;
      run.notes.push(...result.errors);
      toLook.forEach((c, i) => (c.look = result.looks.get(i) ?? null));
    } else if (toLook.length) {
      const note = 'looks: skipped (no model client); found images cannot be checked for watermarks';
      if (!run.notes.includes(note)) run.notes.push(note);
    }

    for (const c of mine()) {
      if (!c.made && !c.trusted && !c.look) {
        c.reject = 'not_checked:no_look';
        continue;
      }
      if (c.look) {
        const verdict = lookVerdict(c, c.look);
        if (verdict) {
          c.reject = verdict;
          continue;
        }
        if (c.look.text_heavy) c.flags.push('text_heavy');
      }
      // A picture that also serves a non-person want is judged as that: an unnamed person is dropped, not fatal.
      const other = c.kind === 'person_photo' ? c.wants.map((w) => wantById.get(w)).find((w) => w && w.kind !== 'person_photo') : undefined;
      const id = identityVerdict(other ? { ...c, kind: other.kind } : c, c.look);
      if (other && !id.people.length) c.kind = other.kind;
      if (id.reject) {
        c.reject = id.reject;
        continue;
      }
      c.people = id.people;
      c.flags.push(...id.flags);
      if (c.look && !c.look.about_story && !c.people.length && !c.qids.length) {
        c.reject = 'off_story';
        continue;
      }
      c.recency = recencyScore(c.date_taken, now, isNews, pitch.event_date);
      c.flags.push(...recencyFlags(c, c.date_taken, now, isNews, pitch.event_date));
    }

    // Size: below the floor is rejected, unless the image is the only one for its job (MD-16).
    for (const c of mine()) {
      const floor = sizeFloor(c);
      const short = Math.min(c.width ?? 0, c.height ?? 0);
      if (short >= floor) continue;
      const others = live().filter((o) => o !== c && o.wants.some((w) => c.wants.includes(w)) && Math.min(o.width ?? 0, o.height ?? 0) >= sizeFloor(o));
      const needed = c.key_want || others.length === 0;
      const factor = upscaleFactor(short, floor);
      if (!needed || factor === null) {
        c.reject = `too_small:${short}px`;
        continue;
      }
      if (!deps.upscale) {
        c.reject = `too_small:${short}px`;
        run.notes.push(`upscale: needed for ${c.url ?? c.file} (${short}px) but no upscaler is installed`);
        continue;
      }
      const out = path.join(tmpDir, `up${String(c.order).padStart(3, '0')}.png`);
      try {
        await deps.upscale(c.file!, out, factor);
        const m = await sharp(out).metadata();
        c.file = out;
        c.width = m.width ?? Math.round((c.width ?? 0) * factor);
        c.height = m.height ?? Math.round((c.height ?? 0) * factor);
        c.upscaled = true;
        c.flags.push(`upscaled:${factor}x`);
      } catch (error) {
        c.reject = `too_small:${short}px`;
        run.notes.push(`upscale failed for ${c.url ?? c.file}: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
      }
    }
  };

  // Pass 1: every want, every adapter.
  await screen(intake(await gather(wants, run)));

  // Pass 2: people still short of their looks (or, for a main character, of a confirmed one) get a narrower search.
  const topUps = cast.flatMap((p) => topUpWants(p, lookCount(coverageOf(live(), p))));
  if (topUps.length) {
    for (const w of topUps) {
      wants.push(w);
      wantById.set(w.id, w);
    }
    log({ event: 'cast_topup', wants: topUps.map((w) => ({ id: w.id, terms: w.terms })) });
    await screen(intake(await gather(topUps, run)));
  }

  // Faces: the local detector boxes every usable picture that can show a person (no AI spend).
  const faceable = live().filter((c) => c.file && (PORTRAIT_KINDS.has(c.kind) || c.people.length));
  if (faceable.length && deps.detectFaces) {
    try {
      const found = await deps.detectFaces(faceable.map((c) => c.file!));
      for (const c of faceable) {
        c.faces = found.get(c.file!) ?? null;
        c.face = mainFace(c.faces);
        if (c.faces) c.flags.push(`faces:${c.faces.length}`);
      }
    } catch (error) {
      run.notes.push(`faces: detector failed (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); no face boxes`);
    }
  } else if (faceable.length) {
    run.notes.push('faces: no detector; no face boxes');
  }

  // Anchors: one per person, their character image (MD-41, MD-60). Low-res anchors are upscaled; it fails open.
  for (const p of cast) {
    const anchor = pickAnchor(live(), p.name);
    if (!anchor) continue;
    anchor.anchor_for = p.name;
    anchor.character_image = true;
    anchor.flags.push(`anchor:${p.name}`);
    const factor = anchorUpscale(anchor.width ?? 0, anchor.height ?? 0);
    if (!factor || anchor.upscaled) continue;
    if (!deps.upscale) {
      anchor.flags.push('low_res_anchor');
      run.notes.push(`anchor for ${p.name} is ${Math.min(anchor.width ?? 0, anchor.height ?? 0)}px on its short edge; no upscaler is installed`);
      continue;
    }
    const out = path.join(tmpDir, `anchor-${slug(p.name)}.png`);
    try {
      await deps.upscale(anchor.file!, out, factor);
      const m = await sharp(out).metadata();
      anchor.file = out;
      anchor.width = m.width ?? (anchor.width ?? 0) * factor;
      anchor.height = m.height ?? (anchor.height ?? 0) * factor;
      anchor.upscaled = true;
      anchor.flags.push(`upscaled:anchor:${factor}x`);
    } catch (error) {
      anchor.flags.push(`upscale_failed:${error instanceof Error ? error.message.slice(0, 80) : String(error)}`);
      run.notes.push(`anchor upscale failed for ${p.name}; kept the original`);
    }
  }

  // Sketches (MD-14): a main character with no confirmed solo photo, or anyone with none at all.
  let sketchUsd = 0;
  let sketches = 0;
  const coverage: CastCoverage[] = [];
  for (const p of cast) {
    const cov = coverageOf(live(), p);
    const anchor = live().find((c) => c.anchor_for === p.name);
    let sketched = false;
    if (needsSketch(cov, Boolean(anchor))) {
      const ref = sketchReference(cands, p.name);
      const spent = run.spend.serperUsd + run.spend.lookUsd + sketchUsd;
      if (!ref) run.notes.push(`cast: no photo of ${p.name} anywhere, not even one to trace a sketch from`);
      else if (!deps.sketch) run.notes.push(`cast: ${p.name} needs a sketch but no sketch generator is set`);
      else if (sketches >= MAX_SKETCHES) run.notes.push(`cast: ${p.name} needs a sketch; sketch cap ${MAX_SKETCHES} reached`);
      else if (spent + SKETCH_USD_ESTIMATE > capUsd) run.notes.push(`cast: ${p.name} needs a sketch; harvest cap $${capUsd.toFixed(2)} reached`);
      else {
        try {
          sketches += 1;
          const made = await deps.sketch({ prompt: sketchPrompt(), reference: ref.file! });
          sketchUsd += made.usd;
          await recordCost(deps.db, { jobId, mode, vendor: 'openai', component: 'harvest_sketch', usd: made.usd });
          const file = path.join(tmpDir, `sketch-${slug(p.name)}.png`);
          fs.writeFileSync(file, made.png);
          const m = await sharp(file).metadata();
          const [c] = intake([
            {
              source: 'sketch',
              want: `person:${slug(p.name)}`,
              kind: 'person_photo',
              url: null,
              localFile: file,
              source_page: ref.source_page ?? ref.url,
              credit: `Line sketch by Helios, traced from: ${ref.credit}`,
              license: null,
              caption: `Line sketch of ${p.name}`,
              people: [p.name],
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
              shows: `A black line sketch of ${p.name}, head and shoulders on white, traced from a reference photo (a drawing, not a photograph).`,
              flags: ['sketch', `traced_from:${(ref.url ?? ref.source_page ?? ref.source).slice(0, 160)}`],
            },
          ]);
          c.file = file;
          c.bytes = made.png;
          c.phash = await phash(file);
          if (!anchor) {
            c.anchor_for = p.name;
            c.flags.push(`anchor:${p.name}`);
          }
          sketched = true;
        } catch (error) {
          run.notes.push(`cast: sketch of ${p.name} failed (${error instanceof Error ? error.message.slice(0, 120) : String(error)})`);
        }
      }
    }
    coverage.push({ ...coverageOf(live(), p), anchor: null, sketch: sketched });
  }

  // Number and save, normalised (long edge ≤ 2160 px). Wants come first in plan order (cast, key moment, expected visuals, pages…).
  const wantRank = new Map(wants.map((w, i) => [w.id, i]));
  const usable = live().sort((a, b) => (wantRank.get(a.wants[0]) ?? 999) - (wantRank.get(b.wants[0]) ?? 999) || Number(b.character_image) - Number(a.character_image) || b.recency - a.recency || a.order - b.order);
  const assets: Asset[] = [];
  fs.mkdirSync(mediaDir, { recursive: true });
  for (const [i, c] of usable.entries()) {
    const id = `V${i + 1}`;
    const saved = await normaliseImage(c.file!, path.join(mediaDir, id), c.kind);
    const rel = `media/${path.basename(saved.file)}`;
    c.width = saved.width;
    c.height = saved.height;
    const flags = [...new Set([...c.flags, `source:${c.source}`, `date_basis:${c.date_basis}`, `recency:${c.recency}`, ...c.wants.map((w) => `want:${w}`)])];
    if (saved.scale < 1) flags.push(`resized:${Math.round(saved.scale * 1000) / 1000}`);
    const key = c.look?.key_moment === true || (c.made && c.key_want);
    if (key) flags.push('key_moment');
    if (c.text_boxes) {
      const boxes = `media/${id}.boxes.json`;
      fs.writeFileSync(path.join(jobDir, boxes), JSON.stringify({ image: rel, width: c.width, height: c.height, boxes: scaleBoxes(c.text_boxes, saved.scale) }, null, 2));
      flags.push(`boxes:${boxes}`);
    }
    if (c.anchor_for) {
      const cov = coverage.find((x) => x.name === c.anchor_for);
      if (cov) cov.anchor = id;
    }
    assets.push({
      id,
      kind: c.kind,
      file: rel,
      url: c.url,
      source_page: c.source_page,
      credit: c.credit,
      license: c.license,
      shows: (c.look?.shows || c.shows || c.caption || `${c.kind.replace('_', ' ')} from ${c.source}`).trim(),
      people: c.people,
      qids: c.qids,
      place: c.place,
      date_taken: c.date_taken,
      date_confidence: dateConfidence(c),
      width: c.width ?? 0,
      height: c.height ?? 0,
      phash: c.phash,
      character_image: c.character_image,
      made: c.made,
      upscaled: c.upscaled,
      flags,
      anchor_for: c.anchor_for,
      face: c.face,
      made_kind: c.made_kind ?? null,
    });
  }

  for (const cov of coverage) {
    const target = cov.main ? MAIN_LOOKS : SUPPORT_LOOKS;
    run.notes.push(`cast: ${cov.name}${cov.main ? ' (main)' : ''}: ${cov.portraits} look(s), ${cov.verified} confirmed, anchor ${cov.anchor ?? 'none'}${cov.sketch ? ' (sketch)' : ''}${cov.portraits < target ? ` (target ${target})` : ''}`);
  }

  // Rejected: files kept under media/rejected/ for review; every candidate gets a row.
  const rejected: RejectedCandidate[] = [];
  const rejects = cands.filter((x) => x.reject);
  for (const [i, c] of rejects.entries()) {
    const ref = `R${i + 1}`;
    if (c.file && (!c.localFile || c.made) && fs.existsSync(c.file)) {
      fs.mkdirSync(path.join(mediaDir, 'rejected'), { recursive: true });
      fs.renameSync(c.file, path.join(mediaDir, 'rejected', `${ref}${path.extname(c.file)}`));
    }
    rejected.push({ ref, source: c.source, want: c.wants.join(','), url: c.url, source_page: c.source_page, caption: c.caption.slice(0, 200), reason: c.reject! });
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const assetKey = (a: { phash: string | null; url: string | null; file?: string | null }, bytes?: Buffer | null) =>
    a.phash ?? a.url ?? `sha256:${crypto.createHash('sha256').update(bytes ?? a.file ?? '').digest('hex')}`;
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
  return { inventory, rejected, notes: run.notes, wants, cast: coverage };
}

/** CONTRACT § B2. `inventory.kill` set means kill (`too_few_visuals` or `no_key_moment_image`). */
export async function harvestVisuals(deps: HarvestDeps, input: HarvestInput): Promise<VisualsInventory> {
  return (await runHarvest(deps, input)).inventory;
}

