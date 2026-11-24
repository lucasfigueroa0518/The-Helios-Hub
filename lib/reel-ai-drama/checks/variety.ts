import { FOCUS_KINDS, type DirectorPlan, type FactSheet, type StoryboardFrame, type VisualsInventory, type WriterDraft } from '@/lib/reel-ai-drama/types';
import { draftLines, hasShotMap, lineAtWord, normName, plainText, planFindings, playerMatcher, samePerson, shotMapFindings, shotSpans, type PlanFinding, type StandIn } from '@/lib/reel-ai-drama/writing/validate';

export { samePerson };

/**
 * Variety with an anchor (MD-60, research 06 §3 and §6), one medium per frame (MD-69) and every named
 * person shown (MD-75), checked on the director's plan in code:
 *   same_way         a person shown the same way (same asset and treatment) more than twice in a row of
 *                    their appearances;
 *   named_not_shown  a person the frame's lines name (a cast person or anyone the inventory pictures)
 *                    absent from the frame's `shows`;
 *   medium_mix       a frame whose people mix photo-based media (photos, cutouts) with drawn ones
 *                    (sketches, a whiteboard), or lays a drawn person over a found photo;
 *   staging_repeat   the same staging type in two adjacent frames (a portrait after a portrait, a
 *                    document after a document): the slideshow feel Lucas called lazy;
 *   style_mix        a frame whose faces are in different styles (a colour cutout beside a rectangular
 *                    photo, a halftone beside a colour print, a drawing beside a photo): MD-94, within any
 *                    one scene every face is in the same style. There is no per-reel or per-person style rule.
 *   focus_share      too many story frames share one focus kind (MD-131): person-focused frames past
 *                    PERSON_FOCUS_MAX of the story frames, or any other single kind past OTHER_FOCUS_MAX.
 * On a plan with shot maps (MD-136; plans saved before iteration 8 skip these):
 *   shot_map, shot_number  the shot map held against the script (writing/validate.ts `shotMapFindings`);
 *   player_intro      a person, company or product in the cast first named on a line with no beat
 *                     introducing them, with a picture (MD-135);
 *   face_rings        more than FACE_RING_MAX circle marks on a face in the reel (MD-138);
 *   thought_marks     more than THOUGHT_MARK_MAX `thought` expression marks in the reel (MD-138);
 * With a draft and an inventory, the plan checks too (writing/validate.ts `planFindings`, iteration 10): a person's picture
 * repeated, the same cast staged the same way, things and places named and not shown, a failed search on an unrelated stand-in.
 * Pure; fails open (the caller turns findings into one director fix, then warnings).
 */

export type VarietyFinding = { id: 'same_way' | 'named_not_shown' | 'medium_mix' | 'staging_repeat' | 'style_mix' | 'focus_share' | 'shot_map' | 'shot_number' | 'player_intro' | 'face_rings' | 'thought_marks' | PlanFinding['id']; frame: number; asset_id: string | null; why: string };

export type VarietyContext = {
  draft?: WriterDraft;
  inventory?: VisualsInventory;
  /** The fact sheet: its cast persons are the names checked (MD-75). Without it, the inventory's people. */
  facts?: FactSheet;
  mainCharacters?: string[];
  /** The plan's makes, when the plan passed in has none of its own (`plan.makes` is read first). */
  makes?: DirectorPlan['makes'];
  /** Wishes the search didn't find, from `standInsFrom`: a frame still on an unrelated fallback goes back to the director (decision 4). */
  standIns?: readonly StandIn[];
};

const an = (k: string) => `${/^[aeiou]/.test(k) ? 'an' : 'a'} ${k}`;

/** The most of the story frames (the close excluded) whose focus may be a person (MD-131). */
export const PERSON_FOCUS_MAX = 0.65;
/** The most of the story frames any other single focus kind may take (MD-131). */
export const OTHER_FOCUS_MAX = 0.5;
/** Circle marks on a face per reel (MD-138). */
export const FACE_RING_MAX = 2;
/** `thought` expression marks per reel (MD-138): a last resort. */
export const THOUGHT_MARK_MAX = 1;

/**
 * Focus shares (MD-131): one finding per focus kind past its share of the story frames, on the first frame
 * past the limit, listing every frame of that kind so the fix can re-focus as many as it needs. Frames with no
 * focus (plans saved before iteration 7) are left out of the count.
 */
export function focusShareFindings(frames: Pick<StoryboardFrame, 'n' | 'treatment' | 'focus' | 'asset_ids'>[]): VarietyFinding[] {
  const story = frames.filter((f) => f.treatment !== 'close' && f.focus?.kind);
  const out: VarietyFinding[] = [];
  if (!story.length) return out;
  const byKind = new Map<string, typeof story>();
  for (const f of story) byKind.set(f.focus!.kind, [...(byKind.get(f.focus!.kind) ?? []), f]);
  for (const [kind, of] of byKind) {
    const share = kind === 'person' ? PERSON_FOCUS_MAX : OTHER_FOCUS_MAX;
    // At least one frame of any kind, so a very short plan isn't held to a share it can't meet.
    const allowed = Math.max(1, Math.floor(share * story.length + 1e-9));
    if (of.length <= allowed) continue;
    const over = of[allowed]!;
    out.push({
      id: 'focus_share',
      frame: over.n,
      asset_id: over.asset_ids?.[0] ?? null,
      why: `${of.length} of the ${story.length} story frames focus on ${an(kind)} (frames ${of.map((f) => f.n).join(', ')}); at most ${allowed} may (${Math.round(share * 100)}%): re-focus at least ${of.length - allowed} of them on what else the beat is about (${FOCUS_KINDS.filter((k) => k !== kind).map(an).join(', ')})`,
    });
  }
  return out;
}

/** The staging type each treatment gives a frame (research 06 §6's menu). `photo` splits on whether it shows a person. */
export const STAGING: Record<string, string> = {
  cutout_lift: 'portrait',
  lower_third: 'portrait',
  collision: 'confrontation',
  tableau: 'tableau',
  page: 'document',
  document: 'document',
  post: 'document',
  headline: 'document',
  newspaper: 'document',
  map: 'map',
  number: 'number',
  stat: 'number',
  lift: 'lift',
  whiteboard: 'drawn',
  board: 'collage',
  collage: 'collage',
};

/** A frame's staging type, or null for the close. */
export function stagingOf(f: Pick<StoryboardFrame, 'treatment' | 'shows'>): string | null {
  if (f.treatment === 'close') return null;
  if (f.treatment === 'photo') return f.shows?.length ? 'portrait' : 'place';
  return STAGING[f.treatment] ?? f.treatment;
}

const norm = normName;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const plain = plainText;

/**
 * The ways narration may name each person: the full name in any case, and, capitalised as a name, the
 * surname and the first name when no other person shares it (at least 4 letters, so it isn't a common
 * word). Single names must be capitalised so "page" or "rose" in a line never reads as a person.
 */
function nameMatchers(people: string[]): Map<string, RegExp[]> {
  const firsts = new Map<string, number>();
  const lasts = new Map<string, number>();
  for (const p of people) {
    const parts = norm(p).split(' ').filter(Boolean);
    firsts.set(parts[0] ?? '', (firsts.get(parts[0] ?? '') ?? 0) + 1);
    lasts.set(parts.at(-1) ?? '', (lasts.get(parts.at(-1) ?? '') ?? 0) + 1);
  }
  const out = new Map<string, RegExp[]>();
  for (const p of people) {
    const words = plain(p).replace(/[^A-Za-z0-9 '-]+/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const res = [new RegExp(`\\b${words.map(escapeRe).join('\\s+')}\\b`, 'i')];
    const cap = (w: string) => new RegExp(`\\b${escapeRe(w[0].toUpperCase() + w.slice(1))}\\b`);
    const last = words.at(-1)!;
    if (words.length > 1 && lasts.get(norm(last)) === 1) res.push(cap(last));
    if (words.length > 1 && words[0].length >= 4 && firsts.get(norm(words[0])) === 1) res.push(cap(words[0]));
    out.set(p, res);
  }
  return out;
}

/** The lowercase words a personal name can hold (`Ursula von der Leyen`). */
const NAME_PARTICLES = new Set(['al', 'bin', 'da', 'de', 'del', 'der', 'di', 'dos', 'du', 'el', 'ibn', 'la', 'le', 'ten', 'ter', 'van', 'von', 'y']);
/** Words that end the name of a collective, however it is capitalised. */
const COLLECTIVE = /^(activists|authors|board|coalition|committee|community|crowd|employees|engineers|executives|founders|group|interns|investors|lawmakers|members|nonprofits|people|protesters|researchers|scientists|signatories|signers|staff|staffers|students|team|users|workers)$/i;

/**
 * A cast entry that describes a group rather than names one person: it holds a lowercase word no personal name holds, or ends on a
 * collective noun. A group has no one face, so it is never a person who must be shown. Pure.
 */
export function isGroupName(name: string): boolean {
  const words = plain(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  return COLLECTIVE.test(words.at(-1)!) || words.some((w) => /^[a-z0-9]/.test(w) && !NAME_PARTICLES.has(w) && !/^[a-z]'/.test(w));
}

/** The people the name check covers: the fact sheet's cast persons, else everyone the inventory pictures, plus the main characters. A group is none of them. */
export function namedPeople(ctx: Pick<VarietyContext, 'facts' | 'inventory' | 'mainCharacters'>): string[] {
  const out: string[] = [];
  const add = (n: string | null | undefined) => {
    if (n?.trim() && !isGroupName(n) && !out.some((x) => samePersonStrict(x, n))) out.push(n.trim());
  };
  if (ctx.facts?.cast?.length) for (const c of ctx.facts.cast) { if (c.kind === 'person') add(c.name); }
  else for (const a of ctx.inventory?.assets ?? []) for (const n of a.people ?? []) add(n);
  for (const n of ctx.mainCharacters ?? (ctx.inventory ? mainCharacters(ctx.inventory) : [])) add(n);
  return out;
}

/** The same person written the same way (full names only): de-duplicates the name list without merging namesakes. */
const samePersonStrict = (a: string, b: string) => norm(a) === norm(b);

/** Asset kinds that are found photographs of a scene or a person (a drawn person never sits over one, MD-69). */
const PHOTO_KINDS = new Set(['person_photo', 'event_photo', 'place_photo', 'archival', 'video_frame']);
const DRAWN_MAKES = new Set(['expression', 'drawing', 'collage', 'sketch']);

type Medium = 'photo' | 'drawn';
/** How a face looks on screen (MD-94): every face in one frame shares one of these. */
export type FaceStyle = 'drawn' | 'cutout' | 'photo' | 'halftone';
/** Treatments that show a person as their character cutout. */
const CUTOUT_TREATMENTS = new Set(['cutout_lift', 'collision', 'tableau']);

/** How a `shows` entry pictures its person: drawn (a sketch make, a drawn made asset, the whiteboard) or photo-based. */
function mediumOf(sh: { asset_id: string; treatment: string }, frame: StoryboardFrame, ctx: { makes: Map<string, string>; assets: Map<string, VisualsInventory['assets'][number]> }): Medium {
  const make = ctx.makes.get(sh.asset_id);
  if (make) return DRAWN_MAKES.has(make) ? 'drawn' : 'photo';
  const a = ctx.assets.get(sh.asset_id);
  if (a?.made && a.made_kind && DRAWN_MAKES.has(a.made_kind)) return 'drawn';
  if ((sh.treatment || frame.treatment) === 'whiteboard') return 'drawn';
  return 'photo';
}

/** The style a `shows` entry gives its person's face: drawn, a cutout, a halftone print or a plain photo. */
function styleOf(sh: { asset_id: string; treatment: string }, frame: StoryboardFrame, ctx: { makes: Map<string, string>; assets: Map<string, VisualsInventory['assets'][number]> }): FaceStyle {
  if (mediumOf(sh, frame, ctx) === 'drawn') return 'drawn';
  const how = (sh.treatment || '').toLowerCase();
  if (/halftone|newsprint/.test(how)) return 'halftone';
  const a = ctx.assets.get(sh.asset_id);
  if (a?.character_image || a?.flags?.includes('cutout') || CUTOUT_TREATMENTS.has(how || frame.treatment)) return 'cutout';
  return 'photo';
}

/** The main characters: every cast name the harvest gave an anchor image (MD-60). */
export function mainCharacters(inventory: VisualsInventory): string[] {
  return [...new Set(inventory.assets.map((a) => a.anchor_for).filter((n): n is string => Boolean(n?.trim())))];
}

export function varietyFindings(plan: Pick<DirectorPlan, 'frames'> & Partial<Pick<DirectorPlan, 'makes'>>, ctx: VarietyContext = {}): VarietyFinding[] {
  const out: VarietyFinding[] = [];
  const frames = [...plan.frames].sort((a, b) => a.n - b.n).filter((f) => f.treatment !== 'close');

  // Staging type back to back.
  for (let i = 1; i < frames.length; i++) {
    const a = stagingOf(frames[i - 1]);
    const b = stagingOf(frames[i]);
    if (a && a === b) {
      out.push({ id: 'staging_repeat', frame: frames[i].n, asset_id: frames[i].asset_ids[0] ?? null, why: `frame ${frames[i].n} repeats the ${b} staging of frame ${frames[i - 1].n}; change the staging type between adjacent frames` });
    }
  }

  // The same person shown the same way more than twice in a row of their appearances.
  const runs = new Map<string, { key: string; count: number }>();
  for (const f of frames) {
    const seen = new Set<string>();
    for (const sh of f.shows ?? []) {
      if (!sh?.person?.trim()) continue;
      const who = [...runs.keys()].find((p) => samePerson(p, sh.person)) ?? sh.person;
      if (seen.has(who)) continue;
      seen.add(who);
      const key = `${sh.asset_id}|${sh.treatment || f.treatment}`;
      const run = runs.get(who);
      const count = run && run.key === key ? run.count + 1 : 1;
      runs.set(who, { key, count });
      if (count === 3) {
        out.push({ id: 'same_way', frame: f.n, asset_id: sh.asset_id, why: `frame ${f.n} shows ${who} as ${sh.asset_id} in ${sh.treatment || f.treatment} for the third time in a row; show them another way: another real photo of them first, or another scale or context (a close crop, a cutout in a setting, a small figure in a wide scene)` });
      }
    }
  }

  // One medium for the people in a frame (MD-69).
  const makes = new Map((plan.makes ?? ctx.makes ?? []).map((m) => [m.id, m.kind as string]));
  const assets = new Map((ctx.inventory?.assets ?? []).map((a) => [a.id, a]));
  for (const f of frames) {
    const people = (f.shows ?? []).filter((sh) => sh?.person?.trim() && sh.asset_id);
    const drawn = people.filter((sh) => mediumOf(sh, f, { makes, assets }) === 'drawn');
    if (!drawn.length) continue;
    const photo = people.filter((sh) => mediumOf(sh, f, { makes, assets }) === 'photo');
    if (photo.length) {
      out.push({ id: 'medium_mix', frame: f.n, asset_id: drawn[0].asset_id, why: `frame ${f.n} mixes media for its people: ${photo.map((sh) => `${sh.person} as ${sh.asset_id} (photo)`).join(', ')} beside ${drawn.map((sh) => `${sh.person} as ${sh.asset_id} (drawn)`).join(', ')}; show every person in it as a real photo or cutout, or draw them all on one surface` });
      continue;
    }
    const under = f.asset_ids.find((id) => !makes.has(id) && !assets.get(id)?.made && PHOTO_KINDS.has(assets.get(id)?.kind ?? ''));
    if (under) {
      out.push({ id: 'medium_mix', frame: f.n, asset_id: drawn[0].asset_id, why: `frame ${f.n} lays a drawing of ${drawn.map((sh) => sh.person).join(', ')} over the photo ${under}; show them by a real photo or cutout there, or move the drawing to a drawn frame with no photo` });
    }
  }

  // One style for every face in a frame (MD-94). A lift shows its page and the piece lifted off it: one artifact.
  for (const f of frames) {
    if (f.treatment === 'lift' || out.some((x) => x.id === 'medium_mix' && x.frame === f.n)) continue;
    const people = (f.shows ?? []).filter((sh) => sh?.person?.trim() && sh.asset_id);
    const styled = people.map((sh) => ({ sh, style: styleOf(sh, f, { makes, assets }) }));
    const styles = [...new Set(styled.map((x) => x.style))];
    if (styles.length < 2) continue;
    const odd = styled.find((x) => x.style !== styled[0].style)!;
    out.push({ id: 'style_mix', frame: f.n, asset_id: odd.sh.asset_id, why: `frame ${f.n} shows its faces in different styles: ${styled.map((x) => `${x.sh.person} as ${x.sh.asset_id} (${x.style})`).join(', ')}; within a scene every face is in one style (all cutouts, all photos, all halftone or all drawn)` });
  }

  // Focus shares (MD-131).
  out.push(...focusShareFindings(frames));

  // A person named in a frame's lines but not shown in it (MD-75: every named person is shown when named).
  const names = namedPeople(ctx);
  if (ctx.draft && names.length) {
    const text = new Map(ctx.draft.rungs.flatMap((r) => r.lines).map((l) => [l.id, l.text]));
    const matchers = nameMatchers(names);
    const makes2 = new Map((plan.makes ?? ctx.makes ?? []).map((m) => [m.id, m.people ?? []]));
    for (const f of frames) {
      const spoken = plain(f.line_ids.map((id) => text.get(id) ?? '').join(' '));
      for (const [person, res] of matchers) {
        if (!res.some((re) => re.test(spoken))) continue;
        if ((f.shows ?? []).some((sh) => samePerson(sh.person, person))) continue;
        if ((f.blueprint?.pieces ?? []).some((p) => p.asset && ((assets.get(p.asset)?.people ?? []).some((n) => samePerson(n, person)) || (makes2.get(p.asset) ?? []).some((n) => samePerson(n, person))))) continue;
        out.push({ id: 'named_not_shown', frame: f.n, asset_id: null, why: `frame ${f.n} names ${person} but doesn't show them; every person is on screen when named (a portrait, a cutout, or drawn in an all-drawn frame), never a faceless stand-in` });
      }
    }
  }
  if (hasShotMap({ frames })) out.push(...shotMapVarietyFindings(frames, ctx));
  if (ctx.draft && ctx.inventory) out.push(...planFindings({ ...plan, makes: plan.makes ?? ctx.makes }, { draft: ctx.draft, inventory: ctx.inventory, facts: ctx.facts, standIns: ctx.standIns }));
  return out;
}

/** Whether a beat's `introduces` means this player: the same name, or one held whole in the other. */
function samePlayer(a: string, b: string): boolean {
  const x = ` ${norm(a)} `;
  const y = ` ${norm(b)} `;
  return x.trim() !== '' && y.trim() !== '' && (x.includes(y) || y.includes(x));
}

/**
 * Every player is introduced where the reel first names them (MD-135): the beat with `introduces` sits on that
 * line and names a picture of them. People come from `namedPeople`, companies and products from the cast.
 */
function playerFindings(frames: StoryboardFrame[], ctx: VarietyContext): VarietyFinding[] {
  if (!ctx.draft) return [];
  const lines = draftLines(ctx.draft);
  const lineText = new Map(lines.map((l) => [l.id, l.text]));
  const people = namedPeople(ctx);
  const matchers = [...nameMatchers(people)];
  for (const c of ctx.facts?.cast ?? []) {
    if (c.kind === 'person') continue;
    const re = playerMatcher(c.name);
    if (re) matchers.push([c.name, [re]]);
  }
  const out: VarietyFinding[] = [];
  const named = new Set<string>();
  for (const f of frames) {
    for (const id of f.line_ids) {
      const spoken = plain(lineText.get(id) ?? '');
      for (const [player, res] of matchers) {
        if (named.has(player) || !res.some((re) => re.test(spoken))) continue;
        named.add(player);
        // A frame with no beats has its own finding.
        if (!f.shots?.length) continue;
        const spans = shotSpans(f, lineText);
        const beats = spans.filter((s) => s && samePlayer(s.shot.introduces ?? '', player) && lineAtWord(f, lineText, s.start) === id);
        if (!beats.length) {
          out.push({ id: 'player_intro', frame: f.n, asset_id: null, why: `frame ${f.n}: ${id} is the first line to name ${player}, and no beat on it introduces them; add a beat on that line with introduces "${player}" and a picture of them (a face, a logo, the product) [MD-135]` });
        } else if (!beats.some((s) => s!.shot.asset_ids?.length)) {
          out.push({ id: 'player_intro', frame: f.n, asset_id: null, why: `frame ${f.n} introduces ${player} on "${beats[0]!.shot.at}" with no picture; name one in the beat's asset_ids: an inventory asset, a make or a wish [MD-135]` });
        }
      }
    }
  }
  return out;
}

/** How many circle marks a frame's blueprint draws on a face (MD-138). */
export function faceRings(f: Pick<StoryboardFrame, 'blueprint'>): number {
  return (f.blueprint?.marks ?? []).filter((m) => m?.kind === 'circle' && /^face\s*:/i.test(m.target ?? '')).length;
}

/** Whether a frame's blueprint draws a `thought` expression mark (MD-138). */
export function hasThoughtMark(f: Pick<StoryboardFrame, 'blueprint'>): boolean {
  return (f.blueprint?.marks ?? []).some((m) => m?.kind === 'thought');
}

/** MD-135, MD-136, MD-138: the checks a plan with shot maps answers to. */
function shotMapVarietyFindings(frames: StoryboardFrame[], ctx: VarietyContext): VarietyFinding[] {
  const out: VarietyFinding[] = [];
  if (ctx.draft) out.push(...shotMapFindings({ frames }, ctx.draft));
  out.push(...playerFindings(frames, ctx));

  let rings = 0;
  const ringFrames = frames.filter((f) => faceRings(f) > 0);
  for (const f of ringFrames) {
    rings += faceRings(f);
    if (rings > FACE_RING_MAX) out.push({ id: 'face_rings', frame: f.n, asset_id: null, why: `frame ${f.n} takes the reel past ${FACE_RING_MAX} circle marks on a face (frames ${ringFrames.map((g) => g.n).join(', ')}); give this one another way to point at the person: their words beside them, a label, a move, a cut to what they are looking at [MD-138]` });
  }
  const thoughts = frames.filter(hasThoughtMark);
  for (const f of thoughts.slice(THOUGHT_MARK_MAX)) {
    out.push({ id: 'thought_marks', frame: f.n, asset_id: null, why: `frame ${f.n} draws a thought mark, and the reel already has ${THOUGHT_MARK_MAX} (frames ${thoughts.map((g) => g.n).join(', ')}): it is a last resort; show the inner state another way [MD-138]` });
  }

  return out;
}

/** The variety findings as plain problem strings. */
export function varietyProblems(plan: Pick<DirectorPlan, 'frames'> & Partial<Pick<DirectorPlan, 'makes'>>, ctx: VarietyContext = {}): string[] {
  return varietyFindings(plan, ctx).map((f) => f.why);
}
