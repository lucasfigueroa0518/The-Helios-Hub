import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KLING_CLIP_SECONDS } from '@/lib/reels/config';
import type { ColorProfile } from '@/lib/reels/visual/color';
import type { Hook, HookTiming } from '@/lib/reels/visual/hook';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.join(DIR, 'motion-writer-prompt.txt');

/**
 * Bump when the writer prompt, a grade block, or a code-owned Kling line
 * changes. The version before this one is frozen in saved/motion-writer-v1/.
 */
export const MOTION_PROMPT_VERSION = 'motion-writer-v2';

/** Identical on every motion-writer call. This is the cached system prefix. */
export function motionWriterInstructions(): string {
  return readFileSync(PROMPT_PATH, 'utf8').trim();
}

/** The routed part of the system prompt: what the text band and the light are in this grade. */
export function motionGradeInstructions(profile: ColorProfile): string {
  return readFileSync(path.join(DIR, 'motion-grades', `${profile}.txt`), 'utf8').trim();
}

/**
 * Kling's own line for the text band (30% to 62% of the height), chosen by the
 * frame's grade. Code owns it so the band never depends on the writer's
 * wording. Positive on purpose: Kling reads the noun in "no light" as a request.
 */
export const BAND_HOLD: Record<ColorProfile, string> = {
  noir: 'The middle third of the frame stays in deep shadow from the first frame to the last. Every light stays above or below it, where it already is.',
  paper: 'The middle third of the frame stays pale, even white from the first frame to the last. Every dark shape stays above or below it, where it already is.',
  orange: 'The middle third of the frame stays flat, even orange from the first frame to the last. The dark subject stays above or below it, where it already is.',
};

/** Kling's prompt ceiling. A block anywhere near it is overloaded anyway. */
const KLING_PROMPT_MAX_CHARS = 2_500;

export type MotionSpan = {
  start: number;
  end: number;
  action: string;
};

export type MotionPrompt = {
  /** The block Kling receives. The hook, the polarity plan, and ON_SCREEN_COPY are not in here. */
  text: string;
  camera: 'in' | 'out';
  /** The dolly's speed curve, in the writer's words. */
  cameraCurve: string;
  spans: MotionSpan[];
  profile: ColorProfile;
  /** The writer's polarity plan. Stored with the job, never sent to Kling. */
  polarity: string | null;
  /** Problems found and worked around. The clip still renders. */
  warnings: string[];
};

const SPAN = /^(\d+(?:\.\d+)?)\s*[-\u2013]\s*(\d+(?:\.\d+)?)s:\s*(\S.*)$/i;
const CAMERA_LINE = /^Camera:/i;
const CAMERA = /^Camera:\s*slow dolly (in|out)\b[\s,;:.\u2013\u2014-]*(.*)$/i;
/** Another move named in the camera line. Kling turns a second move into a second shot. */
const SECOND_MOVE =
  /\b(?:pans?|panning|tilts?|tilting|orbits?|orbiting|zooms?|zooming|cranes?|craning|booms?|jib|whips?|arcs?|arcing|rotates?|rotating|tracks?|tracking|trucks?|trucking|handheld|shak(?:e|es|y)|pov|point[- ]of[- ]view)\b/i;
/** The pipeline appends this itself, so a copy from the writer is dropped. */
const CONTINUITY = /[\s,;.]*(?:in )?(?:one|a single) continuous (?:shot|take)[\s.]*$/i;
/** Lines the writer may echo that Kling must never receive. */
const NOT_FOR_KLING = /^(?:Hook(?: timing)?|Polarity):/i;

/** What `video_jobs.motion_prompt` stores: the hook, the version and grade, the polarity plan, then the block Kling received. */
export function motionRecord(hook: Hook, prompt: MotionPrompt, timing?: HookTiming): string {
  return [
    `Hook: ${hook}`,
    ...(timing ? [`Hook timing: ${timing}`] : []),
    `Motion: ${MOTION_PROMPT_VERSION}, ${prompt.profile}`,
    ...(prompt.polarity ? [`Polarity: ${prompt.polarity}`] : []),
    ...prompt.warnings.map((warning) => `Warning: ${warning}`),
    prompt.text,
  ].join('\n');
}

function seconds(value: string): number {
  return Number(value);
}

function formatSeconds(value: number): string {
  return value.toFixed(1);
}

/** Used when the writer gives no usable camera line or curve. */
export const FALLBACK_CAMERA_CURVE = 'already moving on the first frame, easing gradually and coming to rest by 6.0s';

/**
 * Fails open: every problem becomes a warning and Kling still gets a block.
 * The camera line comes first, then the grade's band hold, then the spans.
 */
export function parseMotionPrompt(raw: string, profile: ColorProfile): MotionPrompt {
  const warnings: string[] = [];
  let text = raw.trim();
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fenced?.[1]) text = fenced[1].trim();

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const spans: MotionSpan[] = [];
  let camera: 'in' | 'out' | null = null;
  let cameraCurve = '';

  for (const line of lines) {
    if (NOT_FOR_KLING.test(line)) continue;
    if (CAMERA_LINE.test(line)) {
      if (camera) {
        warnings.push('Extra camera line dropped.');
        continue;
      }
      const cameraMatch = line.match(CAMERA);
      if (!cameraMatch?.[1]) {
        warnings.push(`Camera line was not a slow dolly in or out; used a slow dolly in instead: ${line}`);
        camera = 'in';
        continue;
      }
      camera = /out/i.test(cameraMatch[1]) ? 'out' : 'in';
      cameraCurve = (cameraMatch[2] ?? '').replace(CONTINUITY, '').replace(/[\s.]+$/, '').trim();
      continue;
    }
    const span = line.match(SPAN);
    if (!span?.[1] || !span[2] || !span[3]) {
      warnings.push(`Line that is not a timestamp or the camera was dropped: ${line}`);
      continue;
    }
    spans.push({ start: seconds(span[1]), end: seconds(span[2]), action: span[3].trim() });
  }

  if (!camera) {
    warnings.push('Missing camera line; used a slow dolly in.');
    camera = 'in';
  }
  if (cameraCurve.split(/\s+/).filter(Boolean).length < 3) {
    if (cameraCurve || lines.some((line) => CAMERA_LINE.test(line))) warnings.push('Camera line had no speed curve; used the default curve.');
    cameraCurve = FALLBACK_CAMERA_CURVE;
  }
  if (SECOND_MOVE.test(cameraCurve)) warnings.push(`Camera line names a second camera move, which Kling may turn into a cut: ${cameraCurve}`);
  if (spans.length === 0) warnings.push('No timed spans; Kling gets only the camera and band lines.');

  const first = spans[0];
  if (first && (first.start !== 0 || first.end !== 0.5)) warnings.push('The first span is not exactly 0.0-0.5s.');
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    if (span && !(span.end > span.start)) warnings.push(`Span ${formatSeconds(span.start)}-${formatSeconds(span.end)}s ends before it starts.`);
    const previous = spans[index - 1];
    if (span && previous && Math.abs(span.start - previous.end) > 0.001) warnings.push('Timed spans leave a gap or overlap.');
  }
  const last = spans[spans.length - 1];
  if (last && Math.abs(last.end - KLING_CLIP_SECONDS) > 0.001) {
    warnings.push(`Timed spans do not cover through ${KLING_CLIP_SECONDS.toFixed(1)}s.`);
  }

  const head = [`Camera: slow dolly ${camera}, ${cameraCurve}. One continuous shot.`, BAND_HOLD[profile]];
  const body: string[] = [];
  let length = head.join('\n').length;
  let cut = false;
  for (const span of spans) {
    const line = `${formatSeconds(span.start)}-${formatSeconds(span.end)}s: ${span.action}`;
    if (length + 1 + line.length > KLING_PROMPT_MAX_CHARS) {
      cut = true;
      break;
    }
    body.push(line);
    length += 1 + line.length;
  }
  if (cut) warnings.push(`Prompt was longer than ${KLING_PROMPT_MAX_CHARS} characters; later spans were cut.`);

  return { text: [...head, ...body].join('\n'), camera, cameraCurve, spans, profile, polarity: null, warnings };
}

/** User turn after the background PNG. ON_SCREEN_COPY stays with the writer. */
export function buildMotionUser(input: { scene: string; story: string; onScreenCopy: string }): string {
  return [
    'SCENE',
    input.scene.trim(),
    '',
    'STORY',
    input.story.trim(),
    '',
    'ON_SCREEN_COPY',
    input.onScreenCopy.trim(),
  ].join('\n');
}
