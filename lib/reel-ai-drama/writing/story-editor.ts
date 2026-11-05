import { storyEditorSystem } from '@/lib/reel-ai-drama/prompts';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { StoryNotes, WriterDraft } from '@/lib/reel-ai-drama/types';
import { runSubmit, section } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_STORY_NOTES_TOOL } from '@/lib/reel-ai-drama/writing/schemas';
import { draftLines, validateStoryNotes } from '@/lib/reel-ai-drama/writing/validate';
import type { WritingDeps } from '@/lib/reel-ai-drama/writing/writer';

const EDITOR_MAX_TOKENS = 16_000;

/** The editor's only input (MD-102): the script, nothing else. */
export type StoryEditInput = { draft: WriterDraft; settings?: ReelAiDramaSettings };

/**
 * The script as the viewer meets it: each line's id, its narration and the words on screen with it (the
 * hook's words show with the first line). No pitch, no facts, no fact ids, no structure.
 */
export function scriptForEditor(draft: WriterDraft): string {
  const lines = draftLines(draft);
  return lines
    .map((l, i) => {
      const shown = [...(i === 0 && draft.hook?.on_screen?.trim() ? [draft.hook.on_screen.trim()] : []), ...(l.on_screen?.trim() ? [l.on_screen.trim()] : [])];
      return [`${l.id}: ${l.text.trim()}`, ...shown.map((w) => `    On screen: ${w}`)].join('\n');
    })
    .join('\n');
}

export function storyEditUserMessage(input: StoryEditInput): string {
  return section('The script', scriptForEditor(input.draft));
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
