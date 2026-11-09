import { centralPersons, hasCutoutOf } from '@/lib/reel-ai-drama/harvest/cutouts';
import type { CastMember, JobFlag, VisualsInventory } from '@/lib/reel-ai-drama/types';

/**
 * The no-op detector (MD-81). Every step fails open (MD-65), so a step can quietly do nothing and the reel
 * still ships (v2's sound designer did). Before delivery, each such step gets one loud flag, in plain words.
 * Pure: run.ts collects what happened and passes it here.
 */

export type RunTrace = {
  /** Why the blind story editor's read didn't happen (it threw), or null. */
  editorFailed: string | null;
  /** Why the writer's rewrite on the editor's notes didn't happen (it threw), or null. */
  rewriteFailed: string | null;
  /** The first plan's wishes, and why none was searched (null: they were searched, or there were none). */
  wishes: { planned: number; notSearched: string | null };
  /** Cues the sound designer wrote; null when no sound designer ran. */
  soundCues: number | null;
};

export const emptyTrace = (): RunTrace => ({ editorFailed: null, rewriteFailed: null, wishes: { planned: 0, notSearched: null }, soundCues: null });

/** The writer's central people (kind person) the inventory has no usable cutout of. */
export function centralWithoutCutout(central: readonly string[], cast: readonly Pick<CastMember, 'name' | 'kind'>[], inventory: VisualsInventory): string[] {
  return centralPersons(central, cast, inventory).filter((name) => !hasCutoutOf(inventory, name));
}

export function noOpFlags(trace: RunTrace, ctx: { central: readonly string[]; cast: readonly Pick<CastMember, 'name' | 'kind'>[]; inventory: VisualsInventory }): Pick<JobFlag, 'check' | 'detail'>[] {
  const out: Pick<JobFlag, 'check' | 'detail'>[] = [];
  if (trace.editorFailed !== null) {
    out.push({ check: 'story', detail: `NO-OP: the story editor never read the script (${trace.editorFailed}). The writer's draft went out unread.` });
  } else if (trace.rewriteFailed !== null) {
    out.push({ check: 'story', detail: `NO-OP: the writer's rewrite on the story editor's notes failed (${trace.rewriteFailed}). The first draft went out with the notes unanswered.` });
  }
  if (trace.wishes.planned > 0 && trace.wishes.notSearched !== null) {
    out.push({
      check: 'render',
      detail: `NO-OP: the director wished for ${trace.wishes.planned} shot(s) but none was searched (${trace.wishes.notSearched}). Every wished shot used its stand-in.`,
    });
  }
  if (trace.soundCues === 0) {
    out.push({ check: 'render', detail: 'NO-OP: the sound designer wrote no cues. The reel has no planned music changes, stingers or ambience.' });
  }
  for (const name of centralWithoutCutout(ctx.central, ctx.cast, ctx.inventory)) {
    out.push({ check: 'render', detail: `NO-OP: no cutout of ${name}, who is central to the story. Frames that lift people out can only show them as a boxed photo.` });
  }
  return out;
}
