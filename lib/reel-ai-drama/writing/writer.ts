import { writerSystem } from '@/lib/reel-ai-drama/prompts';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import { pitchBrief, type DirectorPlan, type FactSheet, type Pitch, type StoryNotes, type VisualsInventory, type WriterDraft } from '@/lib/reel-ai-drama/types';
import { runSubmit, section, type Effort, type Ledger, type SendMessage } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_REVISION_TOOL, SUBMIT_SCRIPT_TOOL } from '@/lib/reel-ai-drama/writing/schemas';
import { factTimeline } from '@/lib/reel-ai-drama/writing/timeline';
import { applyRevision, isCharacterImage, isLogo, knownToViewer, maxWords, targetWords, validateDraft, type Replacement, type RevisionExtras } from '@/lib/reel-ai-drama/writing/validate';

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

/** The length section the writer reads: seconds and the word budget at the delivered pace (MD-91, MD-103). */
export function lengthNote(settings: ReelAiDramaSettings): string {
  return (
    `Aim for about ${settings.target_seconds} seconds: about ${targetWords(settings)} spoken words at ${settings.words_per_minute_target} words a minute. ` +
    `At most about ${settings.max_seconds} seconds (about ${maxWords(settings)} words), only when the story needs it.`
  );
}

/** Who needs no introduction and who the viewer would have to learn (must 6). Read from the cast: selection decided it. */
export function namesForWriting(cast: FactSheet['cast'] | null | undefined): { known: string[]; new: string[] } {
  const all = cast ?? [];
  return { known: all.filter(knownToViewer).map((m) => m.name), new: all.filter((m) => !knownToViewer(m)).map((m) => m.name) };
}

/** The writer's input (MD-100): the pitch's brief, the facts as a dated timeline, the names, the inventory, the length. */
export type WriterInput = { pitch: Pitch; facts: FactSheet; inventory: VisualsInventory; settings: ReelAiDramaSettings };

/** Section names writer.md reads: "The brief", "The facts", "The names", "The visual inventory", "The length". */
export function writerUserMessage(input: WriterInput): string {
  return [
    section('The brief', pitchBrief(input.pitch) || input.pitch.title),
    section('The facts', factTimeline(input.facts)),
    section('The names', namesForWriting(input.facts.cast)),
    section('The visual inventory', inventoryForWriting(input.inventory)),
    section('The length', lengthNote(input.settings)),
  ].join('\n\n');
}

/** P4: the writer (Opus 5.5) owns the whole story (MD-100): the script from the brief, the facts and the visuals that exist. */
export async function writeScript(deps: WritingDeps, input: WriterInput): Promise<WriterDraft> {
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

/** Who a revision note comes from (writer-revise.md names the three). */
export type NoteSource = 'Story editor' | 'Director' | 'Facts check';

/** One note for the writer's revision: its source, the lines it names, why, and an optional suggestion. */
export type RevisionNote = { source: NoteSource; lines: string[]; note: string; suggestion?: string };

/** The director's lines back as revision notes. */
export function directorNotes(linesBack: DirectorPlan['lines_back']): RevisionNote[] {
  return linesBack.map((n) => ({ source: 'Director', lines: [n.line_id], note: n.why, ...(n.suggestion?.trim() ? { suggestion: n.suggestion } : {}) }));
}

/** The blind story editor's notes as revision notes (notes that name no line can't be acted on and are left out). */
export function storyEditorNotes(notes: StoryNotes['notes']): RevisionNote[] {
  return notes.filter((n) => n.lines.length).map((n) => ({ source: 'Story editor', lines: n.lines, note: n.note }));
}

/** The notes section: one plain entry per note, its source first. */
export function notesText(notes: RevisionNote[]): string {
  return notes
    .map((n) => `- ${n.source} — ${n.lines.join(', ')}: ${n.note.trim()}${n.suggestion?.trim() ? `\n  Suggestion: ${n.suggestion.trim()}` : ''}`)
    .join('\n');
}

/** Section names writer-revise.md reads: "The notes", "The script", "The facts", "The names", "The visual inventory". */
export function reviseUserMessage(input: { draft: WriterDraft; notes: RevisionNote[]; facts: FactSheet; inventory: VisualsInventory | null }): string {
  const { word_count: _words, ...script } = input.draft;
  void _words;
  const hook = { line_id: input.draft.hook.line_id };
  return [
    section('The notes', notesText(input.notes)),
    section('The script', { ...script, hook }),
    section('The facts', factTimeline(input.facts)),
    section('The names', namesForWriting(input.facts.cast)),
    ...(input.inventory ? [section('The visual inventory', inventoryForWriting(input.inventory))] : []),
  ].join('\n\n');
}

/**
 * One round of revisions (MD-38, MD-39, MD-102): the story editor's notes, the director's lines back, or the
 * facts check's findings. The writer returns only the noted lines; code merges them so every other line, and
 * every line id, stays as the plan knows it.
 */
export async function reviseScript(
  deps: WritingDeps,
  input: { draft: WriterDraft; notes: RevisionNote[]; facts: FactSheet; inventory: VisualsInventory | null },
): Promise<WriterDraft> {
  const notes = input.notes.filter((n) => n.lines.length);
  if (!notes.length) return input.draft;
  const settings = deps.settings ?? DEFAULT_SETTINGS;
  const notedLineIds = [...new Set(notes.flatMap((n) => n.lines))];
  const result = await runSubmit(deps.create, deps, {
    component: 'writer_revise',
    model: settings.writer_model,
    system: writerSystem('writer-revise', deps.root),
    user: reviseUserMessage({ ...input, notes }),
    tool: SUBMIT_REVISION_TOOL,
    maxTokens: WRITER_MAX_TOKENS,
    effort: WRITER_EFFORT,
    parse: (raw) => {
      const replacements = (raw as { replacements?: Replacement[] })?.replacements;
      if (!Array.isArray(replacements)) return { value: null, problems: ['replacements is missing'] };
      const revised = applyRevision(input.draft, replacements, { notedLineIds, facts: input.facts, inventory: input.inventory, limits: settings }, raw as RevisionExtras);
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
