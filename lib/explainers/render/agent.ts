import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkToolCall, FRAME_WORKER_TOOLS, SCENE_BUILDER_TOOLS, SESSION_TOOLS } from '@/lib/explainers/render/policy';
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
 *   tools      — web search and fetch for research (EX3-03), no MCP.
 *   settings   — project only; the operator's ~/.claude never loads.
 *   PreToolUse — every call (orchestrator and frame workers) through policy.ts.
 *   sandbox    — OS-level: writes confined to the project, network to HeyGen +
 *                the GSAP CDN, localhost bind allowed so check/render can listen.
 *                `npx hyperframes <args>` and the kit's bounds check run outside the
 *                sandbox (prefix rule) so they can drive Chrome; they still pass the
 *                policy check.
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
  // The kit's text-bounds check drives the same headless Chrome (EX3-92): `… bounds.mjs all`.
  'node assets/kit/bounds.mjs *',
];

export const FRAME_WORKER_AGENT = 'frame-worker';
const FRAME_WORKER_PROMPT = [
  'You are a frame worker for one Helios Explainer Reel frame (Explainers 3.3).',
  'Your dispatch message names your role file (.hyperframes/frame-packets/_role.md) and your frame packet.',
  'Read both first, then frame.md, assets/world/world.js, and the kit in assets/kit/, and follow them exactly.',
  'A shot is only a camera: draw the same scene, with every critter, in every shot. Text inside a shape is textBox().',
  'Write only your assigned assets/frames/<frame_id>.js and its .events.json. Never write compositions, never edit STORYBOARD.md or world.js, never run commands, never ask questions.',
].join(' ');

export const SCENE_BUILDER_AGENT = 'scene-builder';
const SCENE_BUILDER_PROMPT = [
  "You are the scene builder for one Helios Explainer Reel (Explainers 3.3): you draw the reel's anchor scene once.",
  'Read .claude/skills/helios-explainer-director/scene-builder.md first and follow it exactly.',
  'Write only assets/world/world.js. Never edit STORYBOARD.md, never write frames, never run commands, never ask questions.',
].join(' ');

/**
 * The blind picture check (EX3-84): a subagent with no storyboard context names what it sees on
 * the snapshot contact sheets, so the orchestrator's own knowledge of what each box is meant to
 * be cannot make it "see" a hand. It runs the cheapest way (Lucas, 2026-10-13): the cheapest
 * model, Read only, one or two composited sheets per check.
 */
export const PICTURE_CHECKER_AGENT = 'picture-checker';
export const PICTURE_CHECKER_MODEL = 'claude-haiku-5-5';
export const PICTURE_CHECKER_TOOLS = ['Read', 'SubagentHandback'];
const PICTURE_CHECKER_PROMPT = [
  'You look at pictures for a short animated video without knowing what they are meant to show.',
  'Read only the contact sheet images your dispatch message names; each has numbered tiles labeled with a time.',
  'For each tile, say in plain words what a stranger sees: every character and object you can name (call anything you cannot name at a glance an "unclear shape" and describe it),',
  'what is happening, any words you can read, and anything cut off at the frame edge or too small to read.',
  'Never guess what the video is about and never assume an object is something it does not clearly look like.',
  'Reply with JSON only: [{"tile": 1, "at": "0.5s", "sees": "...", "unclear": ["..."], "cut_off": "", "text": ""}].',
].join(' ');

/**
 * The first-time-viewer test (EX3-101): a subagent with no context reads only what a viewer has
 * met by the end of beat 2 (the opener line, the hook's picture, the gap's picture and line) and
 * says what it understood and whether it wants to keep watching. A gap that confuses a stranger
 * is rewritten. Cheapest model, Read only, like the picture check.
 */
export const FIRST_VIEWER_AGENT = 'first-viewer';
const FIRST_VIEWER_PROMPT = [
  'You are a first-time viewer scrolling short videos. You have seen only what the file your dispatch message names describes: the first seconds of one video (what was on screen and what the voice said).',
  'You know nothing else about the video. Never guess what it is about beyond what is there.',
  'Answer honestly, as a busy stranger would: (1) what is happening; (2) what the character wants and what is in the way; (3) what question you are left with; (4) what you expect to learn;',
  '(5) would you keep watching, 1 to 5; (6) anything that confused you or that you could not picture (words you did not understand, things you could not tell why you were shown).',
  'Reply with JSON only: {"happening": "...", "want": "...", "obstacle": "...", "question": "...", "expect_to_learn": "...", "keep_watching": 1, "confused": ["..."]}.',
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
  // A key that is not scoped to a workspace is refused (HTTP 400) unless every request names its workspace, as
  // lib/anthropic-client.ts does for the Messages API. Claude Code takes extra request headers from this variable.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return {
    PATH: [...new Set(pathDirs)].join(path.delimiter),
    HOME: input.homeDir,
    TMPDIR: input.tmpDir,
    LANG: 'en_US.UTF-8',
    ANTHROPIC_API_KEY: input.secrets.anthropicApiKey,
    ...(workspace ? { ANTHROPIC_CUSTOM_HEADERS: `anthropic-workspace-id: ${workspace}` } : {}),
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
      [SCENE_BUILDER_AGENT]: {
        description: "Draws the reel's anchor scene once, as assets/world/world.js, from STORYBOARD.md's ## Anchor scene.",
        prompt: SCENE_BUILDER_PROMPT,
        tools: SCENE_BUILDER_TOOLS,
        model: input.frameWorkerModel,
      },
      [FRAME_WORKER_AGENT]: {
        description: 'Writes exactly one frame scene module (assets/frames/<frame_id>.js) from its role file and packet.',
        prompt: FRAME_WORKER_PROMPT,
        tools: FRAME_WORKER_TOOLS,
        model: input.frameWorkerModel,
      },
      [PICTURE_CHECKER_AGENT]: {
        description: 'Blind picture check: says what a stranger sees on the snapshot contact sheets, knowing nothing of the storyboard.',
        prompt: PICTURE_CHECKER_PROMPT,
        tools: PICTURE_CHECKER_TOOLS,
        model: PICTURE_CHECKER_MODEL,
      },
      [FIRST_VIEWER_AGENT]: {
        description: "First-time-viewer test of the curiosity gap: says what a stranger understood from the reel's first seconds and whether they would keep watching.",
        prompt: FIRST_VIEWER_PROMPT,
        tools: PICTURE_CHECKER_TOOLS,
        model: PICTURE_CHECKER_MODEL,
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
