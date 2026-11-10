/**
 * The shared photo finder (PHASE3-CONTRACT.md, Owner A): AI Drama's harvest engine, one harvest per frame, adapting
 * to each type's profile. Generalizes harvestBuilderPhoto (lib/lfd/photos.ts), which stays for LFD's legacy mode.
 *
 * - Frames run serially. Frame i may spend `(capUsd - spent) / (frames left, counting this one)`, so one frame
 *   can't spend the whole post's cap; unused money rolls forward. A harvest that throws keeps its whole allowance
 *   charged (fix 10): its partial spend is unknown.
 * - The harvest's db is a sink (never AI Drama's tables); kept photos still go to the shared photo bank through
 *   `deps.harvest.photoBank`. Its looks are the harvest's own `lookAt` on `settings.vision_model` (no new
 *   messages.create).
 * - Never throws: a frame it can't fill is null, with a trace saying why, and goes to today's finder.
 * Every trace line starts with `shared:` so adopters and the review page can tell the steps apart.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { hamming, NEAR_DUPLICATE } from '@/lib/reel-ai-drama/harvest/filters';
import { planWants, slug } from '@/lib/reel-ai-drama/harvest/plan';
import { SERPER_IMAGES_URL, SERPER_USD_PER_QUERY } from '@/lib/reel-ai-drama/harvest/sources/serper';
import type { HarvestDeps } from '@/lib/reel-ai-drama/harvest/types';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Asset, CastMember, Pitch } from '@/lib/reel-ai-drama/types';
import type { Photo } from '@/lib/stories/render/types';

import type { FindOptions, FoundPhotos, PhotoBudget, PhotoDeps, PhotoNeed, PhotoProfile } from './types';

/** Answers every harvest query with nothing and records nothing (no AI Drama asset, use or cost rows). */
const SINK_DB: HarvestDeps['db'] = { query: async () => ({ rows: [] }) };

/** Below this an allowance can't pay for a frame's searches plus one look sheet; the frame goes to today's finder. */
export const MIN_ALLOWANCE_USD = 0.02;
/** Share of a frame's allowance its Serper searches may spend; the harvest itself never caps Serper by money. */
export const SERPER_SHARE = 0.4;
/** Held back from the harvest's look cap: the look checks the cap before each sheet, so one sheet can run past it. */
export const LOOK_HEADROOM_USD = 0.015;

/**
 * `http` with a Serper allowance: once this frame's searches would pass `usd`, a Serper request gets a 429 without
 * leaving the process (the harvest notes the failed source and goes on), so Serper spend stays inside the allowance.
 */
export function serperLimited(http: typeof fetch, usd: number): typeof fetch {
  let spent = 0;
  const limited = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(SERPER_IMAGES_URL)) {
      if (spent + SERPER_USD_PER_QUERY > usd + 1e-9) return new Response('shared finder: Serper allowance spent', { status: 429 });
      spent += SERPER_USD_PER_QUERY;
    }
    return http(input, init);
  };
  return limited as typeof fetch;
}

const CAST_KIND: Record<PhotoNeed['subjects'][number]['type'], CastMember['kind']> = { person: 'person', organization: 'company', product: 'product' };

/** Found photos a frame can show. Screens, maps, charts, papers and video frames are made or aren't photos. */
const PHOTO_KINDS = new Set<Asset['kind']>(['person_photo', 'event_photo', 'place_photo', 'product', 'logo', 'archival', 'object']);

const isWebUrl = (u: string | null): u is string => !!u && /^https?:\/\//i.test(u);
const isLogo = (a: Asset) => a.kind === 'logo' || a.flags.includes('logo');
const urlKey = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();

/** The harvest pitch for one need: a cast member per subject, the story URLs as sources, the need's moment as the scene. */
export function pitchForNeed(need: PhotoNeed): Pitch {
  const seen = new Set<string>();
  const cast: CastMember[] = [];
  for (const s of need.subjects) {
    const name = s.name.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    cast.push({ name, role: 'named in the story', kind: CAST_KIND[s.type] ?? 'company', player_id: null });
  }
  const title = need.headline || need.copy || need.query;
  return {
    title,
    brief: (need.brief || need.headline || need.copy).slice(0, 1200),
    story_type: 'breakthrough',
    era: 'now',
    event_date: need.storyDate,
    date_precision: 'day',
    cast,
    why_now: null,
    expected_visuals: [],
    sources: need.storyUrls.filter((u) => isWebUrl(u)).map((url, i) => ({ url, title, publisher: (i === 0 ? need.sourceName : null) ?? '', date: need.storyDate })),
    // The key moment the harvest searches for: the writer's own photo query, else the frame's words.
    scene: need.query || need.copy || need.headline,
  };
}

/** Short side of the image as found on the web: the harvest's saved size undone (`resized:<scale>`, `upscaled:<f>x`). */
export function nativeShortSide(a: Asset): number {
  let side = Math.min(a.width || 0, a.height || 0);
  if (side <= 0) return 0;
  for (const f of a.flags) {
    const resized = /^resized:([\d.]+)$/.exec(f);
    if (resized && Number(resized[1]) > 0) side /= Number(resized[1]);
    const up = /^upscaled:(?:anchor:)?([\d.]+)x$/.exec(f);
    if (up && Number(up[1]) > 0) side /= Number(up[1]);
  }
  // Upscaled with no factor on record: the web image's size is unknown, so it can't clear a floor.
  if (a.upscaled && !a.flags.some((f) => /^upscaled:(?:anchor:)?[\d.]+x$/.test(f))) return 0;
  return Math.round(side);
}

/**
 * The story pages' own images. The harvest marks every saved asset with `want:<id>` for each want that found it and
 * `source:<adapter>` (pipeline.ts saveAsset). Story pages are planned as `article:<n>` wants on the 'article' or
 * 'newsroom' adapter (plan.ts). Robust rule: any of those marks, or a source page that is one of the need's story URLs
 * (the same image can be found again by another want, keeping only that want's mark).
 */
export function fromStoryPage(a: Asset, storyUrls: readonly string[]): boolean {
  if (a.flags.some((f) => f.startsWith('want:article:') || f === 'source:article' || f === 'source:newsroom')) return true;
  if (!a.source_page) return false;
  const page = urlKey(a.source_page);
  return storyUrls.some((u) => urlKey(u) === page);
}

type Picked = { urls: Set<string>; hashes: string[] };

/** The writer asked for a place: a setting, or a query naming a building. */
export function asksForPlace(need: PhotoNeed): boolean {
  return need.kind === 'setting' || /\b(headquarters|hq|offices?|campus|building|lobby|factory|plant|store|lab)\b/i.test(need.query);
}

/**
 * A photo of a building or place (the harvest's `place_photo`: a company's offices, a street, a campus). Such a photo
 * rarely shows what a frame is about, and one banked building photo would otherwise fill every frame about that
 * company, whichever search found it: it fills a frame only when the writer asked for a place.
 */
export function isPlacePhoto(a: Asset): boolean {
  return a.kind === 'place_photo';
}

/** Why an asset can't fill this frame, or null when it can. */
function refusal(a: Asset, need: PhotoNeed, profile: PhotoProfile, exclude: ReadonlySet<string>, picked: Picked): string | null {
  if (!isWebUrl(a.url)) return 'no web URL';
  if (a.made) return 'made';
  if (!PHOTO_KINDS.has(a.kind)) return 'not a photo';
  if (exclude.has(a.url)) return 'excluded';
  if (picked.urls.has(a.url)) return 'already in the set';
  if (a.phash && picked.hashes.some((h) => hamming(h, a.phash!) <= NEAR_DUPLICATE)) return 'near-duplicate in the set';
  if (isPlacePhoto(a) && !asksForPlace(need)) return "a building or place (the frame didn't ask for a place)";
  const logo = isLogo(a);
  if (logo && need.cover) return 'logo on the cover';
  if (logo && !profile.allowLogo && need.kind !== 'logo' && need.kind !== 'company') return 'logo not allowed';
  // A logo is exempt from the inner floor (lib/social/photos/size.ts), never from the cover's (no logo covers anyway).
  const floor = need.cover ? profile.coverMinShortSide : logo ? 0 : profile.minShortSide;
  if (floor > 0 && nativeShortSide(a) < floor) return 'too small';
  return null;
}

/** The frame's photo from the usable assets, in the need's order (see the contract's 'story' / 'subject' rules). */
export function rankAssets(usable: readonly Asset[], need: PhotoNeed): Asset[] {
  const people = need.subjects.filter((s) => s.type === 'person').map((s) => s.name);
  const things = need.subjects.filter((s) => s.type !== 'person');
  const named = (a: Asset, name: string) => a.people.includes(name);
  const portraits = [
    ...people.flatMap((name) => usable.filter((a) => a.kind === 'person_photo' && named(a, name))),
    ...people.flatMap((name) => usable.filter((a) => a.kind === 'event_photo' && named(a, name) && a.flags.includes(`want:person-event:${slug(name)}`))),
  ];
  const wanted = (a: Asset, prefixes: string[]) => prefixes.some((p) => a.flags.includes(`want:${p}`));
  const thingsOf = (s: (typeof things)[number]) => {
    const k = slug(s.name);
    const photos = usable.filter((a) => !isLogo(a) && wanted(a, [`product:${k}`, `company-place:${k}`]));
    const logos = usable.filter((a) => isLogo(a) && wanted(a, [`product-logo:${k}`, `company:${k}`]));
    return need.kind === 'logo' ? [...logos, ...photos] : [...photos, ...logos];
  };
  const subjectThings = things.flatMap(thingsOf);
  const moment = [...usable.filter((a) => a.flags.includes('key_moment')), ...usable.filter((a) => fromStoryPage(a, need.storyUrls))];
  const personAsk = need.kind === 'person';
  const order =
    need.specificity === 'story'
      ? [...moment, ...portraits, ...subjectThings]
      : personAsk || things.length === 0
        ? [...portraits, ...subjectThings, ...moment]
        : [...subjectThings, ...portraits, ...moment];
  // Then anything else the story's own wants found (a person of the story around the time, other found photos).
  const rest = usable.filter((a) => a.kind !== 'logo' && a.kind !== 'product');
  const out: Asset[] = [];
  const ids = new Set<string>();
  for (const a of [...order, ...rest]) if (!ids.has(a.id)) (ids.add(a.id), out.push(a));
  return out;
}

/** Mapped as asPhoto (lib/lfd/photos.ts): kind, credit, and focus from the face box. */
export function assetToPhoto(a: Asset): Photo {
  const kind: Photo['kind'] = a.kind === 'person_photo' ? 'person' : isLogo(a) ? 'logo' : 'scene';
  const focus = a.face ? { x: Math.min(1, Math.max(0, a.face.x + a.face.w / 2)), y: Math.min(1, Math.max(0, a.face.y + a.face.h / 2)) } : undefined;
  return { src: a.url!, credit: a.credit, kind, ...(focus ? { focus } : {}) };
}

const errText = (err: unknown) => (err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160));

async function findOne(
  need: PhotoNeed,
  profile: PhotoProfile,
  deps: PhotoDeps,
  exclude: ReadonlySet<string>,
  budget: PhotoBudget,
  framesLeft: number,
  picked: Picked,
  accept?: FindOptions['accept'],
): Promise<{ photo: Photo | null; trace: string[] }> {
  const left = budget.capUsd - budget.usd;
  const allowance = left / framesLeft;
  if (!(allowance >= MIN_ALLOWANCE_USD)) {
    const why = left <= 1e-9 ? `the post's $${budget.capUsd.toFixed(2)} cap is spent` : `$${allowance.toFixed(3)} left for this frame of the post's $${budget.capUsd.toFixed(2)} cap (under $${MIN_ALLOWANCE_USD.toFixed(2)})`;
    return { photo: null, trace: [`shared: skipped, ${why}; today's finder takes over`] };
  }
  const pitch = pitchForNeed(need);
  const trace: string[] = [];
  try {
    const wants = planWants(pitch, null, { isNews: true, cutouts: [] });
    trace.push(`shared: ${need.specificity} need "${need.query || need.copy || need.headline}" (${need.kind}); wants ${wants.map((w) => w.id).join(', ')} ($${allowance.toFixed(3)} of $${left.toFixed(3)} left)`);
  } catch (err) {
    trace.push(`shared: ${need.specificity} need (${need.kind}); wants not listed (${errText(err)}) ($${allowance.toFixed(3)} of $${left.toFixed(3)} left)`);
  }
  const settings: ReelAiDramaSettings = { ...(deps.settings ?? DEFAULT_SETTINGS), min_visuals: 1, reuse_days: 0 };
  let jobDir: string | null = null;
  // Charged upfront (fix 10): a harvest that throws may already have paid for searches and looks it cannot report.
  const before = budget.usd;
  budget.usd = before + allowance;
  try {
    const run = deps.run ?? (await import('@/lib/reel-ai-drama/harvest/harvest')).runHarvest;
    jobDir = fs.mkdtempSync(path.join(deps.workDir ?? os.tmpdir(), 'photos-harvest-'));
    const res = await run(
      { ...deps.harvest, http: serperLimited(deps.harvest.http, allowance * SERPER_SHARE), db: SINK_DB, capUsd: Math.max(0, allowance - LOOK_HEADROOM_USD), log: deps.harvest.log ?? (() => undefined), now: deps.harvest.now ?? deps.now },
      { pitch, facts: null, jobDir, jobId: null, mode: 'production', settings },
    );
    const usd = Math.max(0, Number(res.inventory.usd) || 0);
    budget.usd = before + usd;
    const assets = res.inventory.assets ?? [];
    trace.push(`shared: harvest found ${assets.length}, $${usd.toFixed(3)} (post total $${budget.usd.toFixed(3)})${res.inventory.kill ? `; harvest note: ${res.inventory.kill.reason}` : ''}`);
    const why = new Map<string, number>();
    const usable = assets.filter((a) => {
      const r = refusal(a, need, profile, exclude, picked);
      if (r) why.set(r, (why.get(r) ?? 0) + 1);
      return !r;
    });
    let asset: Asset | null = null;
    for (const a of rankAssets(usable, need)) {
      const r = accept?.(assetToPhoto(a), need) ?? null;
      if (!r) {
        asset = a;
        break;
      }
      const key = `refused by the type (${r.slice(0, 80)})`;
      why.set(key, (why.get(key) ?? 0) + 1);
    }
    if (!asset) {
      const reasons = [...why].map(([r, n]) => `${n} ${r}`).join(', ');
      return { photo: null, trace: [...trace, `shared: nothing usable${reasons ? ` (${reasons})` : ''}; today's finder takes over`] };
    }
    picked.urls.add(asset.url!);
    if (asset.phash) picked.hashes.push(asset.phash);
    trace.push(`shared: picked ${asset.id} ${asset.kind} "${asset.shows}" via ${asset.credit}: ${asset.url}`);
    return { photo: assetToPhoto(asset), trace };
  } catch (err) {
    return { photo: null, trace: [...trace, `shared: harvest failed (${errText(err)}); its $${allowance.toFixed(3)} allowance counts as spent; today's finder takes over`] };
  } finally {
    if (jobDir) {
      try {
        fs.rmSync(jobDir, { recursive: true, force: true });
      } catch {
        // a leftover tmp folder is harmless
      }
    }
  }
}

/**
 * One photo per need, same order, serial, under the post's budget (`opts.budget`, mutated). Null = this frame goes to
 * today's finder. No two frames share a photo by URL or by pHash. Never throws.
 */
export async function findPhotos(needs: PhotoNeed[], profile: PhotoProfile, deps: PhotoDeps, opts: FindOptions): Promise<FoundPhotos> {
  const photos: Array<Photo | null> = [];
  const traces: string[][] = [];
  const picked: Picked = { urls: new Set(), hashes: [] };
  for (const [i, need] of needs.entries()) {
    try {
      const got = await findOne(need, profile, deps, opts.exclude, opts.budget, needs.length - i, picked, opts.accept);
      photos.push(got.photo);
      traces.push(got.trace);
    } catch (err) {
      photos.push(null);
      traces.push([`shared: failed (${errText(err)}); today's finder takes over`]);
    }
  }
  return { photos, traces };
}
