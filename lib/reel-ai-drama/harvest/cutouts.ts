import fs from 'node:fs';
import path from 'node:path';

import type { Queryable } from '@/lib/explainers/db';
import { mapBlueprintAssets, type Asset, type CastMember, type DirectorPlan, type ShotWish, type StoryboardFrame, type VisualsInventory } from '@/lib/reel-ai-drama/types';

import { assetAnchorScore, isGarbledAsset } from './anchors';
import { mainFace } from './faces';
import { phash } from './filters';
import { normaliseImage } from './media';
import { slug } from './plan';
import { measureAsset, rawCutPath } from './regions';
import { MAX_KEPT } from './transparent';
import type { CutPerson, DetectFaces, FaceBox } from './types';

/**
 * Cutouts after the writer (MD-81, MD-100). The harvest cuts out the people it guesses are central before the
 * script exists, and wished photos come back as plain photos. So, once the story is written:
 *   - every person the writer names `central` who has a usable portrait but no cutout gets one (rembg, local, free);
 *   - a found wish photo of a person that lands in a `cutout_lift`, `collision` or `tableau` frame gets one,
 *     and those frames use it;
 *   - MD-127: a found wish photo whose wish says `cut_out` (a person, an object such as a table, plates or a
 *     lamp, or a place element) is cut out, joins the inventory as a transparent cutout of what the wish
 *     names, and every frame that uses the photo uses the cutout instead.
 * The choices are pure; `makeCutouts` does the I/O and fails open per request (a problem line each): a
 * failed cutout leaves the frames on the found photo. Cutouts are never upscaled (an upscale of a
 * transparent picture came back as tiled garbage); a source is upscaled, if at all, before it is cut.
 */

/** Treatments that lift a person off their background (MD-81: these need a transparent cutout). */
export const CUTOUT_TREATMENTS: ReadonlySet<string> = new Set(['cutout_lift', 'collision', 'tableau']);

/**
 * A cutout the run asks for: who (or what), cut from which asset, whether it becomes their anchor, and
 * (wishes) the frames that use it. `person: false` (MD-127) cuts out a thing, not a person: `name` is a
 * short name for it and `shows` what the wish asked for. Absent `person` means a person.
 */
export type CutoutRequest = { name: string; source_id: string; anchor: boolean; frames?: number[]; person?: boolean; shows?: string; wish?: string };

/** MD-127: the director asked for this wish's find to be cut out (`ShotWish.cut_out`; optional until every plan carries it). */
export const wantsCutout = (wish: Pick<ShotWish, 'id'>): boolean => (wish as { cut_out?: unknown }).cut_out === true;

/** Kinds a cut-out wish's photo can be cut from: pictures of people, places and things (never a page, a logo file, a map or a chart). */
export const CUTTABLE_KINDS: ReadonlySet<string> = new Set(['person_photo', 'event_photo', 'place_photo', 'object', 'product', 'archival', 'video_frame']);

/** A short name for what a wish wants cut out ("A real wooden dinner table, seen from above" → "A real wooden dinner table"). */
export function thingName(want: string): string {
  const head = String(want ?? '').split(/[,.;:(—–]/)[0]!.replace(/\s+/g, ' ').trim();
  return (head || String(want ?? '').trim()).slice(0, 60).trim() || 'the wished thing';
}

/**
 * A cut too poor to offer as a cutout (iteration 10). It stays on the inventory's record so nothing asks for it again, but
 * nothing may show it as a cutout: `isGarbledAsset` passes it by, and a frame that uses it shows the picture it was cut from.
 */
export const isRejectedCut = (a: Pick<Asset, 'regions'>): boolean => a.regions?.cut?.grade === 'rejected';

/** The picture a cutout was cut from, or null: what a frame prints when the cut is rejected. */
export function cutSource(inventory: VisualsInventory, a: Pick<Asset, 'flags'>): Asset | null {
  const id = a.flags.find((f) => f.startsWith('cutout_of:'))?.slice('cutout_of:'.length);
  return id ? inventory.assets.find((x) => x.id === id) ?? null : null;
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const ONE_PERSON = (a: Asset, name: string) => a.people.length === 1 && key(a.people[0]) === key(name);

/** A usable (not garbled) transparent cutout of `name` is already in the inventory. */
export function hasCutoutOf(inventory: VisualsInventory, name: string): boolean {
  return inventory.assets.some((a) => a.flags.includes('cutout') && !isGarbledAsset(a) && ONE_PERSON(a, name));
}

/**
 * The people among the writer's `central` names (MD-100): the fact sheet or the pitch says what kind each
 * name is; a name neither knows counts as a person only when the inventory pictures them. Each name once.
 */
export function centralPersons(central: readonly string[], cast: readonly Pick<CastMember, 'name' | 'kind'>[], inventory: VisualsInventory): string[] {
  const kind = new Map(cast.map((m) => [key(m.name), m.kind]));
  const seen = new Set<string>();
  return central.filter((name) => {
    const k = key(name);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    const known = kind.get(k);
    if (known) return known === 'person';
    return inventory.assets.some((a) => a.people.some((p) => key(p) === k));
  });
}

/** The best verified solo portrait of `name` to cut from (never a cutout, a made picture or a garbled one). */
export function cutoutSourceAsset(inventory: VisualsInventory, name: string): Asset | null {
  let best: { a: Asset; s: number } | null = null;
  for (const a of inventory.assets) {
    if (a.made || a.flags.includes('cutout')) continue;
    const s = assetAnchorScore(a, a.people[0] ?? '');
    if (s === null || !ONE_PERSON(a, name)) continue;
    const score = s + (a.anchor_for && key(a.anchor_for) === key(name) ? 0.5 : 0);
    if (!best || score > best.s) best = { a, s: score };
  }
  return best?.a ?? null;
}

/** A main person's cutouts: enough different pictures that the director needn't repeat one (ITERATION-10 D). */
export const CUTOUTS_PER_PERSON = 3;

/** The pictures still to cut for one person, best first: never a repeat of a picture, or of one already cut. */
export function cutoutSources(inventory: VisualsInventory, name: string): Asset[] {
  const group = (a: Asset) => a.regions?.dup_of ?? a.id;
  const cuts = inventory.assets.filter((a) => a.flags.includes('cutout') && !a.made && !isRejectedCut(a) && ONE_PERSON(a, name));
  const taken = new Set(cuts.map((c) => {
    const from = cutSource(inventory, c);
    return from ? group(from) : c.id;
  }));
  const refused = new Set(inventory.assets.flatMap((a) => (isRejectedCut(a) ? a.flags.filter((f) => f.startsWith('cutout_of:')).map((f) => f.slice('cutout_of:'.length)) : [])));
  const ranked: { a: Asset; s: number }[] = [];
  for (const a of inventory.assets) {
    if (a.made || a.flags.includes('cutout') || !ONE_PERSON(a, name) || refused.has(a.id)) continue;
    const s = assetAnchorScore(a, a.people[0] ?? '');
    if (s === null) continue;
    ranked.push({ a, s: s + (a.anchor_for && key(a.anchor_for) === key(name) ? 0.5 : 0) });
  }
  ranked.sort((x, y) => y.s - x.s);
  const out: Asset[] = [];
  for (const { a } of ranked) {
    if (taken.size >= CUTOUTS_PER_PERSON) break;
    if (taken.has(group(a))) continue;
    taken.add(group(a));
    out.push(a);
  }
  return out;
}

/** Central people (the writer's `central`): a few cutouts each, from different pictures; the rest are problem lines. */
export function centralCutoutRequests(
  central: readonly string[],
  cast: readonly Pick<CastMember, 'name' | 'kind'>[],
  inventory: VisualsInventory,
): { requests: CutoutRequest[]; problems: string[] } {
  const requests: CutoutRequest[] = [];
  const problems: string[] = [];
  for (const name of centralPersons(central, cast, inventory)) {
    const sources = cutoutSources(inventory, name);
    if (!sources.length && !hasCutoutOf(inventory, name)) {
      problems.push(`${name} has no verified solo portrait to cut out, so no cutout was made`);
      continue;
    }
    const anchored = inventory.assets.some((a) => a.anchor_for && key(a.anchor_for) === key(name) && !isGarbledAsset(a));
    sources.forEach((src, i) => requests.push({ name, source_id: src.id, anchor: !anchored && i === 0 }));
  }
  return { requests, problems };
}

const frameUses = (f: StoryboardFrame, id: string) => (f.asset_ids ?? []).includes(id) || (f.shows ?? []).some((sh) => sh.asset_id === id);
const cutoutFrame = (f: StoryboardFrame, id: string) =>
  (CUTOUT_TREATMENTS.has(f.treatment) && frameUses(f, id)) || (f.shows ?? []).some((sh) => sh.asset_id === id && CUTOUT_TREATMENTS.has(sh.treatment));

/**
 * Found wish photos to cut out, one request each with the frames that will swap to the cutout: a wish with
 * `cut_out` (MD-127; a person or a thing; every frame that uses the photo), and a person's photo that a
 * cutout treatment uses (MD-81; only those frames).
 */
export function wishCutoutRequests(plan: DirectorPlan, found: readonly { wish: ShotWish; asset_id: string }[], inventory: VisualsInventory): CutoutRequest[] {
  const out: CutoutRequest[] = [];
  for (const { wish, asset_id } of found) {
    if (out.some((r) => r.source_id === asset_id)) continue;
    const a = inventory.assets.find((x) => x.id === asset_id);
    if (!a || a.made || a.flags.includes('cutout') || isGarbledAsset(a)) continue;
    if (wantsCutout(wish)) {
      if (!CUTTABLE_KINDS.has(a.kind)) continue;
      const person = Boolean(wish.person?.trim());
      const frames = plan.frames.filter((f) => frameUses(f, asset_id)).map((f) => f.n);
      out.push({ name: person ? wish.person!.trim() : thingName(wish.want), source_id: asset_id, anchor: false, frames, person, shows: wish.want.trim(), wish: wish.id });
      continue;
    }
    if (!wish.person) continue;
    const frames = plan.frames.filter((f) => cutoutFrame(f, asset_id)).map((f) => f.n);
    if (frames.length) out.push({ name: wish.person, source_id: asset_id, anchor: false, frames });
  }
  return out;
}

/** The treatments that stage pieces (`nk.stage`): every person on one is a real cutout. */
export const STAGE_TREATMENTS: ReadonlySet<string> = new Set(['collision', 'tableau', 'collage']);

/**
 * Every person on a stage is a real cutout: an uncut one-person picture in a stage frame swaps to a cutout the inventory
 * already has of it, else one is asked for (local rembg, no spend). `character_image` isn't trusted: only a cut that exists
 * counts. What can't be cut stays a framed print, which `nk.stage` shows. Pure.
 */
export function stageCutoutRequests(plan: DirectorPlan, inventory: VisualsInventory): { requests: CutoutRequest[]; swaps: { from: string; to: string; frames: number[] }[] } {
  const cut = (a: Asset) => a.flags.includes('cutout') || a.flags.includes('transparent');
  const requests: CutoutRequest[] = [];
  const swaps: { from: string; to: string; frames: number[] }[] = [];
  const stageFrames = plan.frames.filter((f) => f.blueprint || STAGE_TREATMENTS.has(f.treatment));
  // A blueprint says which pictures stand on the stage: not a fill, a treatment's own picture or a ground.
  const standing = (f: StoryboardFrame) => f.blueprint
    ? f.blueprint.pieces.filter((p) => p.asset && !p.fill && !p.treatment && !p.crop).map((p) => p.asset!)
    : [...(f.asset_ids ?? []), ...(f.shows ?? []).map((sh) => sh.asset_id)];
  const ids = new Set(stageFrames.flatMap(standing));
  for (const id of ids) {
    const a = inventory.assets.find((x) => x.id === id);
    const frames = stageFrames.filter((f) => standing(f).includes(id)).map((f) => f.n);
    // A rejected cut in a stage frame goes back to the picture it was cut from, which the stage prints.
    if (a && isRejectedCut(a)) {
      const from = cutSource(inventory, a);
      if (from) swaps.push({ from: id, to: from.id, frames });
      continue;
    }
    if (!a || a.made || cut(a) || a.people.length !== 1 || !CUTTABLE_KINDS.has(a.kind) || isGarbledAsset(a)) continue;
    const own = inventory.assets.find((x) => x.flags.includes(`cutout_of:${id}`) && !isGarbledAsset(x));
    // Its own cut only: another photo's cut would turn different pictures of a person into one.
    if (own) swaps.push({ from: id, to: own.id, frames });
    // This very picture has already been cut, and the cut was refused: it stays a print.
    else if (!inventory.assets.some((x) => x.flags.includes(`cutout_of:${id}`) && isRejectedCut(x))) requests.push({ name: a.people[0]!, source_id: id, anchor: false, frames });
  }
  return { requests, swaps };
}

/** The made cutout for each request (matched by its `cutout_of` flag), as frame swaps. */
export function cutoutSwaps(requests: readonly CutoutRequest[], made: readonly Asset[]): { from: string; to: string; frames: number[] }[] {
  return requests.flatMap((r) => {
    const a = made.find((m) => m.flags.includes(`cutout_of:${r.source_id}`) && (r.person === false ? m.people.length === 0 : ONE_PERSON(m, r.name)));
    return a && r.frames?.length ? [{ from: r.source_id, to: a.id, frames: r.frames }] : [];
  });
}

/** The named frames use the cutout instead of the photo (asset ids, shows, and the ids named in motion and marks). Pure. */
export function useCutouts(plan: DirectorPlan, swaps: readonly { from: string; to: string; frames: readonly number[] }[]): DirectorPlan {
  if (!swaps.length) return plan;
  const frames = plan.frames.map((f) => {
    const mine = swaps.filter((s) => s.frames.includes(f.n));
    if (!mine.length) return f;
    const to = new Map(mine.map((s) => [s.from, s.to]));
    const re = new RegExp(`\\b(?:${[...to.keys()].join('|')})\\b`, 'g');
    const text = (s: string) => (typeof s === 'string' ? s.replace(re, (id) => to.get(id) ?? id) : s);
    const ids: string[] = [];
    for (const id of f.asset_ids ?? []) {
      const next = to.get(id) ?? id;
      if (!ids.includes(next)) ids.push(next);
    }
    const out: StoryboardFrame = { ...f, asset_ids: ids };
    if (f.motion !== undefined) out.motion = text(f.motion);
    if (f.marks !== undefined) out.marks = text(f.marks);
    // A piece standing on its own takes the cutout; a treatment's or a full-frame picture keeps its photo.
    if (f.blueprint) out.blueprint = mapBlueprintAssets(f.blueprint, (id) => to.get(id) ?? id, { plainOnly: true });
    if (f.shows) out.shows = f.shows.map((sh) => ({ ...sh, asset_id: to.get(sh.asset_id) ?? sh.asset_id }));
    if (f.shots) out.shots = f.shots.map((sh) => ({ ...sh, asset_ids: [...new Set(sh.asset_ids.map((id) => to.get(id) ?? id))] }));
    return out;
  });
  return { ...plan, frames };
}

export type CutoutDeps = {
  /** rembg (live.ts); null: no cutouts, one problem line per person. */
  cutout: CutPerson | null;
  detectFaces?: DetectFaces | null;
  /** Records each cutout like a harvest asset (reel_ai_drama.assets); optional. */
  db?: Queryable | null;
};

const lastId = (inventory: VisualsInventory, mediaDir: string) => {
  let max = 0;
  for (const a of inventory.assets) {
    const m = /^V(\d+)$/.exec(a.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  if (fs.existsSync(mediaDir)) {
    for (const f of fs.readdirSync(mediaDir)) {
      const m = /^V(\d+)\.[a-z0-9]+$/i.exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max;
};

/**
 * Cuts each request's source picture out with rembg into `<jobDir>/media/V<n>.png` (numbered after the
 * inventory's last V id) and returns the new assets. A request with `anchor` becomes the person's
 * character image and anchor; otherwise a plain cutout. A thing (`person: false`, MD-127) becomes an
 * `object` (or `place_photo`) cutout with no people. The remover's own check refuses a speck; a result
 * that keeps almost the whole picture (no background found) is refused here. Never upscaled. Fails open
 * per request.
 */
export async function makeCutouts(
  deps: CutoutDeps,
  input: { inventory: VisualsInventory; requests: readonly CutoutRequest[]; jobDir: string; jobId: string | null },
): Promise<{ assets: Asset[]; problems: string[] }> {
  const assets: Asset[] = [];
  const problems: string[] = [];
  if (!input.requests.length) return { assets, problems };
  const mediaDir = path.join(input.jobDir, 'media');
  let n = lastId(input.inventory, mediaDir);
  for (const req of input.requests) {
    const src = input.inventory.assets.find((a) => a.id === req.source_id);
    if (!src) {
      problems.push(`${req.name}: ${req.source_id} is not in the inventory; no cutout`);
      continue;
    }
    if (!deps.cutout) {
      problems.push(`${req.name}: no background remover (rembg) is set up; no cutout from ${src.id}`);
      continue;
    }
    const file = path.join(input.jobDir, src.file);
    if (!fs.existsSync(file)) {
      problems.push(`${req.name}: ${src.file} is missing on disk; no cutout`);
      continue;
    }
    const tmp = path.join(mediaDir, `tmp-cutout-${slug(req.name)}-${src.id}.png`);
    try {
      const res = await deps.cutout(file, tmp);
      if (!res.ok) {
        problems.push(`${req.name}: the cutout of ${src.id} failed (${res.error.slice(0, 160)})`);
        continue;
      }
      if (res.coverage > MAX_KEPT) {
        problems.push(`${req.name}: the cutout of ${src.id} kept ${(res.coverage * 100).toFixed(0)}% of the picture (no background was found), so ${src.id} stays a photo`);
        continue;
      }
      const person = req.person !== false;
      const kind: Asset['kind'] = person ? 'person_photo' : src.kind === 'place_photo' ? 'place_photo' : 'object';
      n += 1;
      const id = `V${n}`;
      const saved = await normaliseImage(tmp, path.join(mediaDir, id), kind);
      let faces: FaceBox[] | null = null;
      if (person && deps.detectFaces) {
        try {
          faces = (await deps.detectFaces([saved.file])).get(saved.file) ?? null;
        } catch {
          // no face box; the kit centres the cutout
        }
      }
      const face: Asset['face'] = mainFace(faces);
      const identity = src.flags.filter((f) => (person && f.startsWith('identity:')) || f.startsWith('wish:'));
      const what = (req.shows ?? req.name).replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
      const asset: Asset = {
        id,
        kind,
        file: `media/${path.basename(saved.file)}`,
        url: null,
        source_page: src.source_page ?? src.url,
        credit: src.credit,
        license: src.license,
        shows: person
          ? `${req.name}, cut out of ${src.id} onto a transparent background${req.anchor ? ' (their character image)' : ''}.`
          : `A real-photo cutout of ${what.slice(0, 200)}: cut out of ${src.id} (${src.shows.replace(/[.\s]+$/, '').slice(0, 140)}) onto a transparent background.`,
        people: person ? [req.name] : [],
        qids: person ? src.qids : [],
        place: src.place,
        date_taken: src.date_taken,
        date_confidence: src.date_confidence,
        width: saved.width,
        height: saved.height,
        phash: await phash(saved.file),
        character_image: req.anchor && person,
        made: false,
        upscaled: src.upscaled,
        flags: [
          ...new Set([
            'cutout',
            'cutout_made',
            person ? 'cutout_after_writer' : 'cutout_thing',
            `cutout_of:${src.id}`,
            ...(req.wish ? ['cutout_wish', `cutout_wish:${req.wish}`] : []),
            ...identity,
            ...(req.anchor && person ? [`anchor:${req.name}`] : []),
          ]),
        ],
        anchor_for: req.anchor && person ? req.name : null,
        face,
        made_kind: null,
      };
      // Cleaned and graded before anything can use it. A cut we can't offer costs nothing to refuse: the frames stay on the photo.
      await measureAsset(asset, input.jobDir, { faces, source: src }).catch(() => undefined);
      if (isRejectedCut(asset)) {
        problems.push(`${req.name}: the cutout of ${src.id} was too poor to use (edges ${Math.round((asset.regions!.cut!.edge_softness) * 100)}% unsure), so ${src.id} stays a photo`);
        for (const f of [saved.file, rawCutPath(saved.file)]) fs.rmSync(f, { force: true });
        n -= 1;
        continue;
      }
      if (deps.db) {
        try {
          await deps.db.query(`INSERT INTO reel_ai_drama.assets (job_id, asset_key, ref, kind, status, data) VALUES ($1, $2, $3, $4, 'usable', $5::jsonb)`, [
            input.jobId,
            asset.phash ?? `cutout:${input.jobId}:${id}`,
            id,
            asset.kind,
            JSON.stringify(asset),
          ]);
        } catch {
          // the record is for review and the 20-day rule (cutouts are exempt); the cutout still works
        }
      }
      assets.push(asset);
    } catch (error) {
      problems.push(`${req.name}: the cutout of ${src.id} failed (${error instanceof Error ? error.message.slice(0, 160) : String(error)})`);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  return { assets, problems };
}
