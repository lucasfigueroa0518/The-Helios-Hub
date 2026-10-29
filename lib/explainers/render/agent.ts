import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkToolCall, FRAME_WORKER_TOOLS, SCENE_BUILDER_TOOLS, selfCheckBudget, SELF_CHECKS_PER_BUILDER, SELF_REVIEW_TOOLS, SESSION_TOOLS } from '@/lib/explainers/render/policy';
import type { SpendMeter } from '@/lib/explainers/render/meter';
import { DIAGNOSER_INSTRUCTIONS, READER_INSTRUCTIONS } from '@/lib/explainers/render/understanding';
import { findChrome, HYPERFRAMES_ENV, RUNTIME_DIR } from '@/lib/explainers/render/workspace';

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

/** Where every 4.2 role reads the craft, the house style and the minimums (CONTRACT-4.2 § The layers). */
const RECIPE = '.media/recipes/helios-explainer';

/** The self-review budget per frame (and for the world): snap.mjs MAX_CALLS refuses the next call. */
export const SNAPS_PER_FRAME = 4;

/**
 * How the scene builder and the frame builders look at their own work (Explainers 4.1; 4.2: against
 * the plan and the craft, at most two revisions, SNAPS_PER_FRAME snaps), by role: a frame builder
 * judges its shots against its packet, the scene builder its world against the anchor scene.
 */
/** The world's budget (cost lever L6): snap.mjs MAX_WORLD_CALLS. */
export const SNAPS_FOR_WORLD = 3;
/** One write per review round (cost lever L2): the edits a review finds land together. */
const BATCH = 'Apply every fix one review finds in a single Write of the whole file, never one Edit per fix.';

const selfReview = (what: string, judge: string, snaps = SNAPS_PER_FRAME) =>
  [
    `Look at your own work: the commands you may run are the ones named above, exactly, nothing before or after them. The snap prints JSON with the PNG paths it wrote; Read them and judge them as a stranger on a phone would: ${judge}`,
    `Snap once your ${what} is written, fix what fails, and snap again to check each fix: at most ${snaps} snaps (${snaps === 3 ? 'a first look, one revision, a last look' : 'a first look, two revisions, a last look'}; snap.mjs refuses one more, and a call whose module threw does not count), so at most ${snaps - 2} revision${snaps - 2 === 1 ? '' : 's'}. ${BATCH}`,
  ].join(' ');
const FRAME_SELF_REVIEW = selfReview('module', 'does each shot show what your packet planned for it and why, and does it hold up against the craft you read?');
const WORLD_SELF_REVIEW = selfReview(
  'world',
  "does each place, the cast or hero object, and the light read the way STORYBOARD.md's ## Visual arc and ## Anchor scene plan them, and do they hold up against the craft you read?",
  SNAPS_FOR_WORLD,
);

/**
 * The stable instruction stack every builder shares (cost lever L4/L5, Lucas 2026-10-28): craft,
 * house style, minimums, frame.md and the kit reference, inlined in this fixed order at the head of
 * each builder's system prompt, so one cache write per reel serves the scene builder and every frame
 * builder, and nobody Reads them again (ends the duplicate absolute/relative reads). Missing files are
 * left out (an older job, Real Case).
 */
export const STACK_FILES = [`${RECIPE}/craft.md`, `${RECIPE}/house-style.md`, `${RECIPE}/minimums.md`, 'frame.md', 'assets/kit/KIT-REFERENCE.md'] as const;

export function instructionStack(projectDir: string): string {
  const parts = STACK_FILES.flatMap((rel) => {
    try {
      return [`<file path="${rel}">\n${fs.readFileSync(path.join(projectDir, rel), 'utf8').trim()}\n</file>`];
    } catch {
      return [];
    }
  });
  return parts.length ? `These files are already here, in full: never Read them.\n\n${parts.join('\n\n')}\n\n---\n\n` : '';
}

/** The legacy frame worker (3.x/4.0, no self-review). Real Case dispatches it and overrides its prompt. */
export const FRAME_WORKER_AGENT = 'frame-worker';
const FRAME_WORKER_PROMPT = [
  'You are a frame worker for one Helios Explainer Reel frame (Explainers 4.0: soft 3D, glass and gloss for the real tech).',
  'Your dispatch message gives your role file (.hyperframes/frame-packets/_role.md) and your frame packet.',
    "Read both first, then frame.md, your timing file, and only your frame's part of the kit that _role.md lists; read each kit file's header and the doc comments of what you call, never outfits.js or internals. Follow them exactly.",
  'A shot is only a camera: draw the same scene, with every critter, in every shot. Text inside a shape is textBox().',
  'Write only your assigned assets/frames/<frame_id>.js, its .events.json, and, when the frame draws an object of its own, its .props.js (NEW_PROPS, EX3-114). Never write compositions, never edit STORYBOARD.md or world.js, never run commands, never ask questions.',
].join(' ');

/**
 * Explainers 4.2 frame builders, one process for every frame, chosen by the frame's `look:` in
 * STORYBOARD.md (CONTRACT-4.2 § Agents and models; never by frame number): `world` and `blend` go to
 * the scene builder kind (it has the tools for both), `mechanism` to the tech kind. Both run on
 * frame_worker_model and look at stills of their own frame before handing back.
 */
export const SCENE_FRAME_WORKER_AGENT = 'frame-worker-scene';
export const TECH_FRAME_WORKER_AGENT = 'frame-worker-tech';
export type FrameLook = 'world' | 'mechanism' | 'blend';
export const FRAME_LOOKS: readonly FrameLook[] = ['world', 'mechanism', 'blend'];

/** The frame builder for a storyboard `look`: world and blend → frame-worker-scene, mechanism → frame-worker-tech. */
export function frameWorkerForLook(look: FrameLook): typeof SCENE_FRAME_WORKER_AGENT | typeof TECH_FRAME_WORKER_AGENT {
  return look === 'mechanism' ? TECH_FRAME_WORKER_AGENT : SCENE_FRAME_WORKER_AGENT;
}

/**
 * Each `## Frame <n>` block's `- look:` (world | mechanism | blend), by frame number. A frame with no
 * look, or an unknown one, is left out (frame 8, the kit's close, has none).
 */
export function storyboardLooks(storyboard: string): Map<number, FrameLook> {
  const looks = new Map<number, FrameLook>();
  let frame: number | null = null;
  for (const line of storyboard.split('\n')) {
    const head = /^##\s+Frame\s+(\d+)\b/i.exec(line);
    if (head) {
      frame = Number(head[1]);
      continue;
    }
    if (/^##\s/.test(line)) {
      frame = null;
      continue;
    }
    const m = /^\s*-\s*look:\s*([a-z]+)\b/i.exec(line);
    if (frame !== null && m && (FRAME_LOOKS as readonly string[]).includes(m[1].toLowerCase()) && !looks.has(frame)) {
      looks.set(frame, m[1].toLowerCase() as FrameLook);
    }
  }
  return looks;
}

/** What a builder hands back (SubagentHandback), so the orchestrator can act on it without reading the module. */
const FRAME_HANDBACK =
  'Hand back one short report: the files you wrote; each snap (its times) and what you changed after it; what the frame shows at each shot change, in one line each; and anything you could not fix, or any kit part you could not use, with why.';
const FRAME_SNAP = 'Your commands: `node assets/kit/snap.mjs <your frame id> <t1,t2,…>` (up to six times in seconds into your frame, e.g. at each shot change and the end; frame 1\'s hook is `01-hook`), and the self-check below.';
/**
 * The builders' self-check (cost fix 2026-10-28): the breakage check code will hold their work to,
 * run inside their own session before they hand back (policy.ts SELF_CHECK_COMMAND, at most
 * SELF_CHECKS_PER_BUILDER runs), so the orchestrator's fix round only gets what is left. The rules
 * themselves live in frame.md § The build checks and minimums.md § Jump cuts: pointed at, not repeated.
 */
const selfCheck = (command: string) =>
  `Before you hand back, run the breakage check on your own work: \`${command}\`. It prints JSON; its errors are what code holds your work to (frame.md § The build checks, already above), so build to that section from the start. Fix every error it reports in one write and run it once more: at most ${SELF_CHECKS_PER_BUILDER} runs. It never judges taste; your snaps do.`;
const FRAME_SELF_CHECK = selfCheck('node assets/kit/try.mjs frame <your frame id>');
const WORLD_SELF_CHECK = selfCheck('node assets/kit/try.mjs world` and then `node assets/kit/try.mjs props');
const FRAME_WORKER_CORE = [
  'Your dispatch message gives your role file (.hyperframes/frame-packets/_role.md) and your frame packet.',
  `craft.md §§ 1–6 and 8–11, house-style.md, minimums.md, frame.md and the kit reference are above in your instructions: never Read them. Your role file and your packet come in your dispatch message, inline or by path (Read them only when given by path); Read your timing file. Start from the kit reference; Read or Grep kit source (assets/kit) when the reference does not explain what you need. Follow them.`,
  'Write only your assigned assets/frames/<frame_id>.js, its .events.json, and, when the frame draws an object of its own, its .props.js (NEW_PROPS, EX3-114). Never write compositions, never edit STORYBOARD.md or anything in assets/world/, never ask questions.',
];
const SCENE_FRAME_WORKER_PROMPT = [
  "You are a frame builder for one frame of a Helios Explainer Reel (Explainers 4.2) whose storyboard `look` is `world` or `blend`: the analogy's world through the lens camera, and in a blend the real mechanism's objects with it, shot by shot as the director planned.",
  ...FRAME_WORKER_CORE,
  FRAME_SNAP,
  FRAME_SELF_REVIEW,
  FRAME_SELF_CHECK,
  FRAME_HANDBACK,
].join(' ');
const TECH_FRAME_WORKER_PROMPT = [
  "You are a frame builder for one frame of a Helios Explainer Reel (Explainers 4.2) whose storyboard `look` is `mechanism`: the real mechanism, shot by shot as the director planned. Name the mechanism and how it best shows on screen (it may travel, split, combine, change state, be compared before and after, grow or shrink, or do whatever this mechanism does; craft.md § 10), and draw it with its real things as objects.",
  ...FRAME_WORKER_CORE,
  FRAME_SNAP,
  FRAME_SELF_REVIEW,
  FRAME_SELF_CHECK,
  FRAME_HANDBACK,
].join(' ');

export const SCENE_BUILDER_AGENT = 'scene-builder';
const SCENE_BUILDER_PROMPT = [
  "You are the scene builder for one Helios Explainer Reel (Explainers 4.2): you build the reel's world once, as STORYBOARD.md's ## Anchor scene and ## Visual arc plan it: its places (interiors and exteriors, and the journeys between them), its cast or hero object, its colour script, and the reel's concept identity map.",
  `craft.md §§ 1, 2, 4, 5, 6, 8 and 9, house-style.md, minimums.md, frame.md and the kit reference are above in your instructions: never Read them. Read .claude/skills/helios-explainer-director/scene-builder.md and STORYBOARD.md. Start from the kit reference; Read or Grep kit source (assets/kit) when the reference does not explain what you need. Follow them.`,
  'Write the world in two or three whole-file writes (world.js, identity.js, new-props.js), never a run of small edits. Write only assets/world/world.js, assets/world/identity.js (explain.js identity()) and assets/world/new-props.js (every object drawn new, NEW_PROPS with full tags, EX3-114). Never edit STORYBOARD.md, never write frames, never ask questions.',
  'Your commands: `node assets/kit/snap.mjs world` (stills of your places through world.js VIEWS, or two eye-level views), and the self-check below.',
  WORLD_SELF_REVIEW,
  WORLD_SELF_CHECK,
  'Hand back one short report: the files you wrote; the places, the cast or hero object, and the colour script you built; each snap and what you changed after it; any object you could not build as planned, what you drew instead and why; and anything you could not fix.',
].join(' ');

/**
 * The picture check (EX3-84; Explainers 4.1: required, with vision, over shot sequences; 4.2: the
 * viewer's read only). A subagent with no storyboard context looks at each frame's stills in play order
 * (snap.mjs sequences: one just after each cut, one at the end) with only the voiceover line said over
 * them, so the orchestrator's knowledge of what each thing is meant to be cannot make it "see" it. It
 * is blind on purpose: it reads no recipe file. It answers what only a viewer can: what the line is
 * about, whether the voiced action shows, whether a cut is felt as a jump, whether a mechanism can be
 * followed, and whether the whole reads as one film with one look per thing; plus anything floating
 * (held by nothing, resting on nothing), which code cannot see in general. Other breakage (cut faces,
 * text size, things off screen, cuts that barely change size) is code's (try.mjs, bounds.mjs), never
 * re-judged here (PLAN turn 17: no check repeats another's job). Read only. Its model is the
 * picture_check_model setting (Sonnet); a session that names none (Real Case) keeps the legacy Haiku
 * contact-sheet check. A missing .hyperframes/picture-check.json is a warning on the reel (job.ts).
 */
export const PICTURE_CHECKER_AGENT = 'picture-checker';
/** The picture checker's model when the session names none (the legacy contact-sheet check). */
export const PICTURE_CHECKER_MODEL = 'claude-haiku-5-5';
export const PICTURE_CHECKER_TOOLS = ['Read', 'SubagentHandback'];
/**
 * Where the orchestrator writes the picture check (collect reads it): the checker's reply
 * `{ "frames": [ …per-frame entries… ], "reel": { … } }` plus `"assets": [ { name, file, meant, seen,
 * pass } ]`, one asset row per new drawing (NEW_PROPS), `seen` in the checker's words from its
 * `objects`; a passing row joins the asset bank (bank.ts, EX3-114). A bare per-frame array is read too
 * (no reel answer, no assets: nothing is banked).
 */
export const PICTURE_CHECK_FILE = '.hyperframes/picture-check.json';
/**
 * The checker's questions and reply shape, shared by the agent (PICTURE_CHECKER_PROMPT) and the
 * worker's one direct vision call over contact grids (picture.ts, cost fix 2026-10-28): only how the
 * stills arrive differs.
 */
export const PICTURE_CHECK_VIEWER = 'You look at stills from a short animated video as a stranger on a phone who does not know what they are meant to show. You give the viewer\'s read, not a defect list: code already checks what is broken (faces, text size, things off screen, cuts that barely change), so say only what you perceive as a viewer, and one thing code cannot see: anything floating.';
export const PICTURE_CHECK_QUESTIONS = [
  'For each frame answer: the main subject the line is about (a character or a thing), as you would point at it, or "cannot tell";',
  'what happened across the stills, and whether it shows what the line says (yes, partly or no, and why);',
  'any cut you felt as a jump: the same thing seen from about the same spot at about the same size, a character jumping place, or a thing appearing or vanishing, and between which times. A much closer or much wider view of the same thing from the same spot is a normal cut, never a jump;',
  'anything floating: held by nothing, or not resting on anything, when it should be (each thing, and when);',
  'where it seems to be (a place a stranger would name, or "no clear place"); and, when the frame shows how something real works (devices, objects, a diagram), what you think happens, in one plain sentence, and whether you could follow it (clear or unclear).',
  'List every object you can name in the frame, as specifically as you can tell (the kind of thing, not only its family).',
  'Then, about the whole video: does it feel like one film (yes, partly or no, and why), and does anything look like a different thing in a later frame than it did earlier (each such thing, with its frames)?',
  'Never guess what the video is about and never assume an object is something it does not clearly look like; call anything you cannot name at a glance an "unclear shape" and describe it.',
  'Reply with JSON only: {"frames": [{"frame": "<id>", "stills": ["0.15s", "2.40s"], "subject": "...", "action": "...", "matches_line": "yes|partly|no", "why": "...", "jump_cuts": [{"between": ["2.40s", "4.10s"], "why": "..."}], "floating": [], "place": "...", "mechanism": "clear|unclear|not_mechanism", "mechanism_seen": "...", "objects": [], "unclear": []}], "reel": {"one_film": "yes|partly|no", "why": "...", "changed_look": [{"thing": "...", "frames": ["<id>", "<id>"]}]}}.',
].join(' ');
export const PICTURE_CHECKER_PROMPT = [
  PICTURE_CHECK_VIEWER,
  'Your dispatch message names, per frame, a sequence of stills in play order (each with its time) and the one voiceover line heard over them. Read only those images, in order, as one sequence: consecutive moments of the same frame, the first of each shot just after a cut.',
  PICTURE_CHECK_QUESTIONS,
].join(' ');

/**
 * Explainers 4.3: the Explainer reel no longer runs it (no curiosity gap); the agent stays registered
 * for Real Case Reels, which override its prompt. The first-time-viewer gap test (EX3-101): a subagent with no context reads only what a viewer has
 * met by the end of beat 2 (.hyperframes/gap-test.md) and says what it understood. Sonnet 5.5 plays the
 * stranger (Lucas's pick, 2026-10-21). Read only. Explainers 4.2: the whole-reel test is code's (the
 * two readers, understanding.ts), so the director runs only this one. Real Case overrides the prompt
 * with its own first viewer (lib/real-case/render/agents.ts).
 */
export const FIRST_VIEWER_AGENT = 'first-viewer';
export const FIRST_VIEWER_MODEL = 'claude-sonnet-5-5';
export const FIRST_VIEWER_PROMPT = [
  'You are a first-time viewer scrolling short videos on your phone: smart and curious, but not technical, and in a hurry.',
  'You have met only what the file your dispatch message names describes: what was on screen and what the voice said, in order. You know nothing else about the video.',
  'Read it once, in order, the way the video plays, and answer honestly as that stranger. Never use knowledge the file did not give you to fill a gap, and never be polite about confusion: if a line only makes sense once you already know the answer, it confused you.',
  'You hear the voice; you do not read it. Quote marks, symbols and spelling are invisible to you, so a word the voice only means as a word (a quoted "it") sounds like an ordinary word, and you report that as confusing.',
  'Reply with JSON only: {"happening": "...", "puzzle": "...", "question": "...", "expect_to_learn": "...", "keep_watching": 1, "confused": ["..."]}: what is happening; what is puzzling about it, the thing you cannot explain; the question you are left with; what you expect to learn; would you keep watching, 1 to 5; anything that confused you or that you could not picture, or anything that sounded like a commercial-break toss ("stick around").',
].join(' ');

/**
 * The understanding test's readers and diagnosis (Explainers 4.2, UNDERSTANDING.md): run by the
 * worker as direct Messages API calls on reader_model, never dispatched by the director, with no
 * tools. The names are listed here so the policy treats them as read-only if anything ever does.
 */
export const READER_AGENT = 'reader';
export const DIAGNOSER_AGENT = 'diagnoser';

export type MainAgent = 'reader' | 'diagnoser' | 'picture-checker' | typeof SCENE_BUILDER_AGENT | typeof SCENE_FRAME_WORKER_AGENT | typeof TECH_FRAME_WORKER_AGENT;

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
  /**
   * Every frame builder (settings frame_worker_model): the legacy `frame-worker` and Explainers 4.2's
   * `frame-worker-scene` and `frame-worker-tech`; the scene builder's fallback.
   */
  frameWorkerModel: string;
  /** Explainers 4.3 (settings tech_frame_worker_model): the `look: mechanism` builder (frame-worker-tech); frameWorkerModel when unset. */
  techFrameWorkerModel?: string;
  /** Explainers 4.1 (settings scene_builder_model): the scene builder; frameWorkerModel when unset. */
  sceneBuilderModel?: string;
  /** Explainers 4.1 (picture_check_model): the sequence picture check; PICTURE_CHECKER_MODEL when unset. */
  pictureCheckModel?: string;
  /** Explainers 4.2 (reader_model): the `reader` and `diagnoser` agents; FIRST_VIEWER_MODEL when unset. */
  readerModel?: string;
  /**
   * Run the main thread as this agent (SDK `agent`): the understanding test's readers and diagnosis,
   * the legacy picture check, and the picture fix's per-frame builders (job.ts runPictureCheck).
   */
  mainAgent?: MainAgent;
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
    // The job's HOME has no browser when `hyperframes browser ensure` did not fill it (job b5488742:
    // every builder's snap said "no headless Chrome found" and their fixes went blind). The kit's
    // findChrome reads HELIOS_CHROME first; snap and bounds run outside the OS sandbox.
    ...(chromeFor(input.homeDir) ? { HELIOS_CHROME: chromeFor(input.homeDir)! } : {}),
    // The OS sandbox reaches the network only through its proxy (HTTP(S)_PROXY);
    // Node's fetch ignores those unless this is set, and every HeyGen call fails.
    NODE_USE_ENV_PROXY: '1',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'helios-explainers/1.0',
    ...HYPERFRAMES_ENV,
  };
}

/** The headless Chrome the kit should use: the job's own, else the worker's (the host user's cache). */
function chromeFor(homeDir: string): string | null {
  return findChrome([homeDir, process.env.HOME ?? ''].filter(Boolean));
}

export function sessionOptions(input: SessionInput, abort: AbortController, onDenied: (tool: string, reason: string) => void): Record<string, unknown> {
  // Each builder's self-check runs, by agent_id (the main thread's own key when it is the builder).
  const selfChecks = new Map<string, number>();
  const policyHook = async (hookInput: { tool_name?: string; tool_input?: unknown; agent_id?: string; agent_type?: string }) => {
    const tool = String(hookInput.tool_name ?? '');
    // agent_type names the subagent (agent_id is present only inside one); the main thread has none.
    const agentType = hookInput.agent_id ? hookInput.agent_type : input.mainAgent;
    const toolInput = (hookInput.tool_input ?? {}) as Record<string, unknown>;
    let decision = checkToolCall(tool, toolInput, input.projectDir, agentType);
    const key = hookInput.agent_id ?? `main:${agentType ?? ''}`;
    if (decision.allow && tool === 'Bash') decision = selfCheckBudget(selfChecks, key, String(toolInput.command ?? ''));
    if (decision.allow) {
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
    }
    onDenied(tool, decision.reason);
    return {
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason },
    };
  };
  const stack = instructionStack(input.projectDir);
  return {
    cwd: input.projectDir,
    model: input.model,
    env: scrubbedEnv(input),
    tools: SESSION_TOOLS,
    settingSources: ['project'],
    skills: 'all',
    agents: {
      [SCENE_BUILDER_AGENT]: {
        description: "Builds the reel's world once (assets/world/world.js with its places and cast, assets/world/identity.js, new objects in assets/world/new-props.js) from STORYBOARD.md's ## Visual arc and ## Anchor scene, and looks at stills of it.",
        prompt: `${stack}${SCENE_BUILDER_PROMPT}`,
        tools: SCENE_BUILDER_TOOLS,
        model: input.sceneBuilderModel ?? input.frameWorkerModel,
      },
      [SCENE_FRAME_WORKER_AGENT]: {
        description: "Writes exactly one frame whose STORYBOARD.md block says `look: world` or `look: blend` (frame 1's hook is 01-hook.js) as assets/frames/<frame_id>.js from its role file and packet, and looks at stills of it.",
        prompt: `${stack}${SCENE_FRAME_WORKER_PROMPT}`,
        tools: SELF_REVIEW_TOOLS,
        model: input.frameWorkerModel,
      },
      [TECH_FRAME_WORKER_AGENT]: {
        description: 'Writes exactly one frame whose STORYBOARD.md block says `look: mechanism` as assets/frames/<frame_id>.js from its role file and packet, and looks at stills of it.',
        prompt: `${stack}${TECH_FRAME_WORKER_PROMPT}`,
        tools: SELF_REVIEW_TOOLS,
        model: input.techFrameWorkerModel ?? input.frameWorkerModel,
      },
      [FRAME_WORKER_AGENT]: {
        description: 'Legacy: writes exactly one frame scene module (assets/frames/<frame_id>.js) from its role file and packet. An Explainers 4.2 reel dispatches frame-worker-scene or frame-worker-tech instead, by each frame\'s look.',
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
      [READER_AGENT]: {
        description: "Understanding test reader: reads the reel test file it is given and answers the per-beat notes and the eleven probes from what the video says, in JSON.",
        prompt: READER_INSTRUCTIONS,
        tools: PICTURE_CHECKER_TOOLS,
        model: input.readerModel ?? FIRST_VIEWER_MODEL,
      },
      [DIAGNOSER_AGENT]: {
        description: 'Understanding test diagnosis: reads the findings file it is given and names, per serious finding, the first beat that went wrong and its cause, in JSON.',
        prompt: DIAGNOSER_INSTRUCTIONS,
        tools: PICTURE_CHECKER_TOOLS,
        model: input.readerModel ?? FIRST_VIEWER_MODEL,
      },
      // 4.3: the Explainer director no longer dispatches it (no curiosity gap); Real Case Reels
      // still do, with their own prompt (lib/real-case/render/agents.ts overrides this entry).
      [FIRST_VIEWER_AGENT]: {
        description: "First-time-viewer test of the curiosity gap: says what a stranger understood from the reel's first seconds and whether they would keep watching.",
        prompt: FIRST_VIEWER_PROMPT,
        tools: PICTURE_CHECKER_TOOLS,
        model: FIRST_VIEWER_MODEL,
      },
    },
    ...(input.mainAgent ? { agent: input.mainAgent } : {}),
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
  // this session's own estimate on the shared meter (sessions may run in parallel)
  const meterKey = input.meter.begin();
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
        input.meter.observe((message.message ?? {}) as Parameters<SpendMeter['observe']>[0], meterKey);
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
  const settled = result.subtype === 'incomplete' ? input.meter.estimateOf(meterKey) : result.totalCostUsd;
  result.totalCostUsd = settled;
  input.meter.settleSession(settled, meterKey);
  return result;
}

/** The real SDK, loaded from explainers/runtime. */
export async function loadAgentQuery(): Promise<AgentQuery> {
  const entry = path.join(RUNTIME_DIR, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs');
  if (!fs.existsSync(entry)) throw new Error('Agent SDK missing: run `npm install` in explainers/runtime');
  const sdk = (await import(pathToFileURL(entry).href)) as { query: AgentQuery };
  return sdk.query;
}
