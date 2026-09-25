import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import { VISUAL_SCENE_MAX_TOKENS, VISUAL_SCENE_MODEL } from '@/lib/reels/config';
import { sceneWriterInstructions } from '@/lib/reels/visual/blocks';
import type { ColorProfile } from '@/lib/reels/visual/color';
import { buildSceneUser, parseScene, type VisualCategory } from '@/lib/reels/visual/scene';

export type SceneClient = {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<Anthropic.Message>;
  };
};

export type SceneWriteResult = {
  scene: string | null;
  message: Anthropic.Message | null;
  error: string | null;
};

export async function writeScene(
  client: SceneClient,
  input: {
    story: string;
    category: VisualCategory;
    onScreenText: string;
    recentScenes: string[];
    profile?: ColorProfile;
  },
  signal?: AbortSignal,
): Promise<SceneWriteResult> {
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(
      {
        model: VISUAL_SCENE_MODEL,
        max_tokens: VISUAL_SCENE_MAX_TOKENS,
        system: cachedSystemText(sceneWriterInstructions(input.profile ?? 'noir'), '5m'),
        messages: [{ role: 'user', content: buildSceneUser(input) }],
      },
      { signal },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { scene: null, message: null, error: `Scene request failed: ${detail}` };
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) {
    const reason = message.stop_reason === 'max_tokens' ? ' The response hit max_tokens.' : '';
    return { scene: null, message, error: `Scene writer returned no text.${reason}` };
  }
  if (message.stop_reason === 'max_tokens') {
    return { scene: null, message, error: 'Scene writer hit max_tokens before finishing the scene.' };
  }

  try {
    return { scene: parseScene(text), message, error: null };
  } catch (error) {
    return {
      scene: null,
      message,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
