import type Anthropic from '@anthropic-ai/sdk';

import { COPY_MAX_TOKENS, COPY_MODEL } from '@/lib/reels/config';
import { assembleCopyPrompt, type CopyInput } from '@/lib/reels/copy/assemble';
import {
  REPORT_COPY_TOOL,
  checkCopy,
  parseCopyReport,
  type CopyChecks,
  type CopyReport,
} from '@/lib/reels/copy/report';

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
  report: CopyReport | null;
  checks: CopyChecks | null;
  error: string | null;
};

export async function writeCopy(
  client: CopyClient,
  input: CopyInput,
  signal?: AbortSignal,
): Promise<CopyResult> {
  const prompt = assembleCopyPrompt(input);
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(
      {
        model: COPY_MODEL,
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
    return { version: prompt.version, message: null, report: null, checks: null, error: `Copy request failed: ${detail}` };
  }

  const block = message.content.find(
    (entry): entry is Anthropic.ToolUseBlock =>
      entry.type === 'tool_use' && entry.name === REPORT_COPY_TOOL.name,
  );
  if (!block) {
    const reason = message.stop_reason === 'max_tokens' ? ' The response hit max_tokens.' : '';
    return { version: prompt.version, message, report: null, checks: null, error: `No report_copy call came back.${reason}` };
  }

  try {
    const report = parseCopyReport(block.input);
    return {
      version: prompt.version,
      message,
      report,
      checks: checkCopy(report, input.bucket, prompt.knownUrls),
      error: null,
    };
  } catch (error) {
    return {
      version: prompt.version,
      message,
      report: null,
      checks: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
