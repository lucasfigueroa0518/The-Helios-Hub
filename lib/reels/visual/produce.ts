import type Anthropic from '@anthropic-ai/sdk';

import { assembleImagePrompt } from '@/lib/reels/visual/blocks';
import type { ColorProfile } from '@/lib/reels/visual/color';
import type { BackgroundQa, RenderedText } from '@/lib/reels/visual/engine';
import type { ImageUsage } from '@/lib/reels/visual/image';
import type { SceneWriteResult } from '@/lib/reels/visual/scene-writer';
import type { VisualCategory } from '@/lib/reels/visual/scene';

export type ProduceStatus = 'ok' | 'failed' | 'rejected_background' | 'copy_does_not_fit';

/** Grade-neutral scene used when the scene writer returns nothing. */
export const FALLBACK_SCENE =
  'A single piece of minimal hardware rests in the lower part of the frame and carries the one accent. The rest of the room is quiet and empty around it, with nothing in the middle.';

export type ProduceFrameResult = {
  status: ProduceStatus;
  scene: string | null;
  imagePrompt: string | null;
  message: Anthropic.Message | null;
  imageUsage: ImageUsage | null;
  background: Buffer | null;
  frame: Buffer | null;
  qa: BackgroundQa | null;
  lines: string[];
  warnings: string[];
  details: unknown;
  error: string | null;
};

export type ProduceDeps = {
  writeScene: (input: {
    story: string;
    category: VisualCategory;
    onScreenText: string;
    recentScenes: string[];
    profile?: ColorProfile;
  }) => Promise<SceneWriteResult>;
  generateBackground: (prompt: string) => Promise<{ png: Buffer; usage: ImageUsage }>;
  checkBackground: (png: Buffer) => Promise<BackgroundQa>;
  renderText: (
    png: Buffer,
    copy: string,
  ) => Promise<{ ok: true; rendered: RenderedText } | { ok: false; error: string; details: unknown }>;
};

/**
 * Scene → prompt → background → dark-band check → text. Fails open: a failed
 * band check or copy that does not fit becomes a warning, not a stop. The text engine puts the whole on-screen copy on that
 * one still. A reel is one screen.
 */
export async function produceFrame(
  input: {
    story: string;
    category: VisualCategory;
    onScreenText: string;
    recentScenes: string[];
    profile?: ColorProfile;
  },
  deps: ProduceDeps,
): Promise<ProduceFrameResult> {
  const base: ProduceFrameResult = {
    status: 'failed',
    scene: null,
    imagePrompt: null,
    message: null,
    imageUsage: null,
    background: null,
    frame: null,
    qa: null,
    lines: [],
    warnings: [],
    details: null,
    error: null,
  };

  const notices: string[] = [];
  let written: SceneWriteResult;
  try {
    written = await deps.writeScene(input);
  } catch (error) {
    written = { scene: null, message: null, error: error instanceof Error ? error.message : String(error) };
  }
  base.message = written.message;
  if (!written.scene) {
    notices.push(`Scene writer failed (${written.error ?? 'no scene'}); used the fallback scene.`);
  }
  base.scene = written.scene ?? FALLBACK_SCENE;

  let imagePrompt: string;
  try {
    imagePrompt = assembleImagePrompt(base.scene, input.profile ?? 'noir');
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
  base.imagePrompt = imagePrompt;

  let generated: { png: Buffer; usage: ImageUsage };
  try {
    generated = await deps.generateBackground(imagePrompt);
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
  base.background = generated.png;
  base.imageUsage = generated.usage;

  // Fail open: a background that misses the band check still becomes the
  // reel. The check's reasons ride along as warnings.
  const warnings: string[] = [...notices];
  let qa: BackgroundQa | null = null;
  try {
    qa = await deps.checkBackground(generated.png);
  } catch (error) {
    warnings.push(`Background check did not run: ${error instanceof Error ? error.message : String(error)}`);
  }
  base.qa = qa;
  if (qa && !qa.pass) {
    warnings.push(`Background check: ${qa.reasons.join('; ') || 'failed the band check'}. Kept anyway.`);
  }

  let rendered: Awaited<ReturnType<ProduceDeps['renderText']>> | null = null;
  try {
    rendered = await deps.renderText(generated.png, input.onScreenText);
  } catch (error) {
    warnings.push(`Text did not render on the still: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!rendered?.ok) {
    if (rendered) warnings.push(`Copy did not fit the still (${rendered.error}). The video plate sets the text on its own.`);
    return {
      ...base,
      status: 'ok',
      frame: generated.png,
      warnings,
      details: rendered && !rendered.ok ? rendered.details : null,
      error: null,
    };
  }

  return {
    ...base,
    status: 'ok',
    frame: rendered.rendered.png,
    lines: rendered.rendered.lines,
    warnings: [...warnings, ...rendered.rendered.warnings],
    error: null,
  };
}
