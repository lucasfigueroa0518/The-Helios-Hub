import { ephemeralCache } from '@/lib/anthropic-cache';
import { cutSource, isRejectedCut } from '@/lib/reel-ai-drama/harvest/cutouts';
import { directorSystem } from '@/lib/reel-ai-drama/prompts';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import { stagingOf } from '@/lib/reel-ai-drama/checks/variety';
import { hookOptions, identityUnconfirmed, resolveHook } from '@/lib/reel-ai-drama/hooks/eligibility';
import { peakRungId, type DirectorPlan, type FactSheet, type HookChoice, type ShotWish, type SourceRef, type StoryboardFrame, type VisualsInventory, type WriterDraft } from '@/lib/reel-ai-drama/types';
import { runSubmit, section } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_PLAN_TOOL } from '@/lib/reel-ai-drama/writing/schemas';
import { isCharacterImage, isLogo, salvagePlan, validateFixedPlan, validatePlan } from '@/lib/reel-ai-drama/writing/validate';
import type { WritingDeps } from '@/lib/reel-ai-drama/writing/writer';

export { pruneCutLines } from '@/lib/reel-ai-drama/writing/validate';
export { TREATMENTS } from '@/lib/reel-ai-drama/writing/schemas';

// A plan with makes and who each frame shows ran past 32k with high effort (live run, 2026-10-30).
const DIRECTOR_MAX_TOKENS = 64_000;

/**
 * What the director sees of the inventory: everything that bears on a picture choice, no file internals.
 * `character_image` is a person's banked cutout (cutout_lift and collision only); a logo has its own flag;
 * `parallax` is true only when the harvest cut a parallax layer for the image (v1: none do yet);
 * `anchor_for` names the main character whose recurring anchor image this is (MD-60).
 * What harvest measured, where it did (iteration 10): `cut` how clean a cutout is, `dup_of` the picture this one repeats,
 * `brightness` and `expression` to choose by feeling, `sharp_width_px` the widest it stays sharp, `open_edges` the sides a
 * cutout stops at, `trusted_faces` how many faces may be heads. A rejected cut isn't offered as a cutout: it is left out when its
 * photo is in the inventory, else offered as a print. The `shape` and `tone` grids are never sent.
 * A picture whose identity is unconfirmed names nobody here (no `people`, no `anchor_for`, `identity_unconfirmed: true`), so it can't
 * stand for a named person; `shows` stays, so it can still be used for what it visibly is.
 */
export function inventoryForDirecting(inventory: VisualsInventory) {
  return inventory.assets.filter((a) => !(isRejectedCut(a) && cutSource(inventory, a))).map((a) => {
    const r = a.regions;
    const rejected = isRejectedCut(a);
    const unconfirmed = identityUnconfirmed(a);
    return {
      id: a.id,
      kind: a.kind,
      shows: a.shows,
      people: unconfirmed ? [] : a.people,
      ...(unconfirmed ? { identity_unconfirmed: true } : {}),
      place: a.place,
      date: a.date_taken,
      date_confidence: a.date_confidence,
      size: `${a.width}x${a.height}`,
      credit: a.credit,
      character_image: !rejected && isCharacterImage(a),
      logo: isLogo(a),
      made: a.made,
      made_kind: a.made_kind ?? null,
      anchor_for: rejected || unconfirmed ? null : a.anchor_for ?? null,
      parallax: a.flags.includes('parallax'),
      flags: rejected ? a.flags.filter((f) => f !== 'cutout') : a.flags,
      ...(rejected ? { print_only: true } : {}),
      ...(r?.cut && !rejected ? { cut: r.cut.grade } : {}),
      ...(r?.dup_of ? { dup_of: r.dup_of } : {}),
      ...(typeof r?.brightness === 'number' ? { brightness: Math.round(r.brightness * 100) / 100 } : {}),
      ...(r?.expression ? { expression: r.expression } : {}),
      ...(typeof r?.sharp_width_px === 'number' ? { sharp_width_px: r.sharp_width_px } : {}),
      ...(r?.open_edges ? { open_edges: r.open_edges } : {}),
      ...(r?.faces ? { trusted_faces: r.faces.filter((f) => f.trusted).length } : {}),
    };
  });
}

/**
 * The locked script as the director reads it: the WriterDraft fields only. A draft saved before iteration 5
 * may carry fields the writer no longer writes; those are left out (its hook's old on-screen words among them), and its old turn
 * rung is read as the peak.
 */
export function scriptForDirecting(draft: WriterDraft): WriterDraft {
  return {
    title: draft.title,
    hook: { line_id: draft.hook.line_id },
    rungs: draft.rungs.map(({ id, purpose, lines }) => ({ id, purpose, lines })),
    peak_rung_id: peakRungId(draft),
    landing_rung_id: draft.landing_rung_id,
    close_question: draft.close_question,
    word_count: draft.word_count,
    ...(draft.pronounce ? { pronounce: draft.pronounce } : {}),
    central: draft.central ?? [],
  };
}

/** One frame to re-plan in a fix round: a finding from a check or a viewer, or lines rewritten after the plan was made. */
export type FixProblem = { frame: number; asset_id: string | null; why: string };

/**
 * The fix round's kind: `pre_build` (the plan checks and the image check, together, before anything is built), `script_revised` (the
 * facts check rewrote lines) or `content_pass` (what was seen on the rendered frames: `nothing_missing` and `one_medium`).
 * `plan_check`, `variety` and `image_check` are the old names of `pre_build`, and `picture_review` of `content_pass`.
 * `escalate` runs the round on `director_fix_escalation_model`, for a problem the re-check still finds after a first fix.
 */
export type DirectorFix = {
  plan: DirectorPlan;
  problems: FixProblem[];
  kind?: 'pre_build' | 'content_pass' | 'script_revised' | 'image_check' | 'plan_check' | 'variety' | 'picture_review';
  escalate?: boolean;
};

/** A fix's room: it writes the named frames, not the plan. A turn cut off gets one try with twice this (`runSubmit`). */
const DIRECTOR_FIX_MAX_TOKENS = 24_000;

/** One frame in one line: what a fix needs of the frames it leaves alone to keep its own choices consistent with them. */
function frameLine(f: StoryboardFrame): string {
  const lines = f.line_ids?.length ? f.line_ids.join(', ') : 'no lines';
  const focus = f.focus ? `${f.focus.kind}: ${f.focus.what}` : 'none';
  const shows = (f.shows ?? []).map((s) => `${s.person} as ${s.asset_id}`).join('; ') || 'nobody';
  return `Frame ${f.n}, ${f.name}: ${f.treatment} (${stagingOf(f) ?? 'close'}), ${lines}; focus ${focus}; shows ${shows}; assets ${(f.asset_ids ?? []).join(', ') || 'none'}; music ${f.music}`;
}

/** The fix block, sent after the cached shared input: the named frames whole, their findings, and the rest of the plan in a line each. */
function fixSections(fix: DirectorFix): string[] {
  const named = new Set(fix.problems.map((p) => p.frame));
  const [frames, findings] = FIX_TITLES[fix.kind ?? 'image_check'];
  const others = fix.plan.frames.filter((f) => !named.has(f.n));
  const makes = (fix.plan.makes ?? []).map((m) => `${m.id} (${m.kind}): ${m.brief}`);
  const wishes = (fix.plan.wishes ?? []).map((w) => `${w.id}: ${w.want}`);
  return [
    section(frames, fix.plan.frames.filter((f) => named.has(f.n))),
    section(findings, fix.problems),
    ...(others.length ? [section('The other frames, which stay as they are', others.map(frameLine))] : []),
    ...(makes.length || wishes.length ? [section('Makes and wishes the plan already has', [...makes, ...wishes])] : []),
    ...(named.has(1) ? [section('The hook the plan has', fix.plan.hook ?? 'none')] : []),
  ];
}

const PRE_BUILD: readonly [string, string] = ['Pre-build fix: the frames to re-plan', 'Pre-build problems (re-plan only these frames)'];
const CONTENT_PASS: readonly [string, string] = ['Content-pass fix: the frames to re-plan', 'Content-pass findings (re-plan only these frames)'];
const FIX_TITLES: Record<NonNullable<DirectorFix['kind']>, readonly [string, string]> = {
  pre_build: PRE_BUILD,
  content_pass: CONTENT_PASS,
  script_revised: ['Script-revision fix: the frames to re-plan', 'Script-revision fix (re-plan only these frames to the revised lines)'],
  plan_check: ['Plan-check fix: the frames to re-plan', 'Plan-check problems (re-plan only these frames)'],
  variety: ['Plan-check fix: the frames to re-plan', 'Plan-check problems (re-plan only these frames)'],
  image_check: ['Image-check fix: the frames to re-plan', 'Image-check problems (re-plan only these frames)'],
  picture_review: ['Picture-review fix: the frames to re-plan', 'Picture-review findings (re-plan only these frames)'],
};

/** A fix returns only what is new: the wishes the plan already holds stay available to its frames, a same-id answer taking their place. */
function withHeldWishes(raw: unknown, fix: DirectorFix): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const given = (raw as { wishes?: unknown }).wishes;
  const fresh = Array.isArray(given) ? (given as ShotWish[]) : [];
  return { ...raw, wishes: [...(fix.plan.wishes ?? []).filter((w) => !fresh.some((g) => g?.id === w.id)), ...fresh] };
}

/** The fact sheet's sources, as the hooks read them: a real headline only ever comes from one of these titles. */
export const hookSources = (facts: FactSheet): SourceRef[] => (facts.sources ?? []).map(({ url, title, publisher, date }) => ({ url, title, publisher, date }));

/** The opening line's words: what a hook's cues must land on. */
const openingWords = (draft: WriterDraft): string => draft.rungs.flatMap((r) => r.lines).find((l) => l.id === draft.hook.line_id)?.text ?? '';

/** The opening is the line and the picture: no words of its own, whichever way a saved draft or a stray field asks for them. */
function withoutHookWords(plan: DirectorPlan): DirectorPlan {
  return {
    ...plan,
    frames: plan.frames.map((f) => {
      const { hook: _words, ...blueprint } = f.blueprint ?? ({} as NonNullable<StoryboardFrame['blueprint']>);
      return { ...f, ...(f.n === 1 ? { on_screen: null } : {}), ...(f.blueprint ? { blueprint: blueprint as NonNullable<StoryboardFrame['blueprint']> } : {}) };
    }),
  };
}

/** Frame 1 holds the hook's look until it ends, so it carries the opening line alone. Asked to fix once; a plan that stays this way still ships. */
function openingLineSoft(plan: DirectorPlan | null, draft: WriterDraft): string[] {
  const first = plan?.frames?.[0];
  return first && first.line_ids.some((id) => id !== draft.hook.line_id) ? [`frame 1 carries ${first.line_ids.join(', ')}; it must carry the opening line (${draft.hook.line_id}) alone`] : [];
}

const rawHook = (raw: unknown): HookChoice | null | undefined => (typeof raw === 'object' && raw !== null ? (raw as { hook?: HookChoice | null }).hook : undefined);

/**
 * P5: the director (Opus 5.5) plans the frames from the locked script and what the harvest holds, and
 * may send lines back once (MD-38). The kit guide sits in the cached system prefix with both crafts.
 * A fix round runs at medium effort on its own model, sends the named frames and gets only those back; the tool, system and shared
 * input stay byte for byte the first plan's, because any change there would re-write the cache for all of them. It returns the whole plan.
 * The hook options sit in the shared input. Whatever comes back as `hook` passes through `resolveHook`, so a bad choice can't get through;
 * a fix keeps the plan's hook unless it names frame 1 and answers with a new one. The sources come from the fact sheet.
 */
export async function directReel(
  deps: WritingDeps,
  input: {
    draft: WriterDraft;
    inventory: VisualsInventory;
    facts: FactSheet;
    kitGuide: string;
    /** A fix round: the earlier plan and the problems; only the named frames change. */
    fix?: DirectorFix;
  },
): Promise<DirectorPlan> {
  const settings = deps.settings ?? DEFAULT_SETTINGS;
  const sources = hookSources(input.facts);
  const options = hookOptions(input.inventory, sources);
  let proposed: HookChoice | null | undefined;
  const heard = (raw: unknown) => {
    const answered = rawHook(raw);
    proposed = !input.fix ? answered : (input.fix.problems.some((p) => p.frame === 1) && answered) || input.fix.plan.hook;
  };
  const result = await runSubmit(deps.create, deps, {
    component: input.fix ? 'director_fix' : 'director',
    model: input.fix ? (input.fix.escalate ? settings.director_fix_escalation_model : settings.director_fix_model) : settings.director_model,
    system: directorSystem(input.kitGuide, deps.root),
    // Shots first (MD-68): the script and the facts, then what the harvest holds.
    // The shared input is its own cached block: most plans get a fix round, which re-sends it with the fix after it.
    user: [
      {
        type: 'text',
        text: [
          section('Script', scriptForDirecting(input.draft)),
          section('Fact sheet', input.facts),
          section('Visuals inventory', inventoryForDirecting(input.inventory)),
          section('Hook options', options),
        ].join('\n\n'),
        cache_control: ephemeralCache('1h'),
      },
      ...(input.fix ? [{ type: 'text' as const, text: fixSections(input.fix).join('\n\n') }] : []),
    ],
    tool: SUBMIT_PLAN_TOOL,
    maxTokens: input.fix ? DIRECTOR_FIX_MAX_TOKENS : DIRECTOR_MAX_TOKENS,
    effort: input.fix ? 'medium' : 'high',
    // A fix answers for its named frames; everything else stays as the run holds it (cutouts, wishes found, made assets).
    parse: (raw) => {
      heard(raw);
      if (input.fix) return validateFixedPlan(withHeldWishes(raw, input.fix), input.fix, { draft: input.draft, inventory: input.inventory });
      const parsed = validatePlan(raw, { draft: input.draft, inventory: input.inventory });
      return { ...parsed, soft: [...parsed.soft, ...openingLineSoft(parsed.value, input.draft)] };
    },
    // Never block a reel: a first plan still invalid after its fix round ships repaired, flagged. A failed fix keeps the frames it had.
    ...(input.fix
      ? {}
      : {
          salvage: (raw: unknown, problems: readonly string[]) => {
            heard(raw);
            return salvagePlan(raw, problems, { draft: input.draft, inventory: input.inventory });
          },
        }),
  });
  deps.onSpend?.('director', result.usd);
  // A fix that keeps the plan's hook keeps it as resolved (or absent, on a plan from before hooks); only a new one is resolved.
  const kept = input.fix && proposed === input.fix.plan.hook;
  const hook = kept ? input.fix!.plan.hook : resolveHook(proposed, options, { inventory: input.inventory, sources, words: openingWords(input.draft) });
  return { ...withoutHookWords(result.value), ...(hook !== undefined ? { hook } : {}) };
}
