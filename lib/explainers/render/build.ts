/**
 * The build, run by code (cost fix 1, 2026-10-28; settings.build_runner 'code', the default).
 *
 * Session B used to be a Sonnet orchestrator that ran the faceless-explainer workflow's Steps 3.1, 5
 * and 6 (explainers/skill-overrides/faceless-explainer/SKILL.md) as an agent: about 40% of a reel's
 * spend, for work that is all mechanical. This runs the same commands in the same order, dispatches
 * the same builders (each its own agent session, as the main thread: SCENE_BUILDER_AGENT,
 * frame-worker-scene, frame-worker-tech) with the same messages, and gives every check the same one
 * fix round. Everything fails open: what is left is in `notes` (session B's "last message"), and the
 * job's collect pass turns every check's leftovers into the same reel warnings as before.
 *
 * The only differences from the orchestrator: a builder's role file and packet are inlined in its
 * message (identical content, no Read), and the builders' world requests come back as a fixed line
 * (`WORLD REQUEST: …`, frame-worker.md § Acting) that code parses.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  frameWorkerForLook,
  SCENE_BUILDER_AGENT,
  SCENE_FRAME_WORKER_AGENT,
  storyboardLooks,
  TECH_FRAME_WORKER_AGENT,
  type SessionResult,
} from '@/lib/explainers/render/agent';
import { HYPERFRAMES_BIN } from '@/lib/explainers/render/workspace';
import { blockingFor } from '../../../explainers/world-kit/blocking.js';

export type BuilderAgent = typeof SCENE_BUILDER_AGENT | typeof SCENE_FRAME_WORKER_AGENT | typeof TECH_FRAME_WORKER_AGENT;
export type CmdResult = { status: number | null; stdout: string; stderr: string };
/** Runs one command from the project root: `node <script> …args` or `hyperframes …args`. */
export type Exec = (program: 'node' | 'hyperframes', args: string[], timeoutMs?: number) => CmdResult;

export type BuildDeps = {
  projectDir: string;
  /** The voice the narration must use ($HELIOS_VOICE_ID); empty stops the build, as the workflow says. */
  voiceId: string;
  /** One builder session (the caller picks its model and records its cost); null when it threw. */
  dispatch: (agent: BuilderAgent, prompt: string) => Promise<SessionResult | null>;
  /** True once the job's spend cap is reached: no more dispatches. */
  overCap: () => boolean;
  log: (event: string, data?: Record<string, unknown>) => void;
  exec?: Exec;
  /** A resumed build (RESUME_PROMPT): keep what is on disk, do only what is missing. */
  resume?: { note?: string };
};

export type BuildOutcome = { capped: boolean; stopped: boolean; notes: string[]; dispatches: number };

const SKILL_SCRIPTS = path.join('.claude', 'skills', 'faceless-explainer', 'scripts');
const PACKETS = path.join('.hyperframes', 'frame-packets');
/** Frames code builds itself (the hand-off, frame 3; the close, frame 8): never dispatched. */
const CODE_FRAMES = new Set([3, 8]);
/** The frames a builder writes. */
export const BUILDER_FRAMES = [1, 2, 4, 5, 6, 7] as const;
/** "When a frame has several dropped events": two or more (what the orchestrator acted on). */
export const DROPPED_EVENTS_THRESHOLD = 2;

export const SCENE_BUILDER_MESSAGE = "Build the reel's world. Read .claude/skills/helios-explainer-director/scene-builder.md and follow it. Final report: 10 lines max.";
const FRAME_REPORT = 'Final report: 8 lines max, including anything you could not fix.';
/** The fixed line a builder ends its report with to ask for a pose, a state or a view (frame-worker.md § Acting). */
export const WORLD_REQUEST = /^\s*[-*]?\s*`?WORLD REQUEST:\s*(.+?)`?\s*$/gim;

/** The default command runner: node scripts with this Node, hyperframes from the pinned CLI. */
export function defaultExec(projectDir: string, env: Record<string, string>): Exec {
  return (program, args, timeoutMs = 10 * 60 * 1000) => {
    const bin = program === 'node' ? process.execPath : HYPERFRAMES_BIN;
    const res = spawnSync(bin, args, { cwd: projectDir, env: env as NodeJS.ProcessEnv, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? (res.error ? String(res.error) : '') };
  };
}

/** The JSON a kit script printed (its last JSON object), or null. */
export function jsonOut(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf('{');
    if (start < 0) return null;
    try {
      return JSON.parse(text.slice(start)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
const okOf = (r: CmdResult) => r.status === 0 && jsonOut(r.stdout)?.ok !== false;
const tail = (r: CmdResult) => (r.stderr || r.stdout || '').trim().slice(-600);
const errorsOf = (r: CmdResult): string[] => {
  const j = jsonOut(r.stdout);
  if (j && Array.isArray(j.errors)) return j.errors.map(String);
  return r.status === 0 ? [] : [tail(r) || `exited ${r.status}`];
};

/** The number a frame id, file or message starts with (`05-payoff`, `compositions/frames/05-payoff.html`), or null. */
export function frameNumberOf(text: string): number | null {
  const m = /(?:^|[\s/"'(#])f?0?(\d)-[a-z]/i.exec(text) ?? /^0?(\d)-/.exec(text);
  return m ? Number(m[1]) : null;
}

/** Errors grouped by frame number (an error naming no frame is under 0). */
export function byFrame(errors: string[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const e of errors) {
    const n = frameNumberOf(e) ?? 0;
    out.set(n, [...(out.get(n) ?? []), e]);
  }
  return out;
}

/** try.mjs's errors as lines (its problems when it printed them, else its errors). */
export function tryErrors(r: CmdResult): string[] {
  const j = jsonOut(r.stdout);
  if (j && Array.isArray(j.problems) && j.problems.length) {
    return j.problems.map((p) => {
      const x = (p ?? {}) as { frame?: unknown; message?: unknown };
      return `${x.frame ? `${String(x.frame)}: ` : ''}${String(x.message ?? '')}`;
    });
  }
  return errorsOf(r);
}

/** The world requests in a builder's report (WORLD_REQUEST lines). */
export function worldRequests(report: string): string[] {
  return [...report.matchAll(WORLD_REQUEST)].map((m) => m[1].trim()).filter(Boolean);
}

/** The frame ids by number, from the packets frame-packets.mjs wrote (`02-define.md` → 2: '02-define'). */
export function packetIds(projectDir: string): Map<number, string> {
  const dir = path.join(projectDir, PACKETS);
  const ids = new Map<number, string>();
  if (!fs.existsSync(dir)) return ids;
  for (const f of fs.readdirSync(dir).sort()) {
    const m = /^(\d+)-[^.]+\.md$/.exec(f);
    if (m && !ids.has(Number(m[1]))) ids.set(Number(m[1]), f.replace(/\.md$/, ''));
  }
  return ids;
}

/** A frame's own module id: frame 1's builder writes the hook (01-hook.js); code owns 01-opener.js. */
export const moduleId = (n: number, id: string) => (n === 1 ? '01-hook' : id);

/** A frame's slice of assets/world/blocking.json (the scene builder's), as JSON text; null when there is none. */
export function blockingSlice(projectDir: string, id: string): string | null {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'world', 'blocking.json'), 'utf8'));
    const slice = blockingFor(all, id);
    return Object.keys(slice).length ? JSON.stringify(slice, null, 1) : null;
  } catch {
    return null;
  }
}

/** The message a frame builder gets: its role file and packet inline (identical content, no Read), its blocking, then the task. */
export function builderMessage(projectDir: string, id: string, task = ''): string {
  const read = (f: string) => {
    try {
      return fs.readFileSync(path.join(projectDir, PACKETS, f), 'utf8').trim();
    } catch {
      return null;
    }
  };
  const role = read('_role.md');
  const packet = read(`${id}.md`);
  const blocking = blockingSlice(projectDir, id);
  if (role === null || packet === null) {
    // fail open: the orchestrator's message, by path
    return [`Read .hyperframes/frame-packets/_role.md and your packet .hyperframes/frame-packets/${id}.md, and follow them.`, task, FRAME_REPORT].filter(Boolean).join(' ');
  }
  return [
    `Your role file (.hyperframes/frame-packets/_role.md) and your packet (.hyperframes/frame-packets/${id}.md) are below, complete: never Read them. Follow them.`,
    '',
    '<role_file path=".hyperframes/frame-packets/_role.md">',
    role,
    '</role_file>',
    '',
    `<packet path=".hyperframes/frame-packets/${id}.md">`,
    packet,
    '</packet>',
    '',
    ...(blocking ? [`<blocking path="assets/world/blocking.json" frame="${id}">`, blocking, '</blocking>', ''] : []),
    [task, FRAME_REPORT].filter(Boolean).join(' '),
  ].join('\n');
}

const list = (errors: string[]) => errors.map((e) => `- ${e}`).join('\n');

/** Every frame number whose module and events file exist. */
function moduleReady(projectDir: string, n: number, id: string): boolean {
  const base = path.join(projectDir, 'assets', 'frames', moduleId(n, id));
  return fs.existsSync(`${base}.js`) && fs.existsSync(`${base}.events.json`);
}

/** Frames named stale in a resume note: ids (`05-payoff`) or `frame 5`. */
export function staleFrames(note: string | undefined): Set<number> {
  const out = new Set<number>();
  for (const m of (note ?? '').matchAll(/\b0?([1-8])-[a-z][a-z0-9-]*/gi)) out.add(Number(m[1]));
  for (const m of (note ?? '').matchAll(/\bframes?\s+((?:\d\s*(?:,|and|&)?\s*)+)/gi)) for (const d of m[1].match(/\d/g) ?? []) out.add(Number(d));
  return out;
}

/** Mark each mounted frame `animated` in STORYBOARD.md (its `- status:` line). */
export function markAnimated(projectDir: string, ids: Map<number, string>): number[] {
  const file = path.join(projectDir, 'STORYBOARD.md');
  if (!fs.existsSync(file)) return [];
  const mounted = new Set([...ids].filter(([, id]) => fs.existsSync(path.join(projectDir, 'compositions', 'frames', `${id}.html`))).map(([n]) => n));
  let frame: number | null = null;
  const marked: number[] = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').map((line) => {
    const head = /^##\s+Frame\s+(\d+)\b/i.exec(line);
    if (head) frame = Number(head[1]);
    else if (/^##\s/.test(line)) frame = null;
    if (frame !== null && mounted.has(frame) && /^\s*-\s*status:\s*(?!animated\b)\S/.test(line)) {
      marked.push(frame);
      return line.replace(/status:\s*\S+/, 'status: animated');
    }
    return line;
  });
  fs.writeFileSync(file, lines.join('\n'));
  return marked;
}

/**
 * The finalize checks' failures that name a frame element, by frame number: `hyperframes lint --json`
 * findings and `hyperframes check --json` issues with severity error. A caption word's
 * text_box_overflow (#caption-word-*) is the known false positive and is never acted on.
 */
export function finalizeFailures(lintOut: string, checkOut: string): Map<number, string[]> {
  const found: string[] = [];
  const walk = (v: unknown, depth = 0) => {
    if (!v || typeof v !== 'object' || depth > 8) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    if (o.severity === 'error' && (o.message || o.code || o.rule)) {
      const text = JSON.stringify(o);
      if (/caption-word-/.test(text) && /text_box_overflow/.test(text)) return;
      found.push(`${String(o.code ?? o.rule ?? 'error')}: ${String(o.message ?? '')}${o.selector ? ` (${String(o.selector)})` : ''}${o.file ? ` [${String(o.file)}]` : ''}`);
      return;
    }
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  walk(jsonOut(lintOut));
  walk(jsonOut(checkOut));
  const out = byFrame(found);
  out.delete(0);
  return out;
}

/** Run Steps 3.1–6 (audio through finalize) as code. Never throws on a check; only the caller's cap stops dispatches. */
export async function runBuild(deps: BuildDeps): Promise<BuildOutcome> {
  const { projectDir, log } = deps;
  const exec = deps.exec ?? defaultExec(projectDir, process.env as Record<string, string>);
  const notes: string[] = [];
  const outcome: BuildOutcome = { capped: false, stopped: false, notes, dispatches: 0 };
  const node = (script: string, args: string[] = [], timeoutMs?: number) => {
    const r = exec('node', [script, ...args], timeoutMs);
    log('build_step', { step: [path.basename(script), ...args.filter((a) => !a.startsWith('./') && !a.startsWith('--'))].join(' '), status: r.status });
    return r;
  };
  const skill = (name: string) => path.join(SKILL_SCRIPTS, name);
  const kit = (name: string) => path.join('assets', 'kit', name);
  const resuming = Boolean(deps.resume);

  const dispatch = async (agent: BuilderAgent, prompt: string, label: string): Promise<SessionResult | null> => {
    if (deps.overCap()) {
      outcome.capped = true;
      log('build_dispatch_skipped', { label, reason: 'spend cap' });
      return null;
    }
    outcome.dispatches++;
    log('build_dispatch', { agent, label });
    try {
      const r = await deps.dispatch(agent, prompt);
      if (r?.capped) outcome.capped = true;
      return r;
    } catch (error) {
      log('build_dispatch_failed', { label, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };

  // ── Step 3.1: audio ───────────────────────────────────────────────────────────────────────────
  const metaFile = path.join(projectDir, 'audio_meta.json');
  if (!(resuming && fs.existsSync(metaFile))) {
    if (!deps.voiceId.trim()) {
      notes.push('HELIOS_VOICE_ID is empty: the voice was not generated and the build stopped (never another voice).');
      log('build_stopped', { reason: 'no voice id' });
      outcome.stopped = true;
      return outcome;
    }
    const audio = node(skill('audio.mjs'), ['--script', './SCRIPT.md', '--storyboard', './STORYBOARD.md', '--hyperframes', '.', '--out', './audio_meta.json', '--voice', deps.voiceId], 30 * 60 * 1000);
    if (audio.status !== 0 || !fs.existsSync(metaFile)) {
      notes.push(`audio.mjs failed, so nothing could be built: ${tail(audio)}`);
      log('build_stopped', { reason: 'audio failed' });
      outcome.stopped = true;
      return outcome;
    }
  }

  // ── Step 5.1: durations, pacing, music, the opener's sound ───────────────────────────────────
  const storyboardNow = () => fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8');
  const needsSync = !resuming || storyboardNow().split(/^##\s+Frame\s+\d+/im).slice(1).some((block) => !/voice_end/.test(block));
  if (needsSync) {
    const sync = node(skill('audio.mjs'), ['sync-durations', '--audio-meta', './audio_meta.json', '--storyboard', './STORYBOARD.md']);
    if (sync.status !== 0) notes.push(`audio.mjs sync-durations: ${tail(sync)}`);
  }
  const pace = node(kit('pace.mjs'));
  if (!okOf(pace)) notes.push(`pace.mjs did not print "ok": true: ${errorsOf(pace).join('; ') || tail(pace)}`);
  if (!(resuming && fs.existsSync(path.join(projectDir, 'assets', 'bgm', 'track.mp3')))) {
    let music = node(kit('music.mjs'));
    if (!okOf(music)) music = node(kit('music.mjs'));
    if (!okOf(music)) notes.push(`No music: music.mjs failed twice (${errorsOf(music).join('; ') || tail(music)}); the reel continues without it.`);
  }
  const opener = node(kit('opener-sfx.mjs'));
  if (!okOf(opener)) notes.push(`opener-sfx.mjs: ${errorsOf(opener).join('; ') || tail(opener)}`);

  // ── Step 5.2: packets ────────────────────────────────────────────────────────────────────────
  const packets = node(skill('frame-packets.mjs'), ['--project', '.', '--storyboard', './STORYBOARD.md']);
  if (packets.status !== 0) notes.push(`frame-packets.mjs: ${tail(packets)}`);
  const ids = packetIds(projectDir);

  // ── Step 5.3: the world first ────────────────────────────────────────────────────────────────
  const worldChecks = () => [...tryErrors(node(kit('try.mjs'), ['world'])), ...tryErrors(node(kit('try.mjs'), ['props']))];
  const keepWorld = resuming && fs.existsSync(path.join(projectDir, 'assets', 'world', 'world.js')) && worldChecks().length === 0;
  if (!keepWorld) {
    await dispatch(SCENE_BUILDER_AGENT, SCENE_BUILDER_MESSAGE, 'scene-builder');
    let left = worldChecks();
    if (left.length) {
      await dispatch(SCENE_BUILDER_AGENT, `${SCENE_BUILDER_MESSAGE.replace(' Final report: 10 lines max.', '')} The world checks (node assets/kit/try.mjs world, then props) still report these errors; fix each with the smallest edit in assets/world/, then hand back:\n${list(left)}\nFinal report: 10 lines max.`, 'scene-builder:fix');
      left = worldChecks();
      if (left.length) notes.push(`World checks left after the fix round:\n${list(left)}`);
    }
  }

  // ── Step 5.4: the frames, by look, in parallel ───────────────────────────────────────────────
  const looks = storyboardLooks(storyboardNow());
  const agentOf = (n: number): BuilderAgent => {
    const look = looks.get(n);
    return look ? frameWorkerForLook(look) : SCENE_FRAME_WORKER_AGENT;
  };
  const stale = staleFrames(deps.resume?.note);
  const frames = BUILDER_FRAMES.filter((n) => ids.has(n) && !CODE_FRAMES.has(n)).filter((n) => !resuming || stale.has(n) || !moduleReady(projectDir, n, ids.get(n)!));
  const reports = new Map<number, string>();
  const build = async (n: number, task = '', label = 'frame') => {
    const id = ids.get(n)!;
    const r = await dispatch(agentOf(n), builderMessage(projectDir, id, task), `${label}:${id}`);
    if (r?.lastText) reports.set(n, r.lastText);
    return r;
  };
  await Promise.all(frames.map((n) => build(n)));
  // a missing module or events file: that frame once more
  const missing = frames.filter((n) => !moduleReady(projectDir, n, ids.get(n)!));
  await Promise.all(missing.map((n) => build(n, `Your module assets/frames/${moduleId(n, ids.get(n)!)}.js or its events file is missing: write both.`, 'frame:missing')));
  for (const n of missing) if (!moduleReady(projectDir, n, ids.get(n)!)) notes.push(`Frame ${ids.get(n)}: its module or events file is still missing.`);

  // world requests: the scene builder once with all of them, the world check, then those builders again
  const requests = new Map<number, string[]>();
  for (const [n, report] of reports) {
    const asks = worldRequests(report);
    if (asks.length) requests.set(n, asks);
  }
  if (requests.size) {
    log('build_world_requests', { frames: [...requests.keys()] });
    const asked = [...requests].flatMap(([n, asks]) => asks.map((a) => `- ${ids.get(n)}: ${a}`)).join('\n');
    await dispatch(SCENE_BUILDER_AGENT, `The frame builders need these in the reel's world. Add each to assets/world/world.js (a pose, a state or a view), keeping everything that is there; read .claude/skills/helios-explainer-director/scene-builder.md only for what you need. Run your self-check, then hand back.\n${asked}\nFinal report: 10 lines max.`, 'scene-builder:requests');
    const left = tryErrors(node(kit('try.mjs'), ['world']));
    if (left.length) notes.push(`World check after the builders' requests:\n${list(left)}`);
    await Promise.all([...requests].map(([n, asks]) => build(n, `The scene builder added what you asked for to the world:\n${list(asks)}\nUse it in your frame, run your self-check, and hand back.`, 'frame:requests')));
  }

  // frame 3 (code's hand-off) again, now that frame 4 exists: its backdrop is frame 4's first shot
  const handoff = node(kit('pace.mjs'), ['handoff']);
  if (!okOf(handoff)) notes.push(`pace.mjs handoff: ${errorsOf(handoff).join('; ') || tail(handoff)}`);

  // ── Step 5.5: mount, try and bounds, one fix round ───────────────────────────────────────────
  const mountAll = () => {
    const m = node(kit('mount.mjs'));
    if (m.status !== 0) notes.push(`mount.mjs: ${errorsOf(m).join('; ') || tail(m)}`);
  };
  const buildChecks = () => ({ tried: byFrame(tryErrors(node(kit('try.mjs'), ['all']))), bounds: byFrame(errorsOf(node(kit('bounds.mjs'), ['all'], 5 * 60 * 1000))) });
  mountAll();
  let checks = buildChecks();
  const failing = (c: typeof checks) => [...new Set([...c.tried.keys(), ...c.bounds.keys()])].filter((n) => n > 0);
  const fixable = failing(checks).filter((n) => ids.has(n) && !CODE_FRAMES.has(n));
  if (fixable.length) {
    await Promise.all(
      fixable.map((n) => {
        const t = checks.tried.get(n) ?? [];
        const b = checks.bounds.get(n) ?? [];
        return build(n, `Your module assets/frames/${moduleId(n, ids.get(n)!)}.js has these build-check errors left. Fix each with the smallest edit, run your self-check, and hand back.\ntry.mjs:\n${t.length ? list(t) : '- none'}\nbounds.mjs:\n${b.length ? list(b) : '- none'}`, 'frame:checks');
      }),
    );
    for (const n of fixable) node(kit('mount.mjs'), [ids.get(n)!]);
    checks = buildChecks();
  }
  for (const n of failing(checks)) notes.push(`Frame ${ids.get(n) ?? n}: build checks left:\n${list([...(checks.tried.get(n) ?? []), ...(checks.bounds.get(n) ?? [])])}`);
  for (const e of [...(checks.tried.get(0) ?? []), ...(checks.bounds.get(0) ?? [])]) notes.push(`Build check: ${e}`);

  // ── Step 5.6: sound, and the dropped-events round ────────────────────────────────────────────
  const sound = () => {
    const r = node(kit('sound.mjs'));
    const j = jsonOut(r.stdout);
    const dropped = Array.isArray(j?.dropped) ? (j!.dropped as { frame?: unknown; event?: { what?: unknown; kind?: unknown }; why?: unknown }[]) : [];
    const per = new Map<number, string[]>();
    for (const d of dropped) {
      const n = frameNumberOf(String(d.frame ?? ''));
      if (n) per.set(n, [...(per.get(n) ?? []), `${String(d.event?.what ?? d.event?.kind ?? 'event')} (${String(d.why ?? 'dropped')})`]);
    }
    if (!okOf(r)) notes.push(`sound.mjs did not print "ok": true: ${errorsOf(r).join('; ') || tail(r)}`);
    return per;
  };
  let dropped = sound();
  const resound = [...dropped].filter(([n, ev]) => ev.length >= DROPPED_EVENTS_THRESHOLD && ids.has(n) && !CODE_FRAMES.has(n)).map(([n]) => n);
  if (resound.length) {
    await Promise.all(resound.map((n) => build(n, `Rewrite your events file assets/frames/${moduleId(n, ids.get(n)!)}.events.json: these events matched no sound:\n${list(dropped.get(n)!)}\nUse frame.md's foley words. Change nothing else.`, 'frame:sound')));
    dropped = sound();
  }
  for (const [n, ev] of dropped) if (ev.length >= DROPPED_EVENTS_THRESHOLD) notes.push(`Frame ${ids.get(n) ?? n}: sound events still dropped: ${ev.join('; ')}`);

  // ── Step 5.7–5.8: captions, assemble; mark the frames animated ───────────────────────────────
  const captions = node(skill('captions.mjs'), ['build', '--storyboard', './STORYBOARD.md', '--audio-meta', './audio_meta.json', '--hyperframes', '.', '--out', './caption_groups.json']);
  if (captions.status !== 0) notes.push(`captions.mjs: ${tail(captions)}`);
  const assemble = () => {
    const a = node(skill('assemble-index.mjs'), ['--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
    if (a.status !== 0) notes.push(`assemble-index.mjs: ${tail(a)}`);
  };
  assemble();
  markAnimated(projectDir, ids);

  // ── Step 6: finalize ─────────────────────────────────────────────────────────────────────────
  const inject = node(skill('transitions.mjs'), ['inject', '--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
  if (inject.status !== 0) notes.push(`transitions.mjs inject: ${tail(inject)}`);
  const verify = node(skill('transitions.mjs'), ['verify', '--storyboard', './STORYBOARD.md', '--index', './index.html']);
  if (verify.status !== 0) notes.push(`transitions.mjs verify: ${tail(verify)}`);
  const finalize = () => {
    const lint = exec('hyperframes', ['lint', '--json']);
    const check = exec('hyperframes', ['check', '--json'], 15 * 60 * 1000);
    log('build_step', { step: 'hyperframes lint+check', lint: lint.status, check: check.status });
    return finalizeFailures(lint.stdout, check.stdout);
  };
  let final = finalize();
  const refix = [...final.keys()].filter((n) => ids.has(n) && !CODE_FRAMES.has(n));
  if (refix.length) {
    await Promise.all(refix.map((n) => build(n, `HyperFrames' finalize checks report these failures on your frame's elements. Fix each with the smallest edit to assets/frames/${moduleId(n, ids.get(n)!)}.js, run your self-check, and hand back.\n${list(final.get(n)!)}`, 'frame:finalize')));
    for (const n of refix) node(kit('mount.mjs'), [ids.get(n)!]);
    final = finalize();
  }
  for (const [n, errs] of final) notes.push(`Frame ${ids.get(n) ?? n}: finalize checks left:\n${list(errs)}`);
  log('build_done', { dispatches: outcome.dispatches, capped: outcome.capped, notes: notes.length });
  return outcome;
}

/**
 * A code build that left frames unmounted (the repair session's job under the agent runner): each
 * missing builder frame's builder once more, then mount, sound, captions, assemble and transitions.
 */
export async function repairBuild(deps: BuildDeps, missing: readonly number[]): Promise<BuildOutcome> {
  const { projectDir, log } = deps;
  const exec = deps.exec ?? defaultExec(projectDir, process.env as Record<string, string>);
  const outcome: BuildOutcome = { capped: false, stopped: false, notes: [], dispatches: 0 };
  const ids = packetIds(projectDir);
  const looks = storyboardLooks(fs.existsSync(path.join(projectDir, 'STORYBOARD.md')) ? fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8') : '');
  const frames = missing.filter((n) => ids.has(n) && !CODE_FRAMES.has(n));
  await Promise.all(
    frames.map(async (n) => {
      if (deps.overCap()) {
        outcome.capped = true;
        return;
      }
      outcome.dispatches++;
      const look = looks.get(n);
      try {
        const r = await deps.dispatch(look ? frameWorkerForLook(look) : SCENE_FRAME_WORKER_AGENT, builderMessage(projectDir, ids.get(n)!, `Frame ${ids.get(n)} is missing from compositions/frames/: write your module and its events file.`));
        if (r?.capped) outcome.capped = true;
      } catch (error) {
        log('build_dispatch_failed', { label: `repair:${ids.get(n)}`, error: error instanceof Error ? error.message : String(error) });
      }
    }),
  );
  const run = (args: string[]) => exec('node', args);
  run([path.join('assets', 'kit', 'mount.mjs')]);
  run([path.join('assets', 'kit', 'sound.mjs')]);
  run([path.join(SKILL_SCRIPTS, 'captions.mjs'), 'build', '--storyboard', './STORYBOARD.md', '--audio-meta', './audio_meta.json', '--hyperframes', '.', '--out', './caption_groups.json']);
  run([path.join(SKILL_SCRIPTS, 'assemble-index.mjs'), '--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
  run([path.join(SKILL_SCRIPTS, 'transitions.mjs'), 'inject', '--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
  markAnimated(projectDir, ids);
  log('build_repaired', { frames, dispatches: outcome.dispatches });
  return outcome;
}
