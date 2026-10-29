import type { DirectorPlan, StoryboardFrame, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';

/**
 * Variety with an anchor (MD-60, research 06 §3 and §6), checked on the director's plan in code:
 *   same_way        a person shown the same way (same asset and treatment) more than twice in a row of
 *                   their appearances;
 *   not_shown       a main character named in a frame's lines but absent from the frame's `shows`;
 *   staging_repeat  the same staging type in two adjacent frames (a portrait after a portrait, a
 *                   document after a document): the slideshow feel Lucas called lazy.
 * Pure; fails open (the caller turns findings into one director fix, then warnings).
 */

export type VarietyFinding = { id: 'same_way' | 'not_shown' | 'staging_repeat'; frame: number; asset_id: string | null; why: string };

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

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const surname = (s: string) => norm(s).split(' ').at(-1) ?? '';

/** Whether two ways of writing a person's name are the same person (full name, or the same surname). */
export function samePerson(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || surname(x) === surname(y);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The ways narration may name each main character: the full name, the surname, and the first name when no
 * other main character shares it (and it is at least 4 letters, so it isn't a common word).
 */
function nameMatchers(people: string[]): Map<string, RegExp> {
  const firsts = new Map<string, number>();
  for (const p of people) {
    const f = norm(p).split(' ')[0] ?? '';
    firsts.set(f, (firsts.get(f) ?? 0) + 1);
  }
  const out = new Map<string, RegExp>();
  for (const p of people) {
    const parts = norm(p).split(' ').filter(Boolean);
    const forms = new Set([parts.join(' '), parts.at(-1) ?? '']);
    if (parts.length > 1 && parts[0].length >= 4 && firsts.get(parts[0]) === 1) forms.add(parts[0]);
    const alt = [...forms].filter(Boolean).map((f) => escapeRe(f).replace(/ /g, '\\s+')).join('|');
    out.set(p, new RegExp(`\\b(?:${alt})\\b`, 'i'));
  }
  return out;
}

/** The main characters: every cast name the harvest gave an anchor image (MD-60). */
export function mainCharacters(inventory: VisualsInventory): string[] {
  return [...new Set(inventory.assets.map((a) => a.anchor_for).filter((n): n is string => Boolean(n?.trim())))];
}

export function varietyFindings(
  plan: Pick<DirectorPlan, 'frames'>,
  ctx: { draft?: WriterDraft; inventory?: VisualsInventory; mainCharacters?: string[] } = {},
): VarietyFinding[] {
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
        out.push({ id: 'same_way', frame: f.n, asset_id: sh.asset_id, why: `frame ${f.n} shows ${who} as ${sh.asset_id} in ${sh.treatment || f.treatment} for the third time in a row; show them another way (another scale, medium or context: a different portrait, a cutout in a setting, a sketch)` });
      }
    }
  }

  // A main character named in a frame's lines but not shown in it.
  const mains = ctx.mainCharacters ?? (ctx.inventory ? mainCharacters(ctx.inventory) : []);
  if (ctx.draft && mains.length) {
    const text = new Map(ctx.draft.rungs.flatMap((r) => r.lines).map((l) => [l.id, l.text]));
    const matchers = nameMatchers(mains);
    for (const f of frames) {
      const spoken = f.line_ids.map((id) => text.get(id) ?? '').join(' ');
      const plain = norm(spoken);
      for (const [person, re] of matchers) {
        if (!re.test(plain)) continue;
        if ((f.shows ?? []).some((sh) => samePerson(sh.person, person))) continue;
        out.push({ id: 'not_shown', frame: f.n, asset_id: null, why: `frame ${f.n} names ${person} but doesn't show them; every main character is visible whenever named (their anchor, another portrait, a cutout or a sketch)` });
      }
    }
  }
  return out;
}

/** The variety findings as plain problem strings. */
export function varietyProblems(
  plan: Pick<DirectorPlan, 'frames'>,
  ctx: { draft?: WriterDraft; inventory?: VisualsInventory; mainCharacters?: string[] } = {},
): string[] {
  return varietyFindings(plan, ctx).map((f) => f.why);
}
