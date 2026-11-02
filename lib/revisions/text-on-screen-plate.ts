/**
 * Text on screen wording-only re-render (Targeted Revisions): lay a new text plate over a stored
 * clean clip (the Kling clip before any text) with ffmpeg and the local text engine only. No image
 * or video model is called. The same steps the video stage composes (lib/reels/visual/video-run.ts
 * compose + attachHookSfx): plate at the clip's size, the stored hook stamped with its stored timing,
 * then that hook's sound. Unlike the pipeline, nothing fails open here: a person asked for these
 * words, so a reel without them (or without its hook or sound) is an error, never a quiet downgrade.
 */
import path from 'node:path';

import type { ColorProfile } from '@/lib/reels/visual/color';
import type { ClipShape, Hook, HookTiming } from '@/lib/reels/visual/hook';

export type PlateDeps = {
  /** ffprobe: the clip's size and frame rate (overlay.ts probeVideo). */
  probeVideo: (videoPath: string) => Promise<ClipShape>;
  /** The text engine's transparent plate at the clip's size (engine.ts renderTextPlate). */
  renderTextPlate: (
    copy: string,
    width: number,
    height: number,
    profile?: ColorProfile,
    fullStoryCue?: string | null,
  ) => Promise<{ png: Buffer; lines: string[]; warnings: string[] }>;
  /** ffmpeg: hook stamp, then the plate (overlay.ts overlayPlate). */
  overlayPlate: (videoPath: string, platePath: string, outPath: string, hook: { hook: Hook; clip: ClipShape; timing: HookTiming }) => Promise<void>;
  /** ffmpeg: the plate alone, for a reel that had no hook stamped (overlay.ts overlayStillPlate). */
  overlayStillPlate: (videoPath: string, platePath: string, outPath: string) => Promise<void>;
  /** ffmpeg: the hook's sound (overlay.ts muxHookSfx). */
  muxHookSfx: (videoPath: string, sfxPath: string, outPath: string) => Promise<void>;
  writeFile: (filePath: string, body: Buffer) => Promise<void>;
  /** Folder of the finished hook sounds (lib/reels/sfx/final). */
  sfxDir: string;
};

export type RelayInput = {
  /** The local clean clip (no text, no hook). */
  storedClipPath: string;
  newCopy: string;
  /** A scratch folder for the plate and the outputs. */
  workDir: string;
  profile?: ColorProfile;
  fullStoryCue?: string | null;
  /** The hook the reel had stamped (null: none). */
  hook?: Hook | null;
  timing?: HookTiming;
};

export type RelayResult = { videoPath: string; lines: string[]; warnings: string[]; hook: Hook | null; sfx: string | null };

export async function relayPlate(deps: PlateDeps, input: RelayInput): Promise<RelayResult> {
  const [{ hookSfxPlan }, { SFX_FPS }] = await Promise.all([import('@/lib/reels/sfx/manifest'), import('@/lib/reels/sfx/frame-map')]);
  const profile = input.profile ?? 'noir';
  const hook = input.hook ?? null;
  const timing = input.timing ?? 'double';
  const shape = await deps.probeVideo(input.storedClipPath);
  const plate = await deps.renderTextPlate(input.newCopy, shape.width, shape.height, profile, input.fullStoryCue ?? null);
  const platePath = path.join(input.workDir, 'relay-plate.png');
  await deps.writeFile(platePath, plate.png);
  const outPath = path.join(input.workDir, 'relay.mp4');
  if (hook) await deps.overlayPlate(input.storedClipPath, platePath, outPath, { hook, clip: shape, timing });
  else await deps.overlayStillPlate(input.storedClipPath, platePath, outPath);
  const warnings = [...plate.warnings];
  const plan = hookSfxPlan(hook, shape.fps, timing, SFX_FPS);
  if (plan.file === null) {
    if (plan.notice) warnings.push(plan.notice);
    return { videoPath: outPath, lines: plate.lines, warnings, hook, sfx: null };
  }
  const soundPath = path.join(input.workDir, 'relay-sfx.mp4');
  await deps.muxHookSfx(outPath, path.join(deps.sfxDir, plan.file), soundPath);
  return { videoPath: soundPath, lines: plate.lines, warnings, hook, sfx: plan.file };
}
