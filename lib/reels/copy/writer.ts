import type Anthropic from '@anthropic-ai/sdk';

import { COPY_MAX_TOKENS, COPY_MODEL } from '@/lib/reels/config';
import { assembleCopyPrompt, type CopyInput } from '@/lib/reels/copy/assemble';
import { REPORT_COPY_TOOL, parseCopyReport, type CopyCall } from '@/lib/reels/copy/report';

/** The one method the writer needs, so tests can stub it. */
export type CopyClient = {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<Anthropic.Message>;
  };
};

export type CopyResult = {
  version: string;
  /** Null when the request itself failed, so nothing was billed. */
  message: Anthropic.Message | null;
  /** Two on-screen lines and one caption. Null when the call failed. */
  call: CopyCall | null;
  error: string | null;
};

/** D-220. How much of a stray text reply the error keeps. */
export const MISSING_CALL_TEXT_CHARS = 200;

/** Names the stop reason and quotes the start of any text, so an empty reply can be told from a truncation. */
export function missingToolCallError(message: Anthropic.Message): string {
  const parts = ['No report_copy call came back.'];
  if (message.stop_reason === 'max_tokens') parts.push('The response hit max_tokens.');
  parts.push(`stop_reason: ${message.stop_reason ?? 'none'}.`);
  const text = message.content
    .flatMap((entry) => (entry.type === 'text' ? [entry.text] : []))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  parts.push(text ? `Text: "${text.slice(0, MISSING_CALL_TEXT_CHARS)}"` : 'No text came back either.');
  return parts.join(' ');
}

export async function writeCopy(
  client: CopyClient,
  input: CopyInput,
  signal?: AbortSignal,
  model: string = COPY_MODEL,
): Promise<CopyResult> {
  const prompt = assembleCopyPrompt(input);
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(
      {
        model,
        max_tokens: COPY_MAX_TOKENS,
        system: prompt.system,
        tools: prompt.tools,
        tool_choice: prompt.toolChoice,
        messages: prompt.messages,
      },
      { signal },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { version: prompt.version, message: null, call: null, error: `Copy request failed: ${detail}` };
  }

  const block = message.content.find(
    (entry): entry is Anthropic.ToolUseBlock =>
      entry.type === 'tool_use' && entry.name === REPORT_COPY_TOOL.name,
  );
  if (!block) {
    return { version: prompt.version, message, call: null, error: missingToolCallError(message) };
  }

  try {
    const call = parseCopyReport(block.input);
    return { version: prompt.version, message, call, error: null };
  } catch (error) {
    return {
      version: prompt.version,
      message,
      call: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
