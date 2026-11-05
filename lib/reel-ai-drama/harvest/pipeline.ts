import fs from 'node:fs';
import path from 'node:path';

import type { ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import { pitchBrief, type Asset, type Mode, type Pitch } from '@/lib/reel-ai-drama/types';

import { PORTRAIT_KINDS } from './cast';
import { mainFace } from './faces';
import { downloadImage, mapLimit } from './fetch';
import {
  dedupeByHash,
  hamming,
  identityVerdict,
  lookVerdict,
  metadataVerdict,
  NEAR_DUPLICATE,
  phash,
  preScreen,
  readImageMeta,
  recencyFlags,
  recencyScore,
  sizeFloor,
  upscaleFactor,
  type Look,
} from './filters';
import { expressionOf, lookAt } from './look';
import { checkedUpscale, isGarbledUpscale, normaliseImage, scaleBoxes } from './media';
import { measureAsset } from './regions';
import { recentlyUsed } from './reuse';
import { articleSource, newsroomSource } from './sources/articles';
import { bankSource } from './sources/bank';
import { commonsSource } from './sources/commons';
import { documentSource, paperSource, screenSourceAdapter } from './sources/documents';
import { logoSource } from './sources/logos';
import { openverseSource } from './sources/openverse';
import { bankable, photoBankSource } from './photo-bank';
import { serperSource } from './sources/serper';
import { videoSource } from './sources/video';
import { wikidataSource } from './sources/wikidata';
import { mapSource } from './places';
import type { FaceBox, HarvestDeps, RawCandidate, Source, SourceName, SourceRun, Want } from './types';

/**
 * The harvest's screens as one reusable pipeline (iteration 3): the first harvest and the targeted wish
 * search (MD-68) run the same gather → pre-screen → download → file metadata → near-duplicates → 20-day
 * rule → look → identity and dates → size steps, so a wish's picture passes exactly the checks the
 * harvest's pictures pass. harvest.ts and wishes.ts own what happens around it.
 */

export const MAX_DOWNLOADS = 300;
export const PER_SOURCE_CAP = 8;
const GATHER_CONCURRENCY = 4;
const DOWNLOAD_CONCURRENCY = 6;

export const ADAPTERS: Record<SourceName, Source> = {
  bank: bankSource,
  photo_bank: photoBankSource,
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

export type Cand = RawCandidate & {
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

/** A wish search's candidate (want ids `wish:<id>:<n>`) that the look says fits what was wished for. */
export const fitsWish = (c: Pick<Cand, 'wants' | 'look'>) => c.look?.fits === true && c.wants.some((w) => w.startsWith('wish:'));
/** Our own page captures: looked at only for a failed page (MD-141); their branding is their subject. */
export const isCapture = (c: Pick<RawCandidate, 'made' | 'source'>) => c.made && (c.source === 'screen' || c.source === 'document' || c.source === 'paper');
/** A company's or product's mark or picture is judged by whether it shows that thing, not by the story (MD-135). */
const fitsCastThing = (c: Pick<Cand, 'kind' | 'look'>) => c.look?.fits === true && (c.kind === 'logo' || c.kind === 'product');

export const urlKey = (u: string) => u.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').toLowerCase();

export function dateConfidence(c: Pick<RawCandidate, 'date_taken' | 'date_basis'>): Asset['date_confidence'] {
  if (!c.date_taken) return 'unknown';
  const fullDay = /^\d{4}-\d{2}-\d{2}/.test(c.date_taken);
  return fullDay && ['event', 'exif', 'commons', 'capture'].includes(c.date_basis) ? 'exact' : 'approximate';
}

/** Which of two near-duplicates to keep: trusted, identity-tied, bigger, dated. */
function better(a: Cand, b: Cand): number {
  const score = (c: Cand) => (c.trusted ? 4 : 0) + (c.qids.length ? 2 : 0) + (c.date_taken ? 1 : 0) + Math.min(c.width ?? 0, c.height ?? 0) / 10_000;
  return score(a) - score(b) || b.order - a.order;
}

export async function gather(wants: readonly Want[], run: SourceRun, perSource = PER_SOURCE_CAP): Promise<RawCandidate[]> {
  // The hub's photo bank is asked first for every photo want (2026-11-03); its finds lead, so a copy of the
  // same picture found online merges into the bank's candidate.
  const bank = (want: Want): SourceName[] => (run.deps.photoBank && bankable(want) && !want.sources.includes('photo_bank') ? ['photo_bank'] : []);
  const tasks = wants.flatMap((want) => [...bank(want), ...want.sources].map((source) => ({ want, source })));
  const found = await mapLimit(tasks, GATHER_CONCURRENCY, async ({ want, source }) => {
    try {
      return (await ADAPTERS[source](want, run)).slice(0, perSource);
    } catch (error) {
      run.notes.push(`${source} for ${want.id}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  });
  return found.flat();
}

export type PipelineCtx = {
  deps: HarvestDeps;
  pitch: Pitch;
  settings: ReelAiDramaSettings;
  jobId: string | null;
  mode: Mode;
  now: Date;
  isNews: boolean;
  /** Absolute; made and downloaded files land here. */
  tmpDir: string;
  /** Looks and searches stop past this. */
  capUsd: number;
  log: (entry: Record<string, unknown>) => void;
  wants: Want[];
  /** Every named person, to read captions for who an image names. */
  cast: string[];
  /** Who each cast member is in this story (the look uses it to tell a namesake); the pitch's roles by default. */
  roles?: Readonly<Record<string, string>>;
  /** Pictures already in the inventory (the wish search): a near-duplicate of one is rejected. */
  known?: readonly { id: string; phash: string }[];
  /** Extra spend already counted against `capUsd` (sketches). */
  spentElsewhere?: () => number;
};

export type Pipeline = {
  run: SourceRun;
  cands: Cand[];
  wantById: Map<string, Want>;
  live: () => Cand[];
  addWants: (more: readonly Want[]) => void;
  intake: (raw: readonly RawCandidate[]) => Cand[];
  screen: (batch: readonly Cand[]) => Promise<void>;
  /** Gather for `wants`, then screen what is new. */
  pass: (wants: readonly Want[], perSource?: number) => Promise<Cand[]>;
  boxFaces: (cands: readonly Cand[]) => Promise<void>;
};

export function makePipeline(ctx: PipelineCtx): Pipeline {
  const { deps, pitch, settings, jobId, mode, now, isNews, tmpDir, capUsd, log } = ctx;
  const wants = ctx.wants;
  const roles: Record<string, string> = { ...Object.fromEntries(pitch.cast.filter((m) => m.kind === 'person' && m.role).map((m) => [m.name, m.role])), ...(ctx.roles ?? {}) };
  const wantById = new Map(wants.map((w) => [w.id, w]));
  let tmpN = 0;
  const run: SourceRun = {
    deps,
    notes: [],
    now,
    tmpDir,
    isNews,
    eventDate: pitch.event_date,
    cast: ctx.cast,
    spend: { serperQueries: 0, serperUsd: 0, lookUsd: 0 },
    nextName: (ext) => path.join(tmpDir, `c${String(++tmpN).padStart(3, '0')}.${ext}`),
  };
  const cands: Cand[] = [];
  const byUrl = new Map<string, Cand>();
  const live = () => cands.filter((c) => !c.reject);
  let downloads = 0;

  const addWants = (more: readonly Want[]) => {
    for (const w of more) {
      if (wantById.has(w.id)) continue;
      wants.push(w);
      wantById.set(w.id, w);
    }
  };

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

  /** Every screen, cheapest first, over one batch. */
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

    // Near-duplicates: keep the best copy of each picture (across passes), and nothing the inventory already holds.
    const { dropped } = dedupeByHash(live(), better);
    for (const { item, of } of dropped) {
      item.reject = `duplicate_of:${of.source}:${of.url ?? of.localFile ?? ''}`.slice(0, 200);
      for (const w of item.wants) if (!of.wants.includes(w)) of.wants.push(w);
      of.key_want ||= item.key_want;
    }
    if (ctx.known?.length) {
      for (const c of batch) {
        if (c.reject || !c.phash) continue;
        const same = ctx.known.find((k) => hamming(k.phash, c.phash!) <= NEAR_DUPLICATE);
        if (same) c.reject = `duplicate_of:inventory:${same.id}`;
      }
    }
    const mine = () => batch.filter((c) => !c.reject);

    // The 20-day rule. Character images and logos are exempt from the reuse window (MD-41, MD-45); everything else rests 20 days.
    const exempt = (c: RawCandidate) => c.character_image || c.kind === 'logo' || c.flags.includes('logo');
    const reuseKeys = mine().filter((c) => !exempt(c) && c.phash).map((c) => c.phash!);
    const used = await recentlyUsed(deps.db, reuseKeys, settings.reuse_days, now);
    for (const c of mine()) if (!exempt(c) && c.phash && used.has(c.phash)) c.reject = `used_within_${settings.reuse_days}_days`;

    // The look: every found (not made, not banked) image. A photo-bank hit whose identity matched and whose
    // look the bank already holds reuses that look (no paid look); the verdicts below still judge it.
    for (const c of mine()) if (c.prior_look && !c.look) c.look = c.prior_look;
    const toLook = mine().filter((c) => !c.look && ((!c.made && !c.trusted) || isCapture(c)));
    if (toLook.length && deps.create) {
      const budget = Math.max(0, capUsd - run.spend.serperUsd - run.spend.lookUsd - (ctx.spentElsewhere?.() ?? 0));
      const result = await lookAt(
        { db: deps.db, create: deps.create, loadPrompt: deps.loadPrompt, model: settings.vision_model, log },
        toLook.map((c) => ({ file: c.file!, claim: wantById.get(c.wants[0])?.what ?? c.kind, caption: c.caption, source: c.source })),
        { title: pitch.title, keyMoment: pitch.scene ?? pitchBrief(pitch), cast: run.cast, roles, jobId, mode, capUsd: budget },
      );
      run.spend.lookUsd += result.usd;
      run.notes.push(...result.errors);
      toLook.forEach((c, i) => (c.look = result.looks.get(i) ?? null));
    } else if (toLook.some((c) => !isCapture(c))) {
      const note = 'looks: skipped (no model client); found images cannot be checked for watermarks';
      if (!run.notes.includes(note)) run.notes.push(note);
    }

    for (const c of mine()) {
      if (isCapture(c)) {
        // The look answers one thing here: everything downstream treats a capture as it always has.
        const failed = c.look ? lookVerdict(c, c.look) : null;
        c.look = null;
        if (failed) {
          c.reject = failed;
          continue;
        }
      }
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
      // A picture the director wished for and the look says fits is judged by that fit, not by the story's
      // cast (a headquarters or a hotel can't look "about" the story; Rosewood W2 was lost that way).
      if (c.look && !c.look.about_story && !c.people.length && !c.qids.length && !fitsWish(c) && !fitsCastThing(c)) {
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
      // Only a bigger picture that does the same job counts: one the look says doesn't fit is no stand-in.
      const others = live().filter((o) => o !== c && o.look?.fits !== false && o.wants.some((w) => c.wants.includes(w)) && Math.min(o.width ?? 0, o.height ?? 0) >= sizeFloor(o));
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
        const up = await checkedUpscale(deps.upscale, c.file!, out, factor);
        c.file = out;
        c.width = up.width;
        c.height = up.height;
        c.upscaled = true;
        c.flags.push(`upscaled:${factor}x`);
      } catch (error) {
        if (isGarbledUpscale(error)) {
          // The only picture for its job: keep the original, small but whole.
          c.flags.push('upscale_garbled', 'low_res');
          run.notes.push(`upscale garbled for ${c.url ?? c.file} (${error.message}); kept the original`);
          continue;
        }
        c.reject = `too_small:${short}px`;
        run.notes.push(`upscale failed for ${c.url ?? c.file}: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
      }
    }
  };

  const pass = async (ws: readonly Want[], perSource?: number) => {
    addWants(ws);
    const fresh = intake(await gather(ws, run, perSource));
    await screen(fresh);
    return fresh;
  };

  /** The local detector boxes every usable picture that can show a person (no AI spend). */
  const boxFaces = async (batch: readonly Cand[]) => {
    const faceable = batch.filter((c) => !c.reject && c.file && (PORTRAIT_KINDS.has(c.kind) || c.people.length));
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
      const note = 'faces: no detector; no face boxes';
      if (!run.notes.includes(note)) run.notes.push(note);
    }
  };

  return { run, cands, wantById, live, addWants, intake, screen, pass, boxFaces };
}

/**
 * Saves a screened candidate as asset `id` under `<jobDir>/media/` (normalised: long edge ≤ 2160 px) and
 * returns its inventory record. `extraFlags` are added to the candidate's own.
 */
export async function saveAsset(c: Cand, id: string, jobDir: string, extraFlags: readonly string[] = []): Promise<Asset> {
  const mediaDir = path.join(jobDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const saved = await normaliseImage(c.file!, path.join(mediaDir, id), c.kind);
  const rel = `media/${path.basename(saved.file)}`;
  c.width = saved.width;
  c.height = saved.height;
  const flags = [...new Set([...c.flags, `source:${c.source}`, `date_basis:${c.date_basis}`, `recency:${c.recency}`, ...c.wants.map((w) => `want:${w}`), ...extraFlags])];
  if (saved.scale < 1) flags.push(`resized:${Math.round(saved.scale * 1000) / 1000}`);
  const key = c.look?.key_moment === true || (c.made && c.key_want);
  if (key) flags.push('key_moment');
  if (c.text_boxes) {
    const boxes = `media/${id}.boxes.json`;
    fs.writeFileSync(path.join(jobDir, boxes), JSON.stringify({ image: rel, width: c.width, height: c.height, boxes: scaleBoxes(c.text_boxes, saved.scale) }, null, 2));
    flags.push(`boxes:${boxes}`);
  }
  const asset: Asset = {
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
  };
  // Measured here, free and local, so nothing downstream trusts an unmeasured picture. Fails open: the picture stays as saved.
  await measureAsset(asset, jobDir, { faces: c.faces, expression: expressionOf(c.look) }).catch(() => undefined);
  return asset;
}
