import { loadPrompt } from '@/lib/reel-ai-drama/prompts';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { FactSheet, PostText, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { runSubmit, section } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_CAPTION_TOOL } from '@/lib/reel-ai-drama/writing/schemas';
import { draftLines } from '@/lib/reel-ai-drama/writing/validate';
import type { WritingDeps } from '@/lib/reel-ai-drama/writing/writer';

/** Instagram's caption limit, less room for the question and credits appended after it. */
export const CAPTION_MAX_CHARS = 1600;
export const MAX_HASHTAGS = 3;

/**
 * Sonnet 5.5 writes the post text (MD-49, MD-50). There is no post-text model setting; the orchestrator
 * model is the configured Sonnet.
 */
export function postModel(settings: ReelAiDramaSettings): string {
  return settings.orchestrator_model;
}

/** Photo credits, built by code from the inventory (never written by a model): one per distinct credit, in use order. */
export function creditsFor(inventory: VisualsInventory, usedAssetIds: string[]): string[] {
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const out: string[] = [];
  for (const id of usedAssetIds) {
    const credit = byId.get(id)?.credit?.trim();
    if (credit && !out.includes(credit)) out.push(credit);
  }
  return out;
}

export function validateCaption(raw: unknown): { value: string | null; problems: string[] } {
  const caption = typeof (raw as { caption?: unknown })?.caption === 'string' ? (raw as { caption: string }).caption.trim() : '';
  const problems: string[] = [];
  if (!caption) problems.push('the caption is empty');
  if (caption.length > CAPTION_MAX_CHARS) problems.push(`the caption runs ${caption.length} characters; keep it under ${CAPTION_MAX_CHARS}`);
  const tags = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (tags.length > MAX_HASHTAGS) problems.push(`the caption has ${tags.length} hashtags; at most ${MAX_HASHTAGS}`);
  return { value: caption || null, problems };
}

/**
 * P9 post text: the model writes the caption; code adds the credits and the comment question, which
 * is the question spoken over the close, so the viewer hears and reads the same one.
 */
export async function writePost(
  deps: WritingDeps,
  input: { draft: WriterDraft; facts: FactSheet; inventory: VisualsInventory; usedAssetIds: string[] },
): Promise<PostText> {
  const settings = deps.settings ?? DEFAULT_SETTINGS;
  const script = draftLines(input.draft).map((l) => ({ id: l.id, text: l.text, on_screen: l.on_screen }));
  const result = await runSubmit(deps.create, deps, {
    component: 'post_text',
    model: postModel(settings),
    system: loadPrompt('post-text', deps.root),
    user: [section('Title', input.draft.title), section('Script', script), section('Fact sheet', input.facts)].join('\n\n'),
    tool: SUBMIT_CAPTION_TOOL,
    maxTokens: 4_000,
    effort: 'medium',
    parse: validateCaption,
  });
  deps.onSpend?.('post_text', result.usd);
  return { caption: result.value, credits: creditsFor(input.inventory, input.usedAssetIds), question: input.draft.close_question };
}
