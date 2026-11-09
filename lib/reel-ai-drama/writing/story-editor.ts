import { storyEditorSystem } from '@/lib/reel-ai-drama/prompts';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { FactSheet, StoryNotes, WriterDraft } from '@/lib/reel-ai-drama/types';
import { runSubmit, section } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_STORY_NOTES_TOOL } from '@/lib/reel-ai-drama/writing/schemas';
import { draftLines, knownToViewer, validateStoryNotes } from '@/lib/reel-ai-drama/writing/validate';
import type { WritingDeps } from '@/lib/reel-ai-drama/writing/writer';

const EDITOR_MAX_TOKENS = 16_000;

/** The editor's input (MD-102): the script, and from the cast only which names the viewer already knows (decided at selection). */
export type StoryEditInput = { draft: WriterDraft; settings?: ReelAiDramaSettings; cast?: FactSheet['cast'] };

/**
 * The script as the viewer meets it: each line's id, its narration and the label shown with it. No pitch, no
 * facts, no fact ids, no structure.
 */
export function scriptForEditor(draft: WriterDraft): string {
  const lines = draftLines(draft);
  return lines
    .map((l, i) => [`${l.id}: ${l.text.trim()}`, ...(i > 0 && l.on_screen?.trim() ? [`    On screen: ${l.on_screen.trim()}`] : [])].join('\n'))
    .join('\n');
}

export function storyEditUserMessage(input: StoryEditInput): string {
  const known = (input.cast ?? []).filter(knownToViewer).map((m) => m.name);
  return [section('The script', scriptForEditor(input.draft)), ...(known.length ? [section('Names the viewer already knows', known)] : [])].join('\n\n');
}

/**
 * The blind story editor (Opus 5.5; MD-102): reads the script alone, retells it and sends at most five notes
 * on named lines. It never edits. Notes naming lines the script doesn't have get one correction; after it
 * the unknown ids are dropped (fail open).
 */
export async function editStory(deps: WritingDeps, input: StoryEditInput): Promise<StoryNotes> {
  const settings = input.settings ?? deps.settings ?? DEFAULT_SETTINGS;
  const lineIds = draftLines(input.draft).map((l) => l.id);
  let attempt = 0;
  const result = await runSubmit(deps.create, deps, {
    component: 'story_notes',
    model: settings.story_editor_model,
    system: storyEditorSystem(deps.root),
    user: storyEditUserMessage(input),
    tool: SUBMIT_STORY_NOTES_TOOL,
    maxTokens: EDITOR_MAX_TOKENS,
    effort: 'high',
    fixes: 1,
    parse: (raw) => {
      attempt += 1;
      const strict = validateStoryNotes(raw, { lineIds });
      if (attempt > 1 && strict.value?.tell_back) return validateStoryNotes(raw, { lineIds, lenient: true });
      return strict;
    },
  });
  deps.onSpend?.('story_notes', result.usd);
  return result.value;
}
