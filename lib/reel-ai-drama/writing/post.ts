import { loadPrompt } from '@/lib/reel-ai-drama/prompts';
import { HELIOS_NAME } from '@/lib/social/captions/helios-context';
import { readHeliosVoice } from '@/lib/social/voice/voice';
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

/** One plain hashtag: `#` then letters, digits or underscores. */
const HASHTAG = /^#[\p{L}\p{N}_]+$/u;

export function validateCaption(raw: unknown): { value: { caption: string; hashtags: string[] } | null; problems: string[] } {
  const r = (raw ?? {}) as { caption?: unknown; hashtags?: unknown };
  const caption = typeof r.caption === 'string' ? r.caption.trim() : '';
  const hashtags = (Array.isArray(r.hashtags) ? r.hashtags : [])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().replace(/^#?/, '#'))
    .filter((t) => t !== '#');
  const problems: string[] = [];
  if (!caption) problems.push('the caption is empty');
  if (caption.length > CAPTION_MAX_CHARS) problems.push(`the caption runs ${caption.length} characters; keep it under ${CAPTION_MAX_CHARS}`);
  if (/#[\p{L}\p{N}_]/u.test(caption)) problems.push('the caption has a hashtag; hashtags go in `hashtags` only');
  if (/\?\s*$/.test(caption)) problems.push('the caption ends on a question; code adds the comment question');
  if (HELIOS_NAME.test(caption)) problems.push('the caption names Helios; code adds the Helios line');
  if (caption.includes('\u2014')) problems.push('the caption has an em dash');
  if (hashtags.length === 0 || hashtags.length > MAX_HASHTAGS) problems.push(`give one to ${MAX_HASHTAGS} hashtags; you gave ${hashtags.length}`);
  const bad = hashtags.find((t) => !HASHTAG.test(t));
  if (bad) problems.push(`"${bad}" is not a plain hashtag`);
  return { value: caption ? { caption, hashtags } : null, problems };
}

/**
 * P9 post text: the model writes the caption and its hashtags in the shared Helios voice; code adds the
 * comment question (the one spoken over the close, so the viewer hears and reads the same one), the
 * Helios line and the credits (publish.ts composeDramaCaption).
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
    system: `${readHeliosVoice(deps.root)}\n\n# This caption\n\n${loadPrompt('post-text', deps.root)}`,
    user: [section('Title', input.draft.title), section('Script', script), section('Fact sheet', input.facts)].join('\n\n'),
    tool: SUBMIT_CAPTION_TOOL,
    maxTokens: 4_000,
    effort: 'medium',
    parse: validateCaption,
  });
  deps.onSpend?.('post_text', result.usd);
  return { caption: result.value.caption, hashtags: result.value.hashtags, credits: creditsFor(input.inventory, input.usedAssetIds), question: input.draft.close_question };
}
