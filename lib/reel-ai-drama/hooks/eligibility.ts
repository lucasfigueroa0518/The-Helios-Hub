import { WORDS_PER_SECOND } from '@/lib/reel-ai-drama/writing/validate';
import { HOOK_IDS, type Asset, type HookBeat, type HookChoice, type HookHeadline, type HookId, type SourceRef, type VisualsInventory } from '@/lib/reel-ai-drama/types';

/**
 * Which opening hooks a reel may use (ITERATION-12-CONTRACT): assets are the hard rule, meaning decides among what's left.
 * `hookOptions` runs before the director chooses and removes every hook whose asset gate fails. `resolveHook` keeps a valid
 * choice, repairs what it can and replaces what it can't, so a bad choice never reaches a render and a reel is never blocked.
 * Pure: no clock, no model, no files.
 */

export type HookOption = { id: HookId; meaning: string; needs: string; assets: string[]; headlines?: HookHeadline[] };

const MEANING: Record<HookId, string> = {
  flashbulb: 'Fame, pressure, a public moment',
  wall_of_screens: 'Scale, the world watching',
  lock_on: 'The one person no one noticed',
  rewind: 'It started long ago',
  darkroom: 'Hidden, revealed, a stranger',
  slide_carousel: 'A sequence of events told step by step',
  front_page: 'News, an announcement, a deal, a scandal',
  burn: 'Something destroyed, replaced or taken over',
};

const NEEDS: Record<HookId, string> = {
  flashbulb: '3 to 5 sharp photos, all of one person; the charged words freeze the last one',
  wall_of_screens: '5 or more images; the first is the screen the camera enters, those on or after the charged words appear inside it',
  lock_on: '1 to 4 targets, each locked on its words',
  rewind: '3 or more photos with different dates; the earliest is where the tape lands, on its words',
  darkroom: '1 or 2 prints, each a confirmed photo of a person; the first finishes developing on the charged words',
  slide_carousel: '4 to 7 varied images, each changing on its words',
  front_page: '2 to 4 images, each a page landing on its words, under a real headline copied from the list',
  burn: '2 to 4 images with no text in them; each burns through to the next on its words',
};

/** How many beats a hook takes. Wall of Screens takes many: it treats each image several ways. */
const BEATS: Record<HookId, { min: number; max: number }> = {
  flashbulb: { min: 3, max: 5 },
  wall_of_screens: { min: 5, max: 8 },
  lock_on: { min: 1, max: 4 },
  rewind: { min: 3, max: 5 },
  darkroom: { min: 1, max: 2 },
  slide_carousel: { min: 4, max: 7 },
  front_page: { min: 2, max: 4 },
  burn: { min: 2, max: 4 },
};
const WALL_FALLBACK_MIN = 3;

/** The longest side a picture needs before it can hold the frame, and the shortest. Logos are drawn, so they only need the first. */
const MIN_LONG_SIDE = 900;
const MIN_SHORT_SIDE = 480;
/** Below this a photo looks soft at full frame. */
const SHARP_WIDTH = 1080;
/** A face taller than this share of the picture, or wider, is too close. */
const FACE_TOO_TALL = 0.5;
const FACE_TOO_WIDE = 0.8;
/** A target taller than this share of its photo leaves no room to zoom in. */
const TARGET_MAX_SHARE = 0.34;

const PHOTO_KINDS = new Set<string>(['person_photo', 'event_photo', 'place_photo', 'product', 'object']);
const PERSON_KINDS = new Set<string>(['person_photo', 'event_photo']);
const UNCONFIRMED = /\b(?:not confirmed|unconfirmed|not verified|unverified|cannot confirm|can't confirm|could not confirm|unclear whether)\b/i;

const hasFlag = (a: Asset, ...names: string[]) => (a.flags ?? []).some((f) => names.some((n) => f === n || f.startsWith(`${n}:`)));
const isLogo = (a: Asset) => a.kind === 'logo';
/** A picture all words and no face is a screen capture, whatever kind the look pass gave it: never a photo to a hook. */
const screenLike = (a: Asset) => hasFlag(a, 'text_heavy') && hasFlag(a, 'faces:0') && !(a.people ?? []).length;
const isPhoto = (a: Asset) => PHOTO_KINDS.has(a.kind) && !a.made && !a.character_image && !hasFlag(a, 'cutout') && !screenLike(a);
const named = (a: Asset) => (a.people ?? []).length > 0;
const hasWords = (a: Asset) => hasFlag(a, 'text_heavy') || ((a.regions as { words?: unknown[] } | undefined)?.words ?? []).length > 0;
const faceOf = (a: Asset) => a.face ?? a.regions?.faces?.[0] ?? null;

/** Identity marked unconfirmed in `shows`: such a picture never stands for a named person. Pure. */
export function identityUnconfirmed(a: Pick<Asset, 'shows'>): boolean {
  return UNCONFIRMED.test(String(a.shows ?? ''));
}

/** A face too large for the picture to be shown as a photo of someone. Pure. */
export function faceTooClose(a: Pick<Asset, 'face'>): boolean {
  return Boolean(a.face && (a.face.h > FACE_TOO_TALL || a.face.w > FACE_TOO_WIDE));
}

function largeEnough(a: Asset): boolean {
  const long = Math.max(a.width ?? 0, a.height ?? 0);
  const short = Math.min(a.width ?? 0, a.height ?? 0);
  return isLogo(a) ? long >= MIN_SHORT_SIDE : long >= MIN_LONG_SIDE && short >= MIN_SHORT_SIDE;
}

/** The contract's usable image: large enough, identity not marked unconfirmed, face not too close. Pure. */
export function usableImage(a: Asset): boolean {
  return (isPhoto(a) || isLogo(a)) && largeEnough(a) && !identityUnconfirmed(a) && !faceTooClose(a) && !a.regions?.dup_of;
}

const sharp = (a: Asset) => {
  const px = a.regions?.sharp_width_px;
  return !Number.isFinite(px) || (px as number) >= SHARP_WIDTH;
};
const yearOf = (a: Asset): number | null => {
  if (a.date_confidence === 'unknown' || !a.date_taken) return null;
  const m = /\b(1[89]\d\d|20\d\d)\b/.exec(String(a.date_taken));
  return m ? Number(m[1]) : null;
};
const confirmedPerson = (a: Asset) => PERSON_KINDS.has(a.kind) && named(a) && hasFlag(a, 'identity:verified');

/** A person's position in a photo wide enough to zoom into. */
function zoomTarget(a: Asset): boolean {
  if (!isPhoto(a)) return false;
  const f = faceOf(a);
  return Boolean(f && f.h <= TARGET_MAX_SHARE && f.h > 0);
}

/** Text that reads as a headline, cut of the site name a page title ends in; null when it isn't one. Always a verbatim part of the title. Pure. */
export function headlineOf(source: Pick<SourceRef, 'title' | 'publisher' | 'url'>): string | null {
  const title = String(source.title ?? '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  if (/wikipedia/i.test(`${source.publisher ?? ''} ${source.url ?? ''} ${title}`)) return null;
  const cut = /^(.*\S)\s+[|–—-]\s+[^|–—-]{1,40}$/.exec(title)?.[1] ?? title;
  const words = cut.split(' ').length;
  return words >= 4 && words <= 18 ? cut : null;
}

/** One real headline per source, never repeating. Pure. */
export function realHeadlines(sources: readonly SourceRef[]): HookHeadline[] {
  const seen = new Set<string>();
  const out: HookHeadline[] = [];
  for (const s of sources ?? []) {
    const text = headlineOf(s);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push({ text, publisher: s.publisher, url: s.url });
  }
  return out;
}

/** Whether a headline's words appear exactly in a source's title. Pure. */
export function headlineIsVerbatim(h: Pick<HookHeadline, 'text'>, sources: readonly SourceRef[]): boolean {
  const text = String(h.text ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 0 && (sources ?? []).some((s) => String(s.title ?? '').replace(/\s+/g, ' ').includes(text));
}

/** The photos of the people who have enough of them for Flashbulb. */
function flashbulbAssets(usable: readonly Asset[]): string[] {
  const byPerson = new Map<string, string[]>();
  for (const a of usable) {
    if (!isPhoto(a) || !PERSON_KINDS.has(a.kind) || (a.people ?? []).length !== 1 || !faceOf(a) || !sharp(a)) continue;
    byPerson.set(a.people[0], [...(byPerson.get(a.people[0]) ?? []), a.id]);
  }
  return [...byPerson.values()].filter((ids) => ids.length >= BEATS.flashbulb.min).flat();
}

/** Photos with known dates, at most one per year, when they cover enough different years. */
function rewindAssets(usable: readonly Asset[]): string[] {
  const dated = usable.filter((a) => isPhoto(a) && yearOf(a) !== null);
  return new Set(dated.map(yearOf)).size >= BEATS.rewind.min ? dated.map((a) => a.id) : [];
}

const option = (id: HookId, assets: string[], headlines?: HookHeadline[]): HookOption => ({ id, meaning: MEANING[id], needs: NEEDS[id], assets, ...(headlines ? { headlines } : {}) });

/** The hooks whose asset gate passes, each with the ids usable for it. Pure. */
/**
 * The hooks the director and problem solver may pick: every hook whose gate passes, except Front Page. Front Page is a backup only
 * (Lucas, 2026-11-07): behind Wall of Screens at three images and ahead of Darkroom in the fallback chain. Pure.
 */
export function hookOptions(inventory: VisualsInventory, sources: SourceRef[]): HookOption[] {
  return gatedOptions(inventory, sources).filter((o) => o.id !== 'front_page');
}

/** Front Page's option when its gate passes, for the fallback chain only. Pure. */
export function frontPageBackup(inventory: VisualsInventory, sources: SourceRef[]): HookOption | null {
  return gatedOptions(inventory, sources).find((o) => o.id === 'front_page') ?? null;
}

/** Every hook whose asset gate passes, in HOOK_IDS order. */
function gatedOptions(inventory: VisualsInventory, sources: SourceRef[]): HookOption[] {
  const assets = inventory?.assets ?? [];
  const usable = assets.filter(usableImage);
  const photos = usable.filter(isPhoto);
  const out: HookOption[] = [];

  const flash = flashbulbAssets(usable);
  if (flash.length) out.push(option('flashbulb', flash));

  if (usable.length >= BEATS.wall_of_screens.min) out.push(option('wall_of_screens', usable.map((a) => a.id)));

  const targets = photos.filter(zoomTarget).map((a) => a.id);
  if (targets.length >= BEATS.lock_on.min) out.push(option('lock_on', [...targets, ...usable.filter(isLogo).map((a) => a.id)]));

  const dated = rewindAssets(usable);
  if (dated.length) out.push(option('rewind', dated));

  // Darkroom develops a person (Lucas, 2026-11-08): only confirmed photos of people are its prints.
  const people = photos.filter(confirmedPerson);
  if (people.length) out.push(option('darkroom', people.map((a) => a.id)));

  const varied = new Set(usable.map((a) => a.regions?.phash ?? a.phash ?? a.id));
  if (varied.size >= BEATS.slide_carousel.min) out.push(option('slide_carousel', usable.map((a) => a.id)));

  const headlines = realHeadlines(sources ?? []);
  if (headlines.length && usable.length >= BEATS.front_page.min) out.push(option('front_page', usable.map((a) => a.id), headlines));

  const clean = photos.filter((a) => !hasWords(a) && sharp(a));
  if (clean.length >= BEATS.burn.min) out.push(option('burn', clean.map((a) => a.id)));

  return HOOK_IDS.flatMap((id) => out.filter((o) => o.id === id));
}

// ── The resolve ─────────────────────────────────────────────────────────────────────────────────

type ResolveContext = { inventory: VisualsInventory; sources: SourceRef[]; words: string };

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v: unknown) => clean(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The spoken words of the line, one per place. */
const spoken = (words: string) => clean(words).split(' ').filter(Boolean);

/** Whether the line says these words in a row. Pure. */
function says(words: string, phrase: string): boolean {
  const want = key(phrase);
  return want.length > 0 && ` ${key(words)} `.includes(` ${want} `);
}

/**
 * The words a hit lands on when no one named them, from the line's first CHARGED_BY_WORD + 1 words: a figure if they hold
 * one, else the words after their last comma, else the word about two-thirds through. Always words the line says. Pure.
 */
/** The hit lands within the opening's first 2.5 seconds (Lucas, 2026-11-08): the charged words start by this many spoken words. */
export const CHARGED_BY_SECONDS = 2.5;
export const CHARGED_BY_WORD = Math.max(2, Math.floor(CHARGED_BY_SECONDS * WORDS_PER_SECOND));

/** Where the phrase starts in the line, in spoken words; -1 when the line doesn't say it. Pure. */
export function chargedStart(words: string, phrase: string): number {
  const all = spoken(words);
  const want = key(phrase);
  if (!want) return -1;
  return all.findIndex((_, i) => ` ${key(all.slice(i).join(' '))} `.startsWith(` ${want} `));
}

export function chargedWords(words: string): string {
  const all = spoken(words).slice(0, CHARGED_BY_WORD + 1);
  if (!all.length) return '';
  const figure = all.findIndex((w) => /\d/.test(w));
  if (figure >= 0) return all.slice(figure, figure + 2).join(' ').replace(/[,.;:!?]+$/, '');
  const comma = all.slice(0, -1).reduce((at, w, i) => (/[,;:]$/.test(w) && i >= 2 ? i : at), -1);
  const at = comma >= 0 ? comma + 1 : Math.floor(all.length * 0.66);
  return all.slice(at, at + 2).join(' ').replace(/[,.;:!?]+$/, '');
}

/** Beats on evenly spread words of the line: code's own timing when no one chose. */
function spreadBeats(assets: readonly string[], words: string, { until = 1 }: { until?: number } = {}): HookBeat[] {
  const all = spoken(words);
  return assets.map((asset, i) => {
    const at = Math.floor((i / Math.max(1, assets.length)) * all.length * until);
    // Two words, so a common word lands where it was meant to and not on its first use.
    return { asset, on: all.slice(at, at + 2).join(' ').replace(/[,.;:!?]+$/, '') };
  });
}

/** Faces first, then the sharpest, so code's own choice opens on a person where it can. */
function ranked(ids: readonly string[], byId: ReadonlyMap<string, Asset>, words: string): string[] {
  const line = key(words);
  const score = (a: Asset | undefined) => {
    if (!a) return -1;
    const inLine = (a.people ?? []).some((p) => key(p).split(' ').some((w) => w.length > 2 && ` ${line} `.includes(` ${w} `)));
    return (inLine ? 4 : 0) + (faceOf(a) ? 2 : 0) + (isPhoto(a) ? 1 : 0) + (sharp(a) ? 0.5 : 0) - (hasWords(a) ? 2 : 0);
  };
  return [...ids].sort((x, y) => score(byId.get(y)) - score(byId.get(x)));
}

/** Pictures that aren't the same picture twice, ordered to alternate between people and kinds. */
function varied(ids: readonly string[], byId: ReadonlyMap<string, Asset>, count: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const of = (id: string) => (byId.get(id)?.people ?? [])[0] ?? byId.get(id)?.kind ?? id;
  for (const id of ids) {
    if (out.length >= count) break;
    if (!seen.has(of(id))) {
      out.push(id);
      seen.add(of(id));
    }
  }
  for (const id of ids) {
    if (out.length >= count) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** One person's photos for Flashbulb: the person the most beats already show, or the first with enough. */
function flashbulbPerson(ids: readonly string[], byId: ReadonlyMap<string, Asset>, picked: readonly string[] = []): string[] {
  const of = (id: string) => byId.get(id)?.people?.[0] ?? '';
  const counts = new Map<string, number>();
  for (const id of picked) counts.set(of(id), (counts.get(of(id)) ?? 0) + 1);
  const pool = [...new Set(ids.map(of))].filter((p) => ids.filter((id) => of(id) === p).length >= BEATS.flashbulb.min);
  const person = [...pool].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
  return ids.filter((id) => of(id) === person);
}

/** One photo per year, newest first, ending on the earliest. */
function rewindRun(ids: readonly string[], byId: ReadonlyMap<string, Asset>, count: number): string[] {
  const year = (id: string) => yearOf(byId.get(id) as Asset) ?? 0;
  const one = new Map<number, string>();
  for (const id of ids) if (!one.has(year(id))) one.set(year(id), id);
  const years = [...one.keys()].sort((a, b) => b - a);
  const keep = years.length <= count ? years : [...years.slice(0, count - 1), years[years.length - 1]];
  return keep.map((y) => one.get(y) as string);
}

/** Code's own beats for a hook, from what its option offers. Pure. */
function codeBeats(o: HookOption, byId: ReadonlyMap<string, Asset>, words: string): HookBeat[] {
  const top = ranked(o.assets, byId, words);
  if (o.id === 'flashbulb') return spreadBeats(flashbulbPerson(top, byId).slice(0, BEATS.flashbulb.max), words, { until: 0.6 });
  if (o.id === 'rewind') return spreadBeats(rewindRun(o.assets, byId, 4), words, { until: 0.6 });
  if (o.id === 'lock_on') return spreadBeats(varied(top, byId, 3), words);
  if (o.id === 'darkroom') return spreadBeats([top.find((id) => { const a = byId.get(id); return a ? confirmedPerson(a) : false; }) ?? top[0]].filter((id): id is string => Boolean(id)), words);
  if (o.id === 'wall_of_screens') return spreadBeats(varied(top, byId, BEATS.wall_of_screens.min), words);
  return spreadBeats(varied(top, byId, Math.min(BEATS[o.id].max, Math.max(BEATS[o.id].min, 4))), words);
}

/** Code's own choice of one qualifying hook: its pictures, spread over the line, and the words its hit lands on. Pure. */
export function codeHook(o: HookOption, ctx: { inventory: VisualsInventory; words: string }): HookChoice {
  const byId = new Map((ctx.inventory?.assets ?? []).map((a) => [a.id, a]));
  return { id: o.id, beats: codeBeats(o, byId, ctx.words), charged: chargedWords(ctx.words), ...(o.headlines ? { headlines: o.headlines } : {}) };
}

const CODE_ORDER: HookId[] = ['slide_carousel', 'flashbulb', 'burn', 'wall_of_screens', 'lock_on', 'rewind'];

/** The chain when nothing qualifies: Wall of Screens at three images, then Front Page, then Darkroom with one confirmed photo, then the blueprint's frame. */
function fallbackChoice(options: readonly HookOption[], usable: readonly Asset[], byId: ReadonlyMap<string, Asset>, ctx: ResolveContext, flags: string[]): HookChoice | null {
  const words = ctx.words;
  const charged = chargedWords(words);
  if (usable.length >= WALL_FALLBACK_MIN) {
    const assets = varied(ranked(usable.map((a) => a.id), byId, words), byId, WALL_FALLBACK_MIN);
    return { id: 'wall_of_screens', beats: spreadBeats(assets, words), charged, fallback: 'wall_of_screens_3', flags: [...flags, 'No hook qualified: Wall of Screens opens on three images, below its usual five.'] };
  }
  const page = frontPageBackup(ctx.inventory, ctx.sources ?? []);
  if (page) return { ...codeHook(page, ctx), fallback: 'front_page', flags: [...flags, 'No hook qualified: Front Page opens on real headlines, as the backup.'] };
  const dark = options.find((o) => o.id === 'darkroom');
  if (dark) return { id: 'darkroom', beats: codeBeats(dark, byId, words), charged, fallback: 'darkroom', flags: [...flags, 'No hook qualified: Darkroom opens on one confirmed photo as a bordered print.'] };
  flags.push('No hook qualified and no confirmed photo exists: frame 1 renders from its blueprint.');
  return null;
}

/** The code's choice among what qualifies. Pure. */
function codeChoice(options: readonly HookOption[], ctx: ResolveContext, byId: ReadonlyMap<string, Asset>, flags: string[]): HookChoice | null {
  const usable = (ctx.inventory?.assets ?? []).filter(usableImage);
  const pick = CODE_ORDER.map((id) => options.find((o) => o.id === id)).find(Boolean);
  if (!pick) return fallbackChoice(options, usable, byId, ctx, flags);
  return {
    id: pick.id,
    beats: codeBeats(pick, byId, ctx.words),
    charged: chargedWords(ctx.words),
    ...(pick.headlines ? { headlines: pick.headlines } : {}),
    flags,
  };
}

/**
 * The hook that runs: a valid choice as it is; assets outside the option dropped, and beats topped up from the option when
 * that leaves too few; an ineligible or missing choice replaced by code's. Flags say what changed. Pure.
 */
export function resolveHook(proposed: HookChoice | null | undefined, options: HookOption[], ctx: ResolveContext): HookChoice | null {
  const byId = new Map((ctx.inventory?.assets ?? []).map((a) => [a.id, a]));
  const flags: string[] = [...(proposed?.flags ?? [])];
  if (!proposed) {
    flags.push('The director named no hook: code chose one.');
    return withFlags(codeChoice(options, ctx, byId, flags));
  }
  // A plan already resolved to the Front Page backup keeps it; nothing else may pick it.
  const o = options.find((x) => x.id === proposed.id) ?? (proposed.id === 'front_page' && proposed.fallback === 'front_page' ? frontPageBackup(ctx.inventory, ctx.sources ?? []) ?? undefined : undefined);
  if (!o) {
    flags.push(`The chosen hook ${proposed.id} doesn't have the assets it needs: code chose another.`);
    return withFlags(codeChoice(options, ctx, byId, flags));
  }

  const limit = BEATS[o.id];
  const allowed = new Set(o.assets);
  const kept: HookBeat[] = [];
  for (const b of proposed.beats ?? []) {
    if (!allowed.has(b?.asset)) flags.push(`${b?.asset} doesn't qualify for ${o.id}: dropped.`);
    else if (kept.some((k) => k.asset === b.asset)) flags.push(`${b.asset} was used twice in ${o.id}: dropped.`);
    else kept.push({ asset: b.asset, on: clean(b.on) });
  }
  let beats = kept;
  if (o.id === 'flashbulb') {
    const person = new Set(flashbulbPerson(o.assets, byId, kept.map((b) => b.asset)));
    const others = beats.filter((b) => !person.has(b.asset));
    if (others.length) flags.push(`Flashbulb shows one person: ${others.map((b) => b.asset).join(', ')} dropped.`);
    beats = beats.filter((b) => person.has(b.asset));
  }
  if (o.id === 'rewind') {
    const years = new Set<number>();
    beats = beats.filter((b) => {
      const y = yearOf(byId.get(b.asset) as Asset);
      if (y === null || years.has(y)) {
        flags.push(`${b.asset} repeats a year on the tape: dropped.`);
        return false;
      }
      years.add(y);
      return true;
    });
  }
  if (beats.length > limit.max) {
    flags.push(`${o.id} takes at most ${limit.max} images: the rest dropped.`);
    beats = beats.slice(0, limit.max);
  }
  if (beats.length < limit.min) {
    const pool = o.id === 'flashbulb' ? flashbulbPerson(o.assets, byId, beats.map((b) => b.asset)) : o.id === 'rewind' ? rewindRun(o.assets, byId, limit.min + 1) : ranked(o.assets, byId, ctx.words);
    const years = new Set(beats.map((b) => yearOf(byId.get(b.asset) as Asset)));
    const extra = pool.filter((id) => !beats.some((b) => b.asset === id) && (o.id !== 'rewind' || !years.has(yearOf(byId.get(id) as Asset))));
    const added = extra.slice(0, limit.min - beats.length);
    if (added.length) flags.push(`${o.id} needed ${limit.min} images: code added ${added.join(', ')}.`);
    beats = [...beats, ...added.map((asset) => ({ asset, on: '' }))];
  }
  if (beats.length < limit.min) {
    flags.push(`${o.id} could not get ${limit.min} images: code chose another.`);
    return withFlags(codeChoice(options.filter((x) => x.id !== o.id), ctx, byId, flags));
  }

  const charged = clean(proposed.charged);
  let useCharged = says(ctx.words, charged) ? charged : chargedWords(ctx.words);
  if (useCharged !== charged) flags.push(`The charged words "${charged}" aren't in the line: the hit lands on "${useCharged}".`);
  else if (chargedStart(ctx.words, charged) > CHARGED_BY_WORD) {
    useCharged = chargedWords(ctx.words);
    flags.push(`The charged words "${charged}" come after the first ${CHARGED_BY_SECONDS} s: the hit lands on "${useCharged}".`);
  }

  const choice: HookChoice = { id: o.id, beats, charged: useCharged };
  if (o.id === 'front_page') {
    const verbatim = (proposed.headlines ?? []).filter((h) => {
      const ok = headlineIsVerbatim(h, ctx.sources ?? []);
      if (!ok) flags.push(`The headline "${clean(h?.text).slice(0, 60)}" isn't in any source: dropped.`);
      return ok;
    });
    choice.headlines = verbatim.length ? verbatim : o.headlines;
  }
  if (proposed.fallback) choice.fallback = proposed.fallback;
  return withFlags({ ...choice, flags });
}

function withFlags(choice: HookChoice | null): HookChoice | null {
  if (!choice) return null;
  const { flags, ...rest } = choice;
  return flags?.length ? { ...rest, flags: [...new Set(flags)] } : rest;
}
