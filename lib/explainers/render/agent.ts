import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkToolCall, FRAME_WORKER_TOOLS, SCENE_BUILDER_TOOLS, SELF_REVIEW_TOOLS, SESSION_TOOLS } from '@/lib/explainers/render/policy';
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
  // The self-review stills and the picture-check sequences use it too (Explainers 4.1).
  'node assets/kit/snap.mjs *',
];

/** How the scene builder and the frame workers look at their own work (Explainers 4.1, principles.md §7). */
const SELF_REVIEW = [
  'Look at your own work: the one command you may run is the one named above, exactly, nothing before or after it. It prints JSON with the PNG paths it wrote; Read them and judge them as a stranger on a phone would, against the seven questions in principles.md §7.',
  'Snap once your module is written, fix what fails, and snap again to check each fix: at most four snaps (a first look, two revisions, a last look; snap.mjs refuses a fifth, and a call whose module threw does not count) and at most two revisions.',
].join(' ');

/** The legacy frame worker (3.x/4.0, no self-review). Real Case dispatches it and overrides its prompt. */
export const FRAME_WORKER_AGENT = 'frame-worker';
const FRAME_WORKER_PROMPT = [
  'You are a frame worker for one Helios Explainer Reel frame (Explainers 4.0: soft 3D at true scale, glass and gloss for the real tech).',
  'Your dispatch message names your role file (.hyperframes/frame-packets/_role.md) and your frame packet.',
    "Read both first, then frame.md, your timing file, and only your frame's part of the kit that _role.md lists (the analogy's frames: world.js, lens.js, light.js, motion.js, shots.js and critter()'s options; the glass frames: glass.js and cards.js); read each kit file's header and the doc comments of what you call, never outfits.js or internals. Follow them exactly.",
  'A shot is only a camera: draw the same scene, with every critter, in every shot. Text inside a shape is textBox().',
  'Write only your assigned assets/frames/<frame_id>.js, its .events.json, and, when the frame draws an object of its own, its .props.js (NEW_PROPS, EX3-114). Never write compositions, never edit STORYBOARD.md or world.js, never run commands, never ask questions.',
].join(' ');

/**
 * Explainers 4.1 frame workers, by the frame's kind (try.mjs frameKind): the analogy world's frames
 * (1's hook, 4, 5, and 7 when its storyboard block says `anchor: scene`) and the real tech's (2, 3,
 * 6, and 7 with `anchor: own`). Each looks at stills of its own frame before handing back.
 */
export const SCENE_FRAME_WORKER_AGENT = 'frame-worker-scene';
export const TECH_FRAME_WORKER_AGENT = 'frame-worker-tech';
/** What a builder hands back (SubagentHandback), so the orchestrator can act on it without reading the module. */
const FRAME_HANDBACK =
  'Hand back one short report: the files you wrote; each snap (its times) and what you changed after it; what the frame shows at each shot change, in one line each; and anything you could not fix, or any kit part you could not use, with why.';
const FRAME_SNAP = 'Your one command: `node assets/kit/snap.mjs <your frame id> <t1,t2,…>` (up to six times in seconds into your frame, e.g. at each shot change and the end; frame 1\'s hook is `01-hook`).';
const FRAME_WORKER_CORE = [
  'Your dispatch message names your role file (.hyperframes/frame-packets/_role.md) and your frame packet.',
  'Read .media/recipes/helios-explainer/principles.md first (it wins over every other rule), then both, then frame.md, your timing file, and only the part of the kit _role.md lists for your frame; read each kit file\'s header and the doc comments of what you call, never internals. Follow them exactly.',
  'Write only your assigned assets/frames/<frame_id>.js, its .events.json, and, when the frame draws an object of its own, its .props.js (NEW_PROPS, EX3-114). Never write compositions, never edit STORYBOARD.md or anything in assets/world/, never ask questions.',
];
const SCENE_FRAME_WORKER_PROMPT = [
  'You are a scene frame worker for one Helios Explainer Reel (Explainers 4.1): you build one frame of the analogy world (frame 1\'s hook, 4, 5, or a callback frame 7) through the lens camera, in shots that each earn their cut, with a cast that acts by intent.',
  ...FRAME_WORKER_CORE,
  'Show exactly what the voice says, when it says it; the named character is the clear subject when the voice names it; at most three critters in a shot; every face whole; every held thing in a hand; labels on their entities.',
  FRAME_SNAP,
  SELF_REVIEW,
  FRAME_HANDBACK,
].join(' ');
const TECH_FRAME_WORKER_PROMPT = [
  'You are a tech frame worker for one Helios Explainer Reel (Explainers 4.1): you build one frame of the real technology (frame 2, 3, 6, or a glass frame 7) in glass and gloss, showing the mechanism moving, not boxes with names.',
  ...FRAME_WORKER_CORE,
  'Decide first how this idea is best shown and start the module with `// technique: <id> — <reason>` (an id from assets/kit/explain.js TECHNIQUES); draw every concept through assets/world/identity.js (one icon, colour and shape per concept); no container before its content; read text at least 34px inside the safe area.',
  'Fill the frame with real content (a named file, a real request, the actual numbers), show a measured outcome changing on screen (a timer, a counter, a cost, a step state) or the mechanism building up step by step, and use the whole safe area: never a blank device, an empty card waiting for content, or a few icons on paper (try.mjs checks all of this).',
  FRAME_SNAP,
  SELF_REVIEW,
  FRAME_HANDBACK,
].join(' ');

export const SCENE_BUILDER_AGENT = 'scene-builder';
const SCENE_BUILDER_PROMPT = [
  "You are the scene builder for one Helios Explainer Reel (Explainers 4.1): you build the reel's anchor world once: a place you could walk into (a SET brief, then the set from assets/kit/set.js), every entity at its real size, every critter in an outfit drawn for its role, and the reel's concept identity map.",
  'Read .media/recipes/helios-explainer/principles.md first (it wins over every other rule), then .claude/skills/helios-explainer-director/scene-builder.md, and follow them exactly.',
  'Write only assets/world/world.js, assets/world/identity.js (explain.js identity()) and assets/world/new-props.js (every object drawn new, NEW_PROPS with full tags, EX3-114). Never edit STORYBOARD.md, never write frames, never ask questions.',
  'Your one command: `node assets/kit/snap.mjs world` (stills of your set through world.js VIEWS, or two eye-level views).',
  SELF_REVIEW,
  'Hand back one short report: the files you wrote; the place(s) and tells you built; each entity with its real size; each snap and what you changed after it; any object you could not build as planned, what you drew instead and why; and anything you could not fix.',
].join(' ');

/**
 * The picture check (EX3-84; Explainers 4.1: required, with vision, over shot sequences). A
 * subagent with no storyboard context looks at each frame's stills in play order (snap.mjs
 * sequences: one just after each cut, one at the end) with only the voiceover line said over them,
 * so the orchestrator's knowledge of what each box is meant to be cannot make it "see" a hand.
 * Read only. Its model is the picture_check_model setting (Sonnet); a session that names none
 * (Real Case) keeps the legacy Haiku contact-sheet check. Collect flags a reel whose
 * .hyperframes/picture-check.json is missing (job.ts).
 */
export const PICTURE_CHECKER_AGENT = 'picture-checker';
/** The picture checker's model when the session names none (the legacy contact-sheet check). */
export const PICTURE_CHECKER_MODEL = 'claude-haiku-5-5';
export const PICTURE_CHECKER_TOOLS = ['Read', 'SubagentHandback'];
/**
 * Where the orchestrator writes the picture check (collect reads it): `{ "frames": [ …the checker's
 * per-frame entries… ], "assets": [ { name, file, meant, seen, pass } ] }`, one asset row per new
 * drawing (NEW_PROPS), `seen` in the checker's words from its `objects`; a passing row joins the
 * asset bank (bank.ts, EX3-114). A bare per-frame array is read too (no assets: nothing is banked).
 */
export const PICTURE_CHECK_FILE = '.hyperframes/picture-check.json';
export const PICTURE_CHECKER_PROMPT = [
  'You look at stills from a short animated video as a stranger on a phone who does not know what they are meant to show.',
  'Your dispatch message names, per frame, a sequence of stills in play order (each with its time) and the one voiceover line heard over them. Read only those images, in order, as one sequence: consecutive moments of the same frame, the first of each shot just after a cut.',
  'For each frame answer: who the named character is (the one the line is about, as you would point at it: what it is, where it stands, what it wears), or "cannot tell";',
  'what action happened across the stills, and whether it matches the voiceover line (yes, partly or no, and why);',
  'whether any cut between two consecutive stills felt like a jump (the same view barely moved or only zoomed, a character jumping place, a thing appearing or vanishing) and between which times;',
  'anything floating (not standing on or held by something), faceless (a character with no face; a character seen from behind is not faceless), cut off at the frame edge, too small to read, or crowded (more than three characters fighting for attention, or one hiding another);',
  'where it seems to be (a place a stranger would name, or "no clear place"); and, when the frame shows the real technology (glass panels, chips, screens, diagrams), whether it shows the idea moving (something visibly travels, changes, fills or is compared) or only labels it with words and boxes.',
  'List every object you can name in the frame, as specifically as you can (say "a chef\'s knife", not "a knife", only when you can tell).',
  'Never guess what the video is about and never assume an object is something it does not clearly look like; call anything you cannot name at a glance an "unclear shape" and describe it.',
  'Reply with JSON only, one entry per frame: [{"frame": "<id>", "stills": ["0.15s", "2.40s"], "named_character": "...", "action": "...", "matches_line": "yes|partly|no", "why": "...", "jump_cuts": [{"between": ["2.40s", "4.10s"], "why": "..."}], "floating": [], "faceless": [], "cut_off": [], "crowded": "", "place": "...", "tech_moves": "moves|only_labels|not_tech", "objects": [], "unclear": []}].',
].join(' ');

/**
 * The first-time-viewer tests (EX3-101, EX3-108): a subagent with no context reads only what a
 * viewer meets, and says what it understood. Two files: the gap test (the first seconds, beats
 * 1–2) and the reel test (the whole reel, beat by beat, Lucas 2026-10-21: "The comprehension check
 * needs to be more intelligently instructed and it should cover beats 3-8. That should also check
 * that the example's answer is unambiguous to a person"). Sonnet 5.5 plays the stranger (Lucas's
 * pick, 2026-10-21): Haiku passed both attention reels' gap tests. Read only.
 */
export const FIRST_VIEWER_AGENT = 'first-viewer';
export const FIRST_VIEWER_MODEL = 'claude-sonnet-5-5';
export const FIRST_VIEWER_PROMPT = [
  'You are a first-time viewer scrolling short videos on your phone: smart and curious, but not technical, and in a hurry.',
  'You have met only what the file your dispatch message names describes: what was on screen and what the voice said, in order. You know nothing else about the video.',
  'Read it once, in order, the way the video plays, and answer honestly as that stranger. Never use knowledge the file did not give you to fill a gap, and never be polite about confusion: if a line only makes sense once you already know the answer, it confused you.',
  'You hear the voice; you do not read it. Quote marks, symbols and spelling are invisible to you, so a word the voice only means as a word (a quoted "it") sounds like an ordinary word, and you report that as confusing.',
  'If the file holds only the first seconds (no "## Beat 3" heading), reply with JSON only: {"happening": "...", "puzzle": "...", "question": "...", "expect_to_learn": "...", "keep_watching": 1, "confused": ["..."]}: what is happening; what is puzzling about it, the thing you cannot explain; the question you are left with; what you expect to learn; would you keep watching, 1 to 5; anything that confused you or that you could not picture, or anything that sounded like a commercial-break toss ("stick around").',
  'If the file holds the whole video ("## Beat 1" to "## Beat 8"), answer beat by beat, then about the whole. For each beat: what you see and hear; what you think it means; what you just learned; who is who, and whether each character is the same one as before (same look, same role); anything confusing, or any word you could not follow by ear.',
  'Then: the concept explained in your own words, as you would to a friend; the worked example (the beat that says it is a real example): the answer it reaches, whether a reasonable person could reach a different answer from the same example and which one, and whether the example is a different thing from the opening scene or the same story retold; would you keep watching to the end, 1 to 5.',
  'Reply with JSON only: {"beats": [{"beat": 1, "see_and_hear": "...", "means": "...", "learned": "...", "characters": "...", "same_characters": true, "confused": ["..."]}], "concept_in_my_words": "...", "example_answer": "...", "example_ambiguous": false, "other_reading": "", "example_is_the_scene": false, "keep_watching": 1, "confused_overall": ["..."]}.',
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
  /** The legacy frame worker's model (`frame-worker`), and the fallback for the 4.1 roles below. */
  frameWorkerModel: string;
  /** Explainers 4.1 (settings scene_builder_model): the scene builder; frameWorkerModel when unset. */
  sceneBuilderModel?: string;
  /** Explainers 4.1 (scene_frame_model): frames 1, 4, 5 and a callback frame 7; frameWorkerModel when unset. */
  sceneFrameModel?: string;
  /** Explainers 4.1 (tech_frame_model): frames 2, 3, 6 and a glass frame 7; frameWorkerModel when unset. */
  techFrameModel?: string;
  /** Explainers 4.1 (picture_check_model): the sequence picture check; PICTURE_CHECKER_MODEL when unset. */
  pictureCheckModel?: string;
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
  const policyHook = async (hookInput: { tool_name?: string; tool_input?: unknown; agent_id?: string; agent_type?: string }) => {
    const tool = String(hookInput.tool_name ?? '');
    // agent_type names the subagent (agent_id is present only inside one); the main thread has none.
    const agentType = hookInput.agent_id ? hookInput.agent_type : undefined;
    const decision = checkToolCall(tool, (hookInput.tool_input ?? {}) as Record<string, unknown>, input.projectDir, agentType);
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
        description: "Builds the reel's anchor world once (assets/world/world.js with its SET and set, assets/world/identity.js, new objects in assets/world/new-props.js) from STORYBOARD.md's ## Anchor scene, and looks at stills of it.",
        prompt: SCENE_BUILDER_PROMPT,
        tools: SCENE_BUILDER_TOOLS,
        model: input.sceneBuilderModel ?? input.frameWorkerModel,
      },
      [SCENE_FRAME_WORKER_AGENT]: {
        description: 'Writes exactly one analogy-world frame (frame 1\'s hook 01-hook.js, 4, 5, or frame 7 when its storyboard block says anchor: scene) as assets/frames/<frame_id>.js from its role file and packet, and looks at stills of it.',
        prompt: SCENE_FRAME_WORKER_PROMPT,
        tools: SELF_REVIEW_TOOLS,
        model: input.sceneFrameModel ?? input.frameWorkerModel,
      },
      [TECH_FRAME_WORKER_AGENT]: {
        description: 'Writes exactly one real-tech frame (2, 3, 6, or frame 7 when its storyboard block says anchor: own) in glass as assets/frames/<frame_id>.js from its role file and packet, and looks at stills of it.',
        prompt: TECH_FRAME_WORKER_PROMPT,
        tools: SELF_REVIEW_TOOLS,
        model: input.techFrameModel ?? input.frameWorkerModel,
      },
      [FRAME_WORKER_AGENT]: {
        description: 'Legacy: writes exactly one frame scene module (assets/frames/<frame_id>.js) from its role file and packet. An Explainers 4.1 reel dispatches frame-worker-scene or frame-worker-tech instead.',
        prompt: FRAME_WORKER_PROMPT,
        tools: FRAME_WORKER_TOOLS,
        model: input.frameWorkerModel,
      },
      [PICTURE_CHECKER_AGENT]: {
        description: "Blind picture check: looks at each frame's shot stills in order with only its voiceover line, knowing nothing of the storyboard, and says what a stranger sees.",
        prompt: PICTURE_CHECKER_PROMPT,
        tools: PICTURE_CHECKER_TOOLS,
        model: input.pictureCheckModel ?? PICTURE_CHECKER_MODEL,
      },
      [FIRST_VIEWER_AGENT]: {
        description: "First-time-viewer test of the curiosity gap: says what a stranger understood from the reel's first seconds and whether they would keep watching.",
        prompt: FIRST_VIEWER_PROMPT,
        tools: PICTURE_CHECKER_TOOLS,
        model: FIRST_VIEWER_MODEL,
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
