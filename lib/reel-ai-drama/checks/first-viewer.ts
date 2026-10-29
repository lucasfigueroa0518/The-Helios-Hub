import { readFile } from 'node:fs/promises';

import { noul } from '@typesafe-ai/sdk';

import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { loadPrompt } from '@/lib/reel-ai-drama/prompts';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { FactSheet, WriterDraft } from '@/lib/reel-ai-drama/types';
import { defineQuestionSet } from '@/lib/reels/jev/question-set';
import { runSubmit, type Ledger, type SendMessage } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_VIEWING_TOOL } from '@/lib/reel-ai-drama/writing/schemas';

/**
 * C3, the first-time viewer (MD-39; it also covers the mute read). Sonnet, as a stranger, looks at the
 * contact sheet (stills with burnt-in captions) and the caption transcript and says what it got. The
 * stranger never sees the script or the facts; whether its account matches the story is judged by Jev,
 * loosely. Every finding is a fixable problem string: one fix session, then a warning.
 */

export const FIRST_VIEWER_SET = defineQuestionSet({
  id: 'reel-ai-drama-first-viewer',
  version: 'reel-ai-drama-first-viewer-v1',
  questions: {
    story_match: noul({
      question: "Does the viewer's account of the story match the story the reel meant to tell?",
      judge:
        "Compare viewer_story (a first-time viewer's own words after watching a short documentary) with meant_story. Answer yes when the viewer got the same people, what happened and the outcome, even in plain or partial words; answer no when they missed the outcome, mixed up who did what, or told a different story.",
    }),
  },
});

export const STORY_MATCH_MIN = 0.5;
export const KEEP_WATCHING_MIN = 3;

export type ViewerAnswers = {
  hook_seconds: number | null;
  muted_followed: boolean;
  story_in_my_words: string;
  want_next: string;
  keep_watching: number;
  confused: { at: number | null; what: string }[];
};

export type FirstViewerDeps = Ledger & {
  create: SendMessage;
  jev: DramaJevRunner;
  settings?: ReelAiDramaSettings;
  root?: string;
  /** Reads the contact sheet; defaults to the PNG file at that path. */
  readSheet?: (file: string) => Promise<string>;
};

/** The story the reel meant to tell, for Jev's comparison: the facts' summary plus the turn and landing lines. */
export function meantStory(draft: WriterDraft, facts: FactSheet): string {
  const pick = new Set([draft.turn_rung_id, draft.landing_rung_id]);
  const lines = draft.rungs.filter((r) => pick.has(r.id)).flatMap((r) => r.lines.map((l) => l.text));
  return [facts.summary, ...lines].join(' ');
}

/**
 * Map the stranger's answers (and Jev's match) to the result; exported for tests. `problems` are what the
 * one picture fix can address (the hook's time, the muted read, the story understood); the rest
 * (nothing wanted next, a low keep-watching score, moments of confusion) are `warnings`, flagged only.
 */
export function viewerVerdict(
  answers: ViewerAnswers,
  storyMatch: number | null,
  hookLimit: number,
): { hookSeconds: number | null; understood: boolean; problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const hook = answers.hook_seconds;
  if (hook === null) problems.push('A first-time viewer never worked out what the story was about or what it was asking.');
  else if (hook > hookLimit) problems.push(`A first-time viewer only knew what the story was asking at ${hook}s; the hook must land within ${hookLimit}s.`);
  if (!answers.muted_followed) problems.push('On mute, the pictures and on-screen words alone did not carry the story.');
  const understood = storyMatch !== null && storyMatch >= STORY_MATCH_MIN;
  if (!understood) problems.push(`The viewer told the story as: "${answers.story_in_my_words}" — not the story the reel meant.`);
  if (!answers.want_next?.trim()) warnings.push('The ending left the viewer wanting nothing next; the landing should leave one thread open.');
  if (answers.keep_watching < KEEP_WATCHING_MIN) warnings.push(`The viewer would likely stop watching (${answers.keep_watching} of 5).`);
  for (const c of answers.confused ?? []) if (c.what?.trim()) warnings.push(`${c.at === null ? 'Confusing' : `At ${c.at}s`}: ${c.what.trim()}`);
  return { hookSeconds: hook, understood, problems, warnings };
}

export async function checkFirstViewer(
  deps: FirstViewerDeps,
  input: { contactSheet: string; captions: string; draft: WriterDraft; facts: FactSheet; pitchId?: string | null },
): Promise<{ hookSeconds: number | null; understood: boolean; problems: string[]; warnings: string[] }> {
  const settings = deps.settings ?? DEFAULT_SETTINGS;
  const sheet = deps.readSheet ? await deps.readSheet(input.contactSheet) : (await readFile(input.contactSheet)).toString('base64');
  const result = await runSubmit(deps.create, deps, {
    component: 'first_viewer',
    model: settings.orchestrator_model,
    system: loadPrompt('first-viewer', deps.root),
    user: [
      { type: 'text', text: 'The contact sheet:' },
      { type: 'image', source: { type: 'base64', media_type: /\.jpe?g$/i.test(input.contactSheet) ? 'image/jpeg' : 'image/png', data: sheet } },
      { type: 'text', text: `What the voice said, with times:\n\n${input.captions.trim()}` },
    ],
    tool: SUBMIT_VIEWING_TOOL,
    maxTokens: 6_000,
    effort: 'medium',
    parse: (raw) => ({ value: raw as ViewerAnswers, problems: raw && typeof raw === 'object' ? [] : ['no answers'] }),
  });
  const answers = result.value;
  let storyMatch: number | null = null;
  if (answers.story_in_my_words.trim()) {
    const asked = await deps.jev.ask({
      component: 'first_viewer',
      state: { meant_story: meantStory(input.draft, input.facts), viewer_story: answers.story_in_my_words },
      set: FIRST_VIEWER_SET,
      questions: FIRST_VIEWER_SET.questions,
      pitchId: input.pitchId ?? null,
    });
    const v = (asked.answers as Record<string, { noul?: number }>).story_match?.noul;
    storyMatch = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return viewerVerdict(answers, storyMatch, settings.hook_seconds);
}

