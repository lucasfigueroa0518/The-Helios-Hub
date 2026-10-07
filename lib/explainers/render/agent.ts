import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkToolCall, FRAME_WORKER_TOOLS, SESSION_TOOLS } from '@/lib/explainers/render/policy';
import type { SpendMeter } from '@/lib/explainers/render/meter';
import { HYPERFRAMES_ENV, RUNTIME_DIR } from '@/lib/explainers/render/workspace';

/**
 * One headless Agent SDK session (BUILD_PLAN §5, E-01). The SDK lives in
 * explainers/runtime (it needs a newer @anthropic-ai/sdk than the Hub's), so it
 * is loaded from there at run time and injected everywhere else; tests pass a
 * canned message stream instead.
 *
 * Guard rails, outermost first:
 *   env        — replaced entirely: only the keys this render needs.
 *   tools      — no web fetch, no web search, no MCP.
 *   settings   — project only; the operator's ~/.claude never loads.
 *   PreToolUse — every call (orchestrator and frame workers) through policy.ts.
 *   sandbox    — OS-level: writes confined to the project, network to HeyGen +
 *                the GSAP CDN, localhost bind allowed so check/render can listen.
 *                `npx hyperframes <args>` runs outside the sandbox (prefix rule)
 *                so it can drive Chrome; it still passes the policy check.
 *   spend      — live meter aborts past the per-reel cap; maxBudgetUsd backs it up.
 *
 * Prompt caching on this path is the SDK's responsibility (E-13).
 */

export type AgentMessage = { type: string; [key: string]: unknown };
export type AgentQuery = (params: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<AgentMessage>;

// HeyGen's music and sound-effect catalog files come from its S3 accelerate bucket (seen in run 2).
export const ALLOWED_NETWORK_DOMAINS = ['*.heygen.com', '*.heygen.ai', 'heygen-product.s3-accelerate.amazonaws.com', 'cdn.jsdelivr.net'];

/**
 * Bash permission-rule prefixes that run outside the OS sandbox.
 * The space before `*` is required. An exact `npx hyperframes` matches only
 * that string, so `npx hyperframes check` stayed sandboxed and `listen` on
 * 127.0.0.1 returned EPERM (runs 1–3). A piped command still stays sandboxed;
 * `allowLocalBinding` covers that path.
 */
export const UNSANDBOXED_HYPERFRAMES = [
  'npx hyperframes *',
  'npx --no-install hyperframes *',
  'hyperframes *',
];

export const FRAME_WORKER_AGENT = 'frame-worker';
const FRAME_WORKER_PROMPT = [
  'You are a HyperFrames frame worker for one Helios Explainer Reel frame.',
  'Your dispatch message names your role file (.hyperframes/frame-packets/_role.md) and your frame packet.',
  'Read both first, then frame.md, and follow them exactly.',
  'Write only your assigned compositions/frames/<frame_id>.html. Never edit STORYBOARD.md, never run commands, never ask questions.',
].join(' ');

export type SessionResult = {
  sessionId: string | null;
  subtype: string;
  isError: boolean;
  totalCostUsd: number;
  modelUsage: Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; costUSD?: number }>;
  capped: boolean;
  denials: { tool: string; reason: string }[];
  errors: string[];
  lastText: string;
};

export type SessionInput = {
  query: AgentQuery;
  prompt: string;
  projectDir: string;
  homeDir: string;
  tmpDir: string;
  model: string;
  frameWorkerModel: string;
  meter: SpendMeter;
  secrets: { anthropicApiKey: string; heygenApiKey: string; voiceId: string };
  /** One line per SDK message, for the transcript artifact. */
  log: (entry: Record<string, unknown>) => void;
};

function which(binary: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, binary);
    if (dir && fs.existsSync(candidate)) return dir;
  }
  return null;
}

/** The scrubbed environment: no database URL, no Supabase key, no outreach keys. */
export function scrubbedEnv(input: Pick<SessionInput, 'projectDir' | 'homeDir' | 'tmpDir' | 'secrets'>): Record<string, string> {
  const pathDirs = [
    path.join(RUNTIME_DIR, 'node_modules', '.bin'),
    path.dirname(process.execPath),
    which('ffmpeg'),
    '/usr/bin',
    '/bin',
  ].filter((d): d is string => Boolean(d));
  return {
    PATH: [...new Set(pathDirs)].join(path.delimiter),
    HOME: input.homeDir,
    TMPDIR: input.tmpDir,
    LANG: 'en_US.UTF-8',
    ANTHROPIC_API_KEY: input.secrets.anthropicApiKey,
    HEYGEN_API_KEY: input.secrets.heygenApiKey,
    HELIOS_VOICE_ID: input.secrets.voiceId,
    HYPERFRAMES_MEDIA_HOME: input.projectDir,
    // The OS sandbox reaches the network only through its proxy (HTTP(S)_PROXY);
    // Node's fetch ignores those unless this is set, and every HeyGen call fails.
    NODE_USE_ENV_PROXY: '1',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'helios-explainers/1.0',
    ...HYPERFRAMES_ENV,
  };
}

export function sessionOptions(input: SessionInput, abort: AbortController, onDenied: (tool: string, reason: string) => void): Record<string, unknown> {
  const policyHook = async (hookInput: { tool_name?: string; tool_input?: unknown }) => {
    const tool = String(hookInput.tool_name ?? '');
    const decision = checkToolCall(tool, (hookInput.tool_input ?? {}) as Record<string, unknown>, input.projectDir);
    if (decision.allow) {
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
    }
    onDenied(tool, decision.reason);
    return {
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason },
    };
  };
  return {
    cwd: input.projectDir,
    model: input.model,
    env: scrubbedEnv(input),
    tools: SESSION_TOOLS,
    settingSources: ['project'],
    skills: 'all',
    agents: {
      [FRAME_WORKER_AGENT]: {
        description: 'Builds exactly one HyperFrames frame composition from its role file and packet.',
        prompt: FRAME_WORKER_PROMPT,
        tools: FRAME_WORKER_TOOLS,
        model: input.frameWorkerModel,
      },
    },
    hooks: { PreToolUse: [{ hooks: [policyHook] }] },
    // Headless: nobody can approve a prompt. The default mode is `auto`, whose
    // classifier denies any call it will not decide, and `permissionPrompts:
    // 'none'` turns that into "stop and wait" (the server reel: frames 2 and 6
    // were refused, then the orchestrator stopped). Bypass the classifier.
    // The PreToolUse hook above is the gate that still runs.
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    permissionPrompts: 'none',
    strictMcpConfig: true,
    mcpServers: {},
    maxBudgetUsd: Math.max(0.01, input.meter.remainingUsd),
    abortController: abort,
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      excludedCommands: UNSANDBOXED_HYPERFRAMES,
      filesystem: { allowWrite: [input.projectDir, input.homeDir] },
      network: { allowedDomains: ALLOWED_NETWORK_DOMAINS, allowLocalBinding: true },
      credentials: { envVars: [{ name: 'ANTHROPIC_API_KEY', mode: 'deny' }] },
    },
  };
}

function textOf(message: AgentMessage): string {
  const content = (message.message as { content?: unknown })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type: string; text: string } => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export async function runAgentSession(input: SessionInput): Promise<SessionResult> {
  const abort = new AbortController();
  const denials: SessionResult['denials'] = [];
  const result: SessionResult = {
    sessionId: null,
    subtype: 'incomplete',
    isError: true,
    totalCostUsd: 0,
    modelUsage: {},
    capped: false,
    denials,
    errors: [],
    lastText: '',
  };
  const options = sessionOptions(input, abort, (tool, reason) => {
    denials.push({ tool, reason });
    input.log({ type: 'policy_denied', tool, reason });
  });

  try {
    for await (const message of input.query({ prompt: input.prompt, options })) {
      input.log(message);
      if (typeof message.session_id === 'string') result.sessionId = message.session_id;
      if (message.type === 'assistant') {
        input.meter.observe((message.message ?? {}) as Parameters<SpendMeter['observe']>[0]);
        const text = textOf(message);
        if (text && !message.parent_tool_use_id) result.lastText = text;
        if (input.meter.overCap && !abort.signal.aborted) {
          result.capped = true;
          input.log({ type: 'spend_cap', totalUsd: input.meter.totalUsd, capUsd: input.meter.capUsd });
          abort.abort();
        }
      }
      if (message.type === 'result') {
        result.subtype = String(message.subtype ?? 'unknown');
        result.isError = Boolean(message.is_error);
        result.totalCostUsd = Number(message.total_cost_usd ?? 0);
        result.modelUsage = (message.modelUsage ?? {}) as SessionResult['modelUsage'];
        result.errors = Array.isArray(message.errors) ? (message.errors as string[]) : [];
        if (result.subtype === 'error_max_budget_usd') result.capped = true;
      }
    }
  } catch (error) {
    if (!abort.signal.aborted) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  // An aborted session never reports a result; its streamed estimate stands in.
  const settled = result.subtype === 'incomplete' ? input.meter.sessionEstimateUsd : result.totalCostUsd;
  result.totalCostUsd = settled;
  input.meter.settleSession(settled);
  return result;
}

/** The real SDK, loaded from explainers/runtime. */
export async function loadAgentQuery(): Promise<AgentQuery> {
  const entry = path.join(RUNTIME_DIR, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs');
  if (!fs.existsSync(entry)) throw new Error('Agent SDK missing: run `npm install` in explainers/runtime');
  const sdk = (await import(pathToFileURL(entry).href)) as { query: AgentQuery };
  return sdk.query;
}
