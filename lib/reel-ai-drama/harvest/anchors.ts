import type { Asset, VisualsInventory } from '@/lib/reel-ai-drama/types';

/**
 * Anchor fallback (iteration 3): a picture the look, the upscale check or the integrity check finds
 * corrupted or garbled is never an anchor. The next best portrait of that person takes the job. Pure, over
 * the saved inventory, so the run can apply it after the integrity check (harvest.ts already applies the
 * same rule before saving: cast.ts `anchorScore`).
 */

/** Words an integrity finding uses for a broken file (not for a wrong or misleading picture). */
export const GARBLED_WORDS = /\b(corrupt(?:ed|ion)?|garbled?|scrambled|glitch(?:ed|y)?|shuffled|broken (?:image|file|picture)|half[- ]decoded|mis-?placed tiles|tiles? (?:out of place|on black))\b/i;

/** Asset ids the integrity check called corrupted or garbled. */
export function garbledAssetIds(problems: readonly { asset_id: string; why: string }[]): string[] {
  return [...new Set(problems.filter((p) => GARBLED_WORDS.test(p.why)).map((p) => p.asset_id))];
}

export const isGarbledAsset = (a: Pick<Asset, 'flags'>) => a.flags.some((f) => f === 'garbled' || f.startsWith('garbled:'));

const PORTRAIT_KINDS = new Set<Asset['kind']>(['person_photo', 'event_photo', 'archival', 'video_frame']);

/**
 * How good a replacement anchor `a` is for `name`, or null: a verified solo picture of them that isn't
 * garbled or text-heavy. A cutout first (banked or cut), then a photo with a face box, then size; a sketch last.
 */
export function assetAnchorScore(a: Asset, name: string): number | null {
  if (isGarbledAsset(a) || !PORTRAIT_KINDS.has(a.kind) || a.people.length !== 1 || a.people[0] !== name) return null;
  if (a.flags.includes('text_heavy')) return null;
  if (a.made_kind === 'sketch') return 0;
  if (a.made) return null;
  const cutout = a.flags.includes('cutout');
  if (!cutout && !a.flags.includes('identity:verified')) return null;
  if (a.flags.some((f) => /^group_photo:/.test(f))) return null;
  let s = cutout ? 100 : 1;
  if (a.face) s += 2;
  s += Math.min(Math.min(a.width, a.height), 1600) / 800;
  if (a.kind === 'person_photo') s += 1;
  return s;
}

export type AnchorMove = { name: string; from: string; to: string | null };

/**
 * Marks `badIds` garbled and moves each of their anchors to the person's next best portrait (null when
 * none is left: the person then has no anchor and the director shows them with what remains). Returns a
 * new inventory; the input is not changed.
 */
export function reanchor(inventory: VisualsInventory, badIds: readonly string[]): { inventory: VisualsInventory; moved: AnchorMove[] } {
  const bad = new Set(badIds);
  if (!bad.size) return { inventory, moved: [] };
  const assets = inventory.assets.map((a) => (bad.has(a.id) && !isGarbledAsset(a) ? { ...a, flags: [...a.flags, 'garbled'] } : { ...a }));
  const moved: AnchorMove[] = [];
  for (const a of assets) {
    if (!bad.has(a.id) || !a.anchor_for) continue;
    const name = a.anchor_for;
    a.anchor_for = null;
    a.character_image = false;
    a.flags = a.flags.filter((f) => f !== `anchor:${name}`);
    let best: { b: Asset; s: number } | null = null;
    for (const b of assets) {
      if (b === a || bad.has(b.id) || (b.anchor_for && b.anchor_for !== name)) continue;
      const s = assetAnchorScore(b, name);
      if (s !== null && (!best || s > best.s)) best = { b, s };
    }
    if (best) {
      best.b.anchor_for = name;
      best.b.character_image = true;
      if (!best.b.flags.includes(`anchor:${name}`)) best.b.flags = [...best.b.flags, `anchor:${name}`];
    }
    moved.push({ name, from: a.id, to: best?.b.id ?? null });
  }
  return { inventory: { ...inventory, assets }, moved };
}
