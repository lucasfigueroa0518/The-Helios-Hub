import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';

/**
 * A Claude client for the scripts. An organization-level API key (not scoped
 * to a workspace) must name its workspace on every request, so when
 * ANTHROPIC_WORKSPACE_ID is set, every call carries the
 * `anthropic-workspace-id` header. Unset: a plain client, exactly as before.
 */
export function anthropicClientOptions(opts: ClientOptions = {}): ClientOptions {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  if (!workspace) return opts;
  return { ...opts, defaultHeaders: { ...(opts.defaultHeaders as Record<string, string> | undefined), 'anthropic-workspace-id': workspace } };
}

export const newAnthropic = (opts: ClientOptions = {}) => new Anthropic(anthropicClientOptions(opts));
