/**
 * Vision "kind check" — Haiku 4.5 with an image, structured output.
 *
 * Per docs/IMAGES-V1-HANDOFF.md §Accuracy rules: the vision check does
 * NOT identify people. Identity comes from Wikidata linkage (P18 / P180).
 * This check only decides whether the file is the right KIND of image:
 *
 *   - Real photograph (not a logo, chart, screenshot, drawing, illustration).
 *   - Clean (no large text overlay, no watermark, no third-party branding).
 *   - For people: exactly one clearly visible person, face not cropped.
 *
 * Group photos are rejected because a face-in-a-crowd next to a quote
 * is the failure mode the spec calls out.
 */

import Anthropic from '@anthropic-ai/sdk';
import { cachedSystemText, cacheUsageFromMessage, withToolCache } from '@/lib/anthropic-cache';

export type VisionUsage = ReturnType<typeof cacheUsageFromMessage>;

const VISION_MODEL = 'claude-haiku-4-5-20251001';

export type VisionCheckInput = {
  imageBytes: Buffer;
  mime: 'image/jpeg' | 'image/png';
  /** True when the subject is a person — enables the face + one-person gates. */
  subjectIsPerson: boolean;
  client?: Anthropic;
};

export type VisionVerdict = {
  isPhoto: boolean;
  clean: boolean;
  /** null when subjectIsPerson=false. */
  onePersonVisible: boolean | null;
  /** null when subjectIsPerson=false. */
  faceClear: boolean | null;
};

export type VisionCheckResult = {
  verdict: VisionVerdict;
  passed: boolean;
  reason: string;
  usage: VisionUsage;
};

const SYSTEM_PROMPT = `You classify the KIND of image, not the identity of anything in it. NEVER guess who someone is or name them. You return one tool call with four boolean answers.

- isPhoto: true if this is a real photograph (a camera captured a scene). False for logos, charts, diagrams, screenshots, drawings, paintings, 3D renders, illustrations, book covers, posters.
- clean: true if the image is free of large overlaid text, watermarks, and other companies' branding. Small captions or a photographer's mark in a corner are fine.
- onePersonVisible: true iff exactly one human is clearly visible in the frame. False for group photos, empty scenes, or images where the person is a small figure. Set to null if the subject is not a person.
- faceClear: true if that one person's face is fully visible and not cropped, blurred, or heavily obscured by a mask, hands, or angle. Set to null if the subject is not a person.

You do not name the person. You do not decide if they are the right person. Both of those come from other sources.`;

const VERDICT_TOOL = withToolCache({
  name: 'verdict',
  description: 'Return the four boolean answers for this image.',
  input_schema: {
    type: 'object',
    properties: {
      isPhoto: { type: 'boolean' },
      clean: { type: 'boolean' },
      onePersonVisible: { type: ['boolean', 'null'] },
      faceClear: { type: ['boolean', 'null'] },
    },
    required: ['isPhoto', 'clean', 'onePersonVisible', 'faceClear'],
    additionalProperties: false,
  },
});

/**
 * Run one vision check on a single candidate. Returns pass/fail + reason
 * + the structured verdict + token usage.
 */
export async function visionKindCheck(input: VisionCheckInput): Promise<VisionCheckResult> {
  const client = input.client ?? new Anthropic();
  const userNote = input.subjectIsPerson
    ? 'The subject is a person. Set onePersonVisible and faceClear to true or false.'
    : 'The subject is NOT a person. Set onePersonVisible and faceClear to null.';

  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 200,
    system: cachedSystemText(SYSTEM_PROMPT, '1h'),
    tools: [VERDICT_TOOL],
    tool_choice: { type: 'tool', name: 'verdict' },
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: input.mime,
            data: input.imageBytes.toString('base64'),
          },
        },
        { type: 'text', text: userNote },
      ],
    }],
  });

  const usage = cacheUsageFromMessage(response);

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use' || toolUse.name !== 'verdict') {
    return {
      verdict: { isPhoto: false, clean: false, onePersonVisible: null, faceClear: null },
      passed: false,
      reason: 'model did not call the verdict tool',
      usage,
    };
  }

  const raw = toolUse.input as Partial<VisionVerdict>;
  const verdict: VisionVerdict = {
    isPhoto: Boolean(raw.isPhoto),
    clean: Boolean(raw.clean),
    onePersonVisible: raw.onePersonVisible ?? null,
    faceClear: raw.faceClear ?? null,
  };

  const fails: string[] = [];
  if (!verdict.isPhoto) fails.push('not a photograph');
  if (!verdict.clean) fails.push('has large text / watermark / third-party branding');
  if (input.subjectIsPerson) {
    if (verdict.onePersonVisible !== true) fails.push('not exactly one visible person');
    if (verdict.faceClear !== true) fails.push('face not clearly visible');
  }

  return {
    verdict,
    passed: fails.length === 0,
    reason: fails.length === 0 ? 'passed' : `rejected: ${fails.join('; ')}`,
    usage,
  };
}
