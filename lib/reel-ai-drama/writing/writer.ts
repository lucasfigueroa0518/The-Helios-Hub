import { writerSystem } from '@/lib/reel-ai-drama/prompts';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { DirectorPlan, FactSheet, Pitch, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { runSubmit, section, type Effort, type Ledger, type SendMessage } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_REVISION_TOOL, SUBMIT_SCRIPT_TOOL } from '@/lib/reel-ai-drama/writing/schemas';
import { applyRevision, isCharacterImage, isLogo, validateDraft, type Replacement } from '@/lib/reel-ai-drama/writing/validate';

/** Every outside call the writing steps make, injected so tests stub them. */
export type WritingDeps = Ledger & {
  create: SendMessage;
  /** Model ids and length limits; defaults to DEFAULT_SETTINGS. */
  settings?: ReelAiDramaSettings;
  /** Repo root for the prompt files (tests). */
  root?: string;
  /** Called with each step's cost after it is recorded. */
  onSpend?: (component: string, usd: number) => void;
};

const WRITER_MAX_TOKENS = 32_000;
const WRITER_EFFORT: Effort = 'high';

/** What the writer sees of the inventory: what each visual is, never file paths or hashes. */
export function inventoryForWriting(inventory: VisualsInventory) {
  return inventory.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    shows: a.shows,
    people: a.people,
    place: a.place,
    date: a.date_taken,
    character_image: isCharacterImage(a),
    logo: isLogo(a),
    made: a.made,
  }));
}

export function writerUserMessage(input: { pitch: Pitch; facts: FactSheet; inventory: VisualsInventory; settings: ReelAiDramaSettings }): string {
  return [
    section('Length', `Aim for about ${input.settings.target_seconds} seconds; at most about ${input.settings.max_seconds}, only when the story needs it.`),
    section('Pitch', input.pitch),
    section('Fact sheet', input.facts),
    section('Visuals inventory', inventoryForWriting(input.inventory)),
  ].join('\n\n');
}

/** P4: the writer (Opus 5.5) writes the script to the verified facts and the visuals that exist. */
export async function writeScript(
  deps: WritingDeps,
  input: { pitch: Pitch; facts: FactSheet; inventory: VisualsInventory; settings: ReelAiDramaSettings },
): Promise<WriterDraft> {
  const settings = input.settings ?? deps.settings ?? DEFAULT_SETTINGS;
  const result = await runSubmit(deps.create, deps, {
    component: 'writer',
    model: settings.writer_model,
    system: writerSystem('writer', deps.root),
    user: writerUserMessage({ ...input, settings }),
    tool: SUBMIT_SCRIPT_TOOL,
    maxTokens: WRITER_MAX_TOKENS,
    effort: WRITER_EFFORT,
    parse: (raw) => validateDraft(raw, { facts: input.facts, inventory: input.inventory, limits: settings }),
  });
  deps.onSpend?.('writer', result.usd);
  return result.value;
}

/** Notes on lines: the director's lines back, or facts-check findings shaped the same way. */
export type LineNote = DirectorPlan['lines_back'][number];

/**
 * One round of revisions (MD-38; also the facts check's one fix, MD-39). The writer returns only the
 * noted lines; code merges them so every other line, and every line id, stays as the plan knows it.
 */
export async function reviseScript(
  deps: WritingDeps,
  input: { draft: WriterDraft; linesBack: LineNote[]; facts: FactSheet; inventory: VisualsInventory | null },
): Promise<WriterDraft> {
  if (!input.linesBack.length) return input.draft;
  const settings = deps.settings ?? DEFAULT_SETTINGS;
  const notedLineIds = input.linesBack.map((n) => n.line_id);
  const result = await runSubmit(deps.create, deps, {
    component: 'writer_revise',
    model: settings.writer_model,
    system: writerSystem('writer-revise', deps.root),
    user: [
      section('Notes on lines', input.linesBack),
      section('Script', input.draft),
      section('Fact sheet', input.facts),
      ...(input.inventory ? [section('Visuals inventory', inventoryForWriting(input.inventory))] : []),
    ].join('\n\n'),
    tool: SUBMIT_REVISION_TOOL,
    maxTokens: WRITER_MAX_TOKENS,
    effort: WRITER_EFFORT,
    parse: (raw) => {
      const replacements = (raw as { replacements?: Replacement[] })?.replacements;
      if (!Array.isArray(replacements)) return { value: null, problems: ['replacements is missing'] };
      const revised = applyRevision(input.draft, replacements, { notedLineIds, facts: input.facts, inventory: input.inventory, limits: settings });
      // New respellings for the replacement lines join the draft's (an entry for the same word is replaced).
      const added = ((raw as { pronounce?: { word: string; say: string }[] })?.pronounce ?? []).filter((p) => p?.word?.trim() && p?.say?.trim());
      if (revised.value && added.length) {
        const words = new Set(added.map((p) => p.word));
        revised.value = { ...revised.value, pronounce: [...(revised.value.pronounce ?? []).filter((p) => !words.has(p.word)), ...added] };
      }
      return revised;
    },
  });
  deps.onSpend?.('writer_revise', result.usd);
  return result.value;
}
