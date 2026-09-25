import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { MOTION_MAX_TOKENS, MOTION_MODEL } from '@/lib/reels/config';
import type { ColorProfile } from '@/lib/reels/visual/color';
import {
  buildMotionUser,
  motionGradeInstructions,
  motionWriterInstructions,
  parseMotionPrompt,
  type MotionPrompt,
} from '@/lib/reels/visual/motion-prompt';

export type MotionClient = {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<Anthropic.Message>;
  };
};

export type MotionWriteResult = {
  /** Always set: failures fall back to a camera-only prompt with warnings. */
  prompt: MotionPrompt | null;
  message: Anthropic.Message | null;
  error: string | null;
};

/** The only tool Claude is offered. The worker sends the prompt to Kling on Fal with pinned args. */
export const SUBMIT_MOTION_TOOL = 'submit_motion_prompt';

const submitMotionTool: Anthropic.Tool = {
  name: SUBMIT_MOTION_TOOL,
  description:
    'Submit the one Kling 3.0 image-to-video prompt for this still. Call once. Write the polarity plan first, then the prompt: the camera line, then motion only, timestamped from 0.0 through 8.0.',
  input_schema: {
    type: 'object',
    properties: {
      polarity: {
        type: 'string',
        description:
          'Your plan, never sent to Kling: for the camera, the story beat, the light, and the ambient detail, which way each moves and its speed curve; flow or collision; settle or stay charged.',
      },
      prompt: {
        type: 'string',
        description: 'The block Kling receives: the camera line, then the timestamped spans, and nothing else.',
      },
    },
    required: ['polarity', 'prompt'],
  },
};

/**
 * The shared instructions are the cached prefix. The grade block is routed per
 * clip from the frame's color profile and sits after the breakpoint.
 */
export function motionSystem(profile: ColorProfile): Anthropic.TextBlockParam[] {
  return [
    ...cachedSystemText(motionWriterInstructions(), '5m'),
    { type: 'text', text: motionGradeInstructions(profile) },
  ];
}

function submissionFromMessage(message: Anthropic.Message): { prompt: string; polarity: string | null } {
  for (const block of message.content) {
    if (block.type === 'tool_use' && block.name === SUBMIT_MOTION_TOOL) {
      const input = block.input as { prompt?: unknown; polarity?: unknown };
      if (typeof input.prompt === 'string' && input.prompt.trim()) {
        const polarity = typeof input.polarity === 'string' ? input.polarity.replace(/\s+/g, ' ').trim() : '';
        return { prompt: input.prompt, polarity: polarity || null };
      }
    }
  }
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  return { prompt: text, polarity: null };
}

export async function writeMotion(
  client: MotionClient,
  input: { png: Buffer; scene: string; story: string; onScreenCopy: string; profile: ColorProfile },
  signal?: AbortSignal,
): Promise<MotionWriteResult> {
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(
      {
        model: MOTION_MODEL,
        max_tokens: MOTION_MAX_TOKENS,
        system: motionSystem(input.profile),
        tools: [withToolCache(submitMotionTool, '5m')],
        tool_choice: { type: 'tool', name: SUBMIT_MOTION_TOOL },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: input.png.toString('base64'),
                },
              },
              { type: 'text', text: buildMotionUser(input) },
            ],
          },
        ],
      },
      { signal },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fallback(input.profile, null, `Motion writer failed (${detail}); used the fallback camera-only prompt.`);
  }

  const submitted = submissionFromMessage(message);
  if (!submitted.prompt) {
    return fallback(input.profile, message, 'Motion writer returned no prompt; used the fallback camera-only prompt.');
  }
  const parsed = parseMotionPrompt(submitted.prompt, input.profile);
  return { prompt: { ...parsed, polarity: submitted.polarity }, message, error: null };
}

/** Fail open: a writer failure still sends Kling the camera and band lines. */
function fallback(profile: ColorProfile, message: Anthropic.Message | null, warning: string): MotionWriteResult {
  const parsed = parseMotionPrompt('', profile);
  return {
    prompt: { ...parsed, warnings: [warning, ...parsed.warnings] },
    message,
    error: null,
  };
}
