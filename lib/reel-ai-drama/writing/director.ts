import { directorSystem } from '@/lib/reel-ai-drama/prompts';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { DirectorPlan, FactSheet, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { runSubmit, section } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_PLAN_TOOL } from '@/lib/reel-ai-drama/writing/schemas';
import { isCharacterImage, isLogo, validatePlan } from '@/lib/reel-ai-drama/writing/validate';
import type { WritingDeps } from '@/lib/reel-ai-drama/writing/writer';

export { pruneCutLines } from '@/lib/reel-ai-drama/writing/validate';
export { TREATMENTS } from '@/lib/reel-ai-drama/writing/schemas';

const DIRECTOR_MAX_TOKENS = 32_000;

/**
 * What the director sees of the inventory: everything that bears on a picture choice, no file internals.
 * `character_image` is a person's banked cutout (cutout_lift and collision only); a logo has its own flag;
 * `parallax` is true only when the harvest cut a parallax layer for the image (v1: none do yet);
 * `anchor_for` names the main character whose recurring anchor image this is (MD-60).
 */
export function inventoryForDirecting(inventory: VisualsInventory) {
  return inventory.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    shows: a.shows,
    people: a.people,
    place: a.place,
    date: a.date_taken,
    date_confidence: a.date_confidence,
    size: `${a.width}x${a.height}`,
    credit: a.credit,
    character_image: isCharacterImage(a),
    logo: isLogo(a),
    made: a.made,
    made_kind: a.made_kind ?? null,
    anchor_for: a.anchor_for ?? null,
    parallax: a.flags.includes('parallax'),
    flags: a.flags,
  }));
}

/** One frame to re-plan in a fix round: an image-check finding, or lines rewritten after the plan was made. */
export type FixProblem = { frame: number; asset_id: string | null; why: string };

/**
 * The fix round's kind: `image_check` (C2's one fix), `script_revised` (the facts check rewrote lines) or
 * `variety` (checks/variety.ts: a person shown the same way too often, a named main character not shown,
 * a staging type repeated back to back; or a make that failed and was replaced).
 */
export type DirectorFix = { plan: DirectorPlan; problems: FixProblem[]; kind?: 'image_check' | 'script_revised' | 'variety' };

function fixSections(fix: DirectorFix): string[] {
  if (fix.kind === 'variety') {
    return [section('Variety fix: your earlier plan', fix.plan), section('Variety problems (re-plan only these frames)', fix.problems)];
  }
  if (fix.kind === 'script_revised') {
    return [section('Script-revision fix: your earlier plan', fix.plan), section('Script-revision fix (re-plan only these frames to the revised lines)', fix.problems)];
  }
  return [section('Image-check fix: your earlier plan', fix.plan), section('Image-check problems (re-plan only these frames)', fix.problems)];
}

/**
 * P5: the director (Opus 5.5) plans the frames from the locked script and what the harvest holds, and
 * may send lines back once (MD-38). The kit guide sits in the cached system prefix with both crafts.
 */
export async function directReel(
  deps: WritingDeps,
  input: {
    draft: WriterDraft;
    inventory: VisualsInventory;
    facts: FactSheet;
    kitGuide: string;
    /** A fix round: the earlier plan and the problems; only the named frames should change. */
    fix?: DirectorFix;
  },
): Promise<DirectorPlan> {
  const settings = deps.settings ?? DEFAULT_SETTINGS;
  const result = await runSubmit(deps.create, deps, {
    component: input.fix ? 'director_fix' : 'director',
    model: settings.director_model,
    system: directorSystem(input.kitGuide, deps.root),
    user: [
      section('Script', input.draft),
      section('Visuals inventory', inventoryForDirecting(input.inventory)),
      section('Fact sheet', input.facts),
      ...(input.fix ? fixSections(input.fix) : []),
    ].join('\n\n'),
    tool: SUBMIT_PLAN_TOOL,
    maxTokens: DIRECTOR_MAX_TOKENS,
    effort: 'high',
    parse: (raw) => validatePlan(raw, { draft: input.draft, inventory: input.inventory }),
  });
  deps.onSpend?.('director', result.usd);
  return result.value;
}
