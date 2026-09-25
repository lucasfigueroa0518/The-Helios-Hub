import { KLING_CLIP_SECONDS } from '@/lib/reels/config';

/** MCP model id for Kling 3.0. The HTTP id is the fallback when a schema lists it. */
export const KLING_MCP_MODEL = 'kling3_0';
export const KLING_IMAGE_TO_VIDEO = 'kling-video/v3.0/std/image-to-video';

type SchemaProperty = {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, SchemaProperty>;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, SchemaProperty>;
    required?: string[];
  };
};

const IMAGE_KEYS = [
  'image_url',
  'image',
  'start_image_url',
  'start_image',
  'input_image',
  'input_image_url',
  'first_frame',
  'first_frame_url',
];

const SOUND_OFF_KEYS = ['sound', 'generate_audio', 'audio'];
const MULTI_SHOT_KEYS = ['multi_shots', 'multi_shot', 'multishot'];
const ENHANCE_KEYS = ['enhance_prompt', 'prompt_enhancer', 'enhancePrompt'];

function modelFromSchema(schema: McpTool['inputSchema']): string {
  const model = schema?.properties?.model;
  const enums = (model?.enum ?? []).filter((value): value is string => typeof value === 'string');
  const mcp = enums.find((value) => value === KLING_MCP_MODEL);
  const pinned = enums.find((value) => /kling/i.test(value) && /image|i2v|3/.test(value));
  return mcp ?? pinned ?? KLING_MCP_MODEL;
}

/** Nested params object Higgsfield's generate_video tool forwards to Kling. */
export function klingParams(input: { prompt: string; imageUrl: string }): Record<string, unknown> {
  return {
    prompt: input.prompt,
    duration: KLING_CLIP_SECONDS,
    aspect_ratio: '9:16',
    sound: 'off',
    multi_shots: false,
    enhance_prompt: false,
    mode: 'std',
    medias: [{ role: 'start_image', value: input.imageUrl }],
  };
}

function valueFor(key: string, schema: McpTool['inputSchema'], imageUrl: string, prompt: string): unknown {
  const property = schema?.properties?.[key];
  if (key === 'prompt') return prompt;
  if (IMAGE_KEYS.includes(key)) return imageUrl;
  if (key === 'model' || key === 'model_id') return modelFromSchema(schema);
  if (key === 'duration' || key === 'duration_seconds') return KLING_CLIP_SECONDS;
  if (key === 'aspect_ratio' || key === 'aspectRatio') return '9:16';
  if (SOUND_OFF_KEYS.includes(key)) {
    if (property?.type === 'boolean') return false;
    if (property?.enum?.includes('off')) return 'off';
    return property?.type === 'string' ? 'off' : false;
  }
  if (MULTI_SHOT_KEYS.includes(key) || ENHANCE_KEYS.includes(key)) return false;
  return undefined;
}

/**
 * Arguments for the one pinned tool. Sound, multi-shot, and prompt enhancement
 * stay off. Extra schema fields are left unset so Claude cannot wander.
 */
export function klingArguments(
  tool: McpTool,
  input: { prompt: string; imageUrl: string },
): Record<string, unknown> {
  const properties = tool.inputSchema?.properties;
  const params = klingParams(input);
  const keys = properties
    ? Object.keys(properties)
    : ['prompt', 'model', 'params', 'image_url', 'duration', 'aspect_ratio', 'sound', 'multi_shots', 'enhance_prompt'];
  const args: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === 'params') {
      const nested = properties?.params?.properties;
      args.params = nested
        ? Object.fromEntries(Object.entries(params).filter(([name]) => name in nested))
        : params;
      continue;
    }
    const value = valueFor(key, tool.inputSchema, input.imageUrl, input.prompt);
    if (value !== undefined) args[key] = value;
  }
  const nestedPrompt = args.params && typeof args.params === 'object' ? (args.params as { prompt?: unknown }).prompt : undefined;
  if ((typeof args.prompt !== 'string' || !args.prompt.trim()) && (typeof nestedPrompt !== 'string' || !nestedPrompt.trim())) {
    const accepted = properties ? Object.keys(properties).join(', ') : 'none';
    throw new Error(`Pinned video tool ${tool.name} has no prompt field. It accepts: ${accepted}.`);
  }
  const nestedMedias = args.params && typeof args.params === 'object' ? (args.params as { medias?: unknown }).medias : undefined;
  if (!IMAGE_KEYS.some((key) => key in args) && !Array.isArray(nestedMedias)) {
    throw new Error('Pinned video tool has no start-frame field.');
  }
  return args;
}

/** generate_video is the one Kling call. Other tools mention Kling and must not be selected. */
export function pickKlingTool(tools: McpTool[]): McpTool {
  const chosen = tools.find((tool) => tool.name === 'generate_video');
  if (!chosen) throw new Error('Higgsfield MCP published no generate_video tool.');
  return chosen;
}
