/**
 * Explainers 4.1 pipeline plumbing, offline: the snap-only Bash for the scene builder and the frame
 * workers, the agent types and their models, the settings, the definition check against the
 * analogy's mapping (Jev stubbed), the picture check's findings, snap.mjs's arguments and quota, and
 * try.mjs's 4.1 checks (errors in a 4.1 job, warnings in an older one). No model, no browser, no
 * render, no network.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { frameWorkerForLook, PICTURE_CHECK_FILE, sessionOptions, storyboardLooks, UNSANDBOXED_HYPERFRAMES, type AgentQuery } from '@/lib/explainers/render/agent';
import { pictureCheckViolations } from '@/lib/explainers/render/job';
import { SpendMeter } from '@/lib/explainers/render/meter';
import { checkBash, checkToolCall, SNAP_COMMAND } from '@/lib/explainers/render/policy';
import { DEFAULT_SETTINGS, parseSetting } from '@/lib/explainers/settings';

const JOB = '/jobs/abc/project';
const KIT = path.join(process.cwd(), 'explainers', 'world-kit');
const SNAPPERS = ['scene-builder', 'frame-worker-scene', 'frame-worker-tech'];

// ── Policy: the one command ─────────────────────────────────────────────────

test('the scene builder and the 4.1 frame workers may run exactly the snap command, nothing else', () => {
  const allowed = [
    'node assets/kit/snap.mjs world',
    'node assets/kit/snap.mjs 04-analogy 0.5',
    'node assets/kit/snap.mjs 04-analogy 0.5,1.25,2,3.5,4,5.95',
    'node assets/kit/snap.mjs 01-hook 0,1.5',
    'node assets/kit/snap.mjs 07-payoff 12.333',
  ];
  const refused = [
    // chaining, pipes, substitution, redirects, background
    'node assets/kit/snap.mjs world; ls',
    'node assets/kit/snap.mjs world && ls',
    'node assets/kit/snap.mjs world || true',
    'node assets/kit/snap.mjs world | cat',
    'node assets/kit/snap.mjs world > /tmp/x',
    'node assets/kit/snap.mjs world &',
    'node assets/kit/snap.mjs world\nls',
    'node assets/kit/snap.mjs $(echo world)',
    'node assets/kit/snap.mjs `echo world`',
    'cd assets && node kit/snap.mjs world',
    'X=1 node assets/kit/snap.mjs world',
    // other scripts and other paths
    'node assets/kit/try.mjs all',
    'node assets/kit/bounds.mjs all',
    'node ./assets/kit/snap.mjs world',
    'node /etc/snap.mjs world',
    'node ../assets/kit/snap.mjs world',
    'node assets/kit/../../x/snap.mjs world',
    'node --inspect assets/kit/snap.mjs world',
    'npx hyperframes render',
    'ls',
    // the wrong shapes: too many times, no times, bad ids, the orchestrator's mode, extra words
    'node assets/kit/snap.mjs 04-analogy 1,2,3,4,5,6,7',
    'node assets/kit/snap.mjs 04-analogy',
    'node assets/kit/snap.mjs 04-analogy 1,',
    'node assets/kit/snap.mjs 04-analogy -1',
    'node assets/kit/snap.mjs ../x 1',
    'node assets/kit/snap.mjs 04_analogy 1',
    'node assets/kit/snap.mjs world 1',
    'node assets/kit/snap.mjs sequences',
    'node assets/kit/snap.mjs sequences 1',
    'node assets/kit/snap.mjs world extra',
    ' node assets/kit/snap.mjs world',
  ];
  for (const agent of SNAPPERS) {
    for (const command of allowed) assert.equal(checkToolCall('Bash', { command }, JOB, agent).allow, true, `${agent}: ${command}`);
    for (const command of refused) assert.equal(checkToolCall('Bash', { command }, JOB, agent).allow, false, `${agent}: ${JSON.stringify(command)}`);
    // the stills and the counters are snap.mjs's to write
    assert.equal(checkToolCall('Write', { file_path: '.hyperframes/snaps/04-analogy.count' }, JOB, agent).allow, false);
    assert.equal(checkToolCall('Edit', { file_path: `${JOB}/.hyperframes/sequences/manifest.json` }, JOB, agent).allow, false);
    assert.equal(checkToolCall('Read', { file_path: '.hyperframes/snaps/04-analogy-0.50.png' }, JOB, agent).allow, true);
    assert.equal(checkToolCall('Write', { file_path: 'assets/frames/04-analogy.js' }, JOB, agent).allow, true);
  }
  for (const command of allowed) assert.ok(SNAP_COMMAND.test(command), command);
  // The legacy frame worker (Real Case's) runs nothing; the lookers only Read.
  assert.equal(checkToolCall('Bash', { command: 'node assets/kit/snap.mjs world' }, JOB, 'frame-worker').allow, false);
  for (const agent of ['picture-checker', 'first-viewer', 'reader', 'diagnoser']) {
    assert.equal(checkToolCall('Bash', { command: 'node assets/kit/snap.mjs world' }, JOB, agent).allow, false, agent);
    assert.equal(checkToolCall('Write', { file_path: '.hyperframes/picture-check.json' }, JOB, agent).allow, false, agent);
    assert.equal(checkToolCall('Read', { file_path: '.hyperframes/sequences/04-analogy-0.15.png' }, JOB, agent).allow, true, agent);
  }
  // The orchestrator (no agent type) keeps its allowlist, and runs the picture-check sequences.
  assert.equal(checkToolCall('Bash', { command: 'node assets/kit/snap.mjs sequences' }, JOB).allow, true);
  assert.equal(checkToolCall('Bash', { command: 'node assets/kit/try.mjs all' }, JOB).allow, true);
  assert.equal(checkBash('node assets/kit/snap.mjs world; curl x', JOB).allow, false);
});

// ── Agents and settings ─────────────────────────────────────────────────────

const secrets = { anthropicApiKey: 'sk', heygenApiKey: 'hg', voiceId: 'v' };
const options = (extra: Record<string, string> = {}) =>
  sessionOptions(
    {
      query: (async function* () {}) as AgentQuery,
      prompt: '',
      projectDir: JOB,
      homeDir: '/jobs/abc/home',
      tmpDir: `${JOB}/.tmp`,
      model: 'claude-sonnet-5-5',
      frameWorkerModel: 'claude-sonnet-5-5',
      meter: new SpendMeter(8),
      secrets,
      log: () => undefined,
      ...extra,
    },
    new AbortController(),
    () => undefined,
  ) as Record<string, any>;

test('agent types (4.2): scene builder on its setting, both frame builders on frame_worker_model, the picture checker on its setting', () => {
  const o = options({
    frameWorkerModel: DEFAULT_SETTINGS.frame_worker_model,
    sceneBuilderModel: DEFAULT_SETTINGS.scene_builder_model,
    pictureCheckModel: DEFAULT_SETTINGS.picture_check_model,
  });
  const a = o.agents;
  assert.equal(a['scene-builder'].model, 'claude-opus-5-5');
  assert.equal(a['frame-worker-scene'].model, 'claude-sonnet-5-5', 'every frame builder on Sonnet (turn 16)');
  assert.equal(a['frame-worker-tech'].model, 'claude-sonnet-5-5');
  assert.equal(a['picture-checker'].model, 'claude-haiku-5-5', 'the grid check runs on Haiku');
  assert.equal(a['first-viewer'].model, 'claude-sonnet-5-5');
  // The legacy frame worker stays (Real Case overrides its prompt), on the frame worker model, with no Bash.
  assert.equal(a['frame-worker'].model, 'claude-sonnet-5-5');
  assert.ok(!a['frame-worker'].tools.includes('Bash'));
  // The readers and the diagnosis are agents (live run 42: direct calls were refused), Read only, on reader_model.
  for (const name of ['reader', 'diagnoser']) {
    assert.deepEqual(a[name].tools, ['Read', 'SubagentHandback'], name);
    assert.equal(a[name].model, 'claude-sonnet-5-5', name);
  }
  assert.match(a.reader.prompt, /^Task: a comprehension check of a short educational video/);
  const asReader = options({ mainAgent: 'reader', readerModel: 'claude-opus-5-5' } as never);
  assert.equal(asReader.agent, 'reader');
  assert.equal(asReader.agents.reader.model, 'claude-opus-5-5');
  assert.equal(options().agent, undefined);
  for (const name of SNAPPERS) {
    assert.ok(a[name].tools.includes('Bash'), name);
    assert.ok(!a[name].tools.includes('WebSearch') && !a[name].tools.includes('Agent'), name);
    assert.match(a[name].prompt, /craft\.md §§/, name);
    assert.match(a[name].prompt, /never Read them/, name);
    assert.match(a[name].prompt, /house-style\.md/, name);
    assert.match(a[name].prompt, /minimums\.md/, name);
    assert.doesNotMatch(a[name].prompt, /principles\.md|technique|true scale|real size|at most three critters|try\.mjs checks/, name);
    assert.match(a[name].prompt, /node assets\/kit\/snap\.mjs/, name);
    assert.match(a[name].prompt, name === 'scene-builder' ? /at most 3 snaps/ : /at most 4 snaps/, name);
    assert.match(a[name].prompt, /in a single Write of the whole file/, name);
    assert.match(a[name].prompt, /Hand back one short report/, name);
  }
  // Each role reads its craft sections (CONTRACT-4.2 § Craft section ids).
  assert.match(a['scene-builder'].prompt, /craft\.md §§ 1, 2, 4, 5, 6, 8 and 9/);
  for (const name of ['frame-worker-scene', 'frame-worker-tech']) assert.match(a[name].prompt, /craft\.md §§ 1–6 and 8–11/, name);
  assert.match(a['scene-builder'].prompt, /assets\/world\/identity\.js/);
  // A mechanism frame is named and shown the way it best reads, never narrowed to one travelling thing.
  assert.match(a['frame-worker-tech'].prompt, /Name the mechanism and how it best shows on screen \(it may travel, split, combine, change state, be compared before and after, grow or shrink/);
  assert.doesNotMatch(a['frame-worker-tech'].prompt, /the element that moves between them/);
  // Self-review by role: the frame builders against their packet, the scene builder against the anchor scene.
  assert.match(a['frame-worker-scene'].prompt, /what your packet planned/);
  assert.doesNotMatch(a['scene-builder'].prompt, /packet/);
  assert.match(a['scene-builder'].prompt, /## Visual arc and ## Anchor scene plan them/);
  // The frame builder is chosen by the frame's look, never by its number.
  assert.match(a['frame-worker-scene'].description, /look: world` or `look: blend/);
  assert.match(a['frame-worker-tech'].description, /look: mechanism/);
  for (const name of ['frame-worker-scene', 'frame-worker-tech']) assert.doesNotMatch(a[name].description, /frame 7|2, 3, 6|1, 4, 5|anchor/, name);
  assert.deepEqual(a['picture-checker'].tools, ['Read', 'SubagentHandback']);
  const checker = a['picture-checker'].prompt as string;
  // 4.2: the viewer's read only (review round 2): what the line is about, whether the voiced action
  // shows, a cut felt as a jump, whether a mechanism can be followed, one film, one look per thing.
  for (const re of [/the main subject the line is about \(a character or a thing\)/, /whether it shows what the line says/, /felt as a jump/, /whether you could follow it/, /feel like one film/, /look like a different thing in a later frame/, /"mechanism": "clear\|unclear\|not_mechanism"/, /"reel": \{"one_film"/]) assert.match(checker, re);
  // The house's own cut (the same thing, much closer or much wider, from the same spot) is never a jump.
  assert.match(checker, /A much closer or much wider view of the same thing from the same spot is a normal cut, never a jump/);
  assert.doesNotMatch(checker, /only zoomed/);
  // Breakage is code's: the checker never re-judges faces, text size or cut-off things. Floating is the
  // one thing it still reports, because code cannot see it in general (Lucas's floating mug).
  assert.match(checker, /anything floating: held by nothing, or not resting on anything/);
  assert.match(checker, /"floating": \[\]/);
  for (const re of [/"faceless"/, /"cut_off"/, /too small to read/, /crowded/, /tech_moves/, /glass panels/, /chef/, /what it wears/]) assert.doesNotMatch(checker, re);
  assert.equal(PICTURE_CHECK_FILE, '.hyperframes/picture-check.json');
  assert.ok(UNSANDBOXED_HYPERFRAMES.includes('node assets/kit/snap.mjs *'), 'snap.mjs drives Chrome outside the OS sandbox, still through the policy');
});

test('the frame builder comes from the storyboard look: world and blend → scene, mechanism → tech', () => {
  assert.equal(frameWorkerForLook('world'), 'frame-worker-scene');
  assert.equal(frameWorkerForLook('blend'), 'frame-worker-scene');
  assert.equal(frameWorkerForLook('mechanism'), 'frame-worker-tech');
  const board = [
    '## Visual arc', '- look: world', '',
    '## Frame 1 — Opener', '- look: world', '- shots: medium — x',
    '## Frame 2 — Gap', '- look: Mechanism', '',
    '## Frame 3 — Define', '- duration: 7s', '',
    '## Frame 4 — Analogy', '- look: blend', '- look: world',
    '## Frame 7 — Payoff', '- look: sideways', '',
    '## Frame 8 — Close', '',
  ].join('\n');
  assert.deepEqual([...storyboardLooks(board)], [[1, 'world'], [2, 'mechanism'], [4, 'blend']], 'the first look of each frame; none or unknown is left out');
});

test("the policy hook knows the subagent: a frame worker's Bash is the snap command only", async () => {
  const hook = options().hooks.PreToolUse[0].hooks[0] as (i: Record<string, unknown>) => Promise<{ hookSpecificOutput: { permissionDecision: string } }>;
  const decide = async (i: Record<string, unknown>) => (await hook(i)).hookSpecificOutput.permissionDecision;
  assert.equal(await decide({ tool_name: 'Bash', tool_input: { command: 'ls' } }), 'allow', 'the orchestrator');
  assert.equal(await decide({ tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'a1', agent_type: 'frame-worker-tech' }), 'deny');
  assert.equal(await decide({ tool_name: 'Bash', tool_input: { command: 'node assets/kit/snap.mjs 02-gap 1' }, agent_id: 'a1', agent_type: 'frame-worker-tech' }), 'allow');
  assert.equal(await decide({ tool_name: 'Write', tool_input: { file_path: 'x.json' }, agent_id: 'a2', agent_type: 'picture-checker' }), 'deny');
  // agent_type without agent_id is the main thread of an --agent session, not a subagent
  assert.equal(await decide({ tool_name: 'Bash', tool_input: { command: 'ls' }, agent_type: 'frame-worker-tech' }), 'allow');
});

test('settings (4.2): director and reader models added, one frame builder model, the per-reel cap code default unchanged', () => {
  assert.equal(DEFAULT_SETTINGS.director_model, 'claude-opus-5-5');
  assert.equal(DEFAULT_SETTINGS.orchestrator_model, 'claude-sonnet-5-5');
  assert.equal(DEFAULT_SETTINGS.scene_builder_model, 'claude-opus-5-5');
  assert.equal(DEFAULT_SETTINGS.frame_worker_model, 'claude-sonnet-5-5');
  assert.equal(DEFAULT_SETTINGS.picture_check_model, 'claude-haiku-5-5');
  assert.equal(DEFAULT_SETTINGS.reader_model, 'claude-sonnet-5-5');
  assert.equal(DEFAULT_SETTINGS.per_reel_cap_usd, 8);
  for (const gone of ['scene_frame_model', 'tech_frame_model']) assert.ok(!(gone in DEFAULT_SETTINGS), gone);
  const keys = ['director_model', 'orchestrator_model', 'scene_builder_model', 'frame_worker_model', 'picture_check_model', 'reader_model'] as const;
  for (const key of keys) {
    assert.equal(parseSetting(key, 'claude-sonnet-5-5'), 'claude-sonnet-5-5');
    assert.throws(() => parseSetting(key, ''));
  }
  // The settings page and route edit them; the schema seeds the new ones and no longer the removed ones.
  const route = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'explainers', 'settings', 'route.ts'), 'utf8');
  const form = fs.readFileSync(path.join(process.cwd(), 'app', 'explainers', 'settings', 'settings-form.tsx'), 'utf8');
  const schema = fs.readFileSync(path.join(process.cwd(), 'db', 'explainers_schema.sql'), 'utf8');
  for (const key of keys) {
    assert.match(route, new RegExp(`'${key}'`), key);
    assert.match(form, new RegExp(`key: '${key}'`), key);
    assert.match(schema, new RegExp(`\\('${key}',\\s+'"${(DEFAULT_SETTINGS as Record<string, unknown>)[key]}"'::jsonb\\)`), key);
  }
  for (const gone of ['scene_frame_model', 'tech_frame_model']) {
    for (const text of [route, form, schema]) assert.doesNotMatch(text, new RegExp(gone), gone);
  }
});

// ── The picture check's findings ────────────────────────────────────────────

test("the picture check (the viewer's read): missing is a warning only in a 4.1+ job; each problem is a picture:<kind> warning", () => {
  assert.deepEqual(pictureCheckViolations(null, { required: false }), []);
  const missing = pictureCheckViolations(null, { required: true });
  assert.deepEqual(missing.map((v) => [v.rule, v.severity, v.frame]), [['picture:missing', 'warning', null]]);
  assert.equal(pictureCheckViolations({ nope: 1 }, { required: true })[0].rule, 'picture:missing', 'unreadable counts as missing');
  const found = pictureCheckViolations(
    {
      frames: [
        { frame: '02-gap', subject: 'a phone', matches_line: 'yes', jump_cuts: [], mechanism: 'unclear', mechanism_seen: 'a phone lights up' },
        { frame: '05-why', subject: 'cannot tell', matches_line: 'no', why: 'the line says the store', jump_cuts: [{ between: ['1.15s', '3.15s'], why: 'same view, same size' }], mechanism: 'not_mechanism' },
        { frame: '04-analogy', subject: 'the carrier', matches_line: 'partly', jump_cuts: [], mechanism: 'not_mechanism', floating: ['a mug beside the critter, at 2.10s'], faceless: ['ignored: code checks it'], cut_off: ['ignored'] },
      ],
      reel: { one_film: 'partly', why: 'frame 6 looks like another video', changed_look: [{ thing: 'the letter', frames: ['04-analogy', '06-example'] }] },
    },
    { required: true },
  );
  assert.deepEqual(found.map((v) => [v.rule, v.frame, v.severity]), [
    ['picture:mechanism', 2, 'warning'],
    ['picture:line', 5, 'warning'],
    ['picture:jump_cut', 5, 'warning'],
    ['picture:who', 5, 'warning'],
    ['picture:floating', 4, 'warning'],
    ['picture:one_film', null, 'warning'],
    ['picture:changed_look', 6, 'warning'],
  ]);
  assert.equal(found[0].detail, '02-gap: a stranger could not follow how it works (they saw: a phone lights up)');
  assert.match(found[1].detail, /^05-why: the picture does not show what the line says \(the line says the store\)$/);
  assert.match(found[2].detail, /a cut felt like a jump between 1\.15s and 3\.15s \(same view, same size\)/);
  assert.equal(found[4].detail, '04-analogy: floating (held by nothing, resting on nothing): a mug beside the critter, at 2.10s');
  assert.equal(found[5].detail, 'The reel only partly feels like one film (frame 6 looks like another video).');
  assert.equal(found[6].detail, 'the letter looks like a different thing in 04-analogy and 06-example.');
  // A file from before 4.2 still reads: named_character and tech_moves.
  const legacy = pictureCheckViolations([{ frame: '06-example', named_character: 'cannot tell', tech_moves: 'only_labels', matches_line: 'yes' }], { required: true });
  assert.deepEqual(legacy.map((v) => v.rule), ['picture:who', 'picture:mechanism']);
});

// ── snap.mjs ────────────────────────────────────────────────────────────────

test('snap.mjs: times, the picture-check sequence, the world views', async () => {
  const S = await import('../explainers/world-kit/snap.mjs');
  assert.deepEqual(S.parseTimes('0.5,1,9', 4), [0.5, 1, 4 - 1 / 30]);
  assert.match(String(S.parseTimes('1,2,3,4,5,6,7', 9)), /at most 6/);
  assert.match(String(S.parseTimes('', 9)), /give the times/);
  assert.match(String(S.parseTimes('1,x', 9)), /seconds/);
  // one still just after each cut, and the last moment
  assert.deepEqual(S.sequenceTimes([{ at: 0 }, { at: 3 }, { at: 6.5 }], 10), [0.15, 3.15, 6.65, 9.97]);
  assert.deepEqual(S.sequenceTimes(null, 4), [0.15, 2.15, 3.97]);
  assert.equal(S.sequenceTimes(Array.from({ length: 12 }, (_, i) => ({ at: i })), 12).length, S.MAX_SEQUENCE_STILLS);
  assert.deepEqual(S.worldViews({}), S.WORLD_VIEWS);
  const views = Array.from({ length: 8 }, (_, i) => ({ pos: [i, -500, 120], target: [0, 0, 80], fov: 40 }));
  assert.equal(S.worldViews({ VIEWS: views }).length, S.MAX_TIMES);
  assert.equal(S.MAX_CALLS, 4);
});

/** A tiny project with a copy of the repo's kit (no VERSION: an older job unless HELIOS_KIT_VERSION says 4.1). */
function project(frames: Record<string, { number: number; source: string; anchor?: string }>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hx41-'));
  fs.mkdirSync(path.join(root, 'assets', 'frames'), { recursive: true });
  // a copy, as a job has (the CLIs run only when invoked by their own path)
  fs.cpSync(KIT, path.join(root, 'assets', 'kit'), { recursive: true });
  const board = ['# STORYBOARD', ''];
  for (const [id, f] of Object.entries(frames)) {
    board.push(`## Frame ${f.number} — F${f.number}`, '', '- duration: 4s', `- src: compositions/frames/${id}.html`, '- ground: paper', '- voiceover: "A line."', ...(f.anchor ? [`- anchor: ${f.anchor}`] : []), '');
    fs.writeFileSync(path.join(root, 'assets', 'frames', `${id}.js`), f.source);
    fs.writeFileSync(path.join(root, 'assets', 'frames', `${id}.events.json`), '[]\n');
  }
  fs.writeFileSync(path.join(root, 'STORYBOARD.md'), board.join('\n'));
  return root;
}

test('snap.mjs refuses a fourth call and bad arguments before it opens a browser', () => {
  const root = project({ '04-analogy': { number: 4, source: "export default { ground: 'paper', draw: () => '<g></g>' };\n" } });
  const snap = (...args: string[]) => spawnSync(process.execPath, [path.join('assets', 'kit', 'snap.mjs'), ...args], { cwd: root, encoding: 'utf8' });
  fs.mkdirSync(path.join(root, '.hyperframes', 'snaps'), { recursive: true });
  fs.writeFileSync(path.join(root, '.hyperframes', 'snaps', '04-analogy.count'), '4');
  const fifth = snap('04-analogy', '1');
  assert.equal(fifth.status, 1);
  assert.match(JSON.parse(fifth.stdout).errors[0], /used its 4 snaps/);
  assert.match(JSON.parse(snap('04-analogy', '1,2,3,4,5,6,7').stdout).errors[0], /at most 6/);
  assert.match(JSON.parse(snap('09-nope', '1').stdout).errors[0], /STORYBOARD\.md has no frame 09-nope/);
  assert.match(JSON.parse(snap('world').stdout).errors[0], /world\.js does not exist/);
  assert.match(JSON.parse(snap('04-analogy', '1', 'extra').stdout).errors[0], /^usage/);
  assert.equal(fs.readFileSync(path.join(root, '.hyperframes', 'snaps', '04-analogy.count'), 'utf8'), '4', 'a refused call is not counted');
});

// ── try.mjs: the 4.1 checks ─────────────────────────────────────────────────

test('try.mjs: frame kinds (frame 7 by its anchor), the rig, read text through transforms', async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const e = (number: number, anchor?: string) => ({ number, fields: anchor ? { anchor } : {} });
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => T.frameKind(e(n))), ['scene', 'tech', 'tech', 'scene', 'scene', 'tech']);
  assert.equal(T.frameKind(e(7, 'scene')), 'scene');
  assert.equal(T.frameKind(e(7, 'own'), "import { lens } from '../kit/lens.js';"), 'tech', 'the storyboard decides');
  assert.equal(T.frameKind(e(7), '// technique: before-after — the wait vanishes\n'), 'tech');
  assert.equal(T.frameKind(e(7), "import { travel } from '../kit/explain.js';"), 'tech');
  assert.equal(T.frameKind(e(7), "import { lens } from '../kit/lens.js';"), 'scene');
  assert.equal(T.frameKind(e(8)), null);

  const svg = '<g data-who="baker" data-look="ink" data-rig="hand-over-eyes faceless"></g>';
  const rig = T.rigProblems([{ t: 0.5, svg }, { t: 0.6, svg }]);
  assert.equal(rig.length, 2, 'each problem once per critter');
  assert.match(rig[0], /"baker" at 0\.50s: a hand covers its eyes/);
  assert.deepEqual(T.rigProblems([{ t: 0, svg: '<g data-who="baker" data-look="ink"></g>' }]), []);

  // The set across a frame's samples: walls, tells and layers merged, the worst ceiling kept.
  const setKit = await import('../explainers/world-kit/set.js');
  const a = '<g data-set-part="floor" data-set-layer="mid"></g><g data-set-part="wall"></g><g data-set-part="wall"></g><g data-set-part="corner" data-set-tell="fridge"></g><g data-set-part="ceiling" data-set-share="0.08"></g>';
  const b = '<g data-set-part="wall" data-set-layer="fg" data-set-tell="window"></g><g data-set-part="ceiling" data-set-share="0.2"></g>';
  const meta = T.unionSetMeta([{ t: 0, svg: a }, { t: 1, svg: b }, { t: 2, svg: '<g></g>' }], setKit);
  assert.equal(meta.walls, 2);
  assert.deepEqual(meta.tells, ['fridge', 'window']);
  assert.deepEqual(meta.layers, { fg: 1, mid: 1, bg: 0 });
  assert.equal(meta.ceiling.share, 0.2);
  assert.ok(!setKit.setProblems(meta).some((p: string) => /ceiling/.test(p)), 'ceiling share is craft (4.2)');
  assert.equal(T.unionSetMeta([{ t: 0, svg: '<g></g>' }], setKit), null);

  const M = T.parseTransform('translate(10 20) scale(2)');
  assert.deepEqual(M, [2, 0, 0, 2, 10, 20]);
  const texts = T.drawnTexts(
    '<g transform="translate(540 960) scale(0.5) translate(-540 -960)"><text x="200" y="900" font-size="60">Half</text></g>' +
      '<defs><text x="0" y="0" font-size="10">hidden</text></defs>' +
      '<g data-role="definition"><text x="200" y="900" font-size="20">card</text></g>' +
      '<text x="20" y="900" font-size="40" font-family="Roboto">Off the edge</text>' +
      '<text data-decor="1" x="300" y="900" font-size="24">deco</text>' +
      '<g opacity="0.3"><text x="300" y="900" font-size="12">fading</text></g>',
  );
  assert.deepEqual(texts.map((x: { text: string }) => x.text), ['Half', 'card', 'Off the edge', 'deco', 'fading']);
  assert.equal(texts[0].size, 30);
  const read = (T.readTextProblems as (samples: unknown[], o: Record<string, unknown>) => string[])([{ t: 1, svg: texts.length ? '<g transform="scale(0.5)"><text x="400" y="1800" font-size="60">Half</text></g><text x="20" y="900" font-size="40">Off the edge</text><text data-decor="1" x="300" y="900" font-size="24">deco</text>' : '' }], {
    readMin: 34,
    safeProblems: (boxes: { name: string; box: { x: number; y: number; w: number; h: number } }[]) => boxes.filter((b) => b.box.x < 96).map((b) => `${b.name} leaves the safe area`),
  });
  assert.deepEqual(read, [
    'the text "Half" is 30px at 1.00s: read text is at least 34px on a phone (explain.js READ_MIN)',
    'the text "Off the edge" leaves the safe area at 1.00s',
  ]);
});

test('try.mjs: the 4.1 checks are errors in a 4.1 job and stderr warnings in an older one', () => {
  const tech = "export default { ground: 'paper', draw: () => '<g><text x=\"300\" y=\"900\" font-size=\"20\" font-family=\"Roboto\">tiny words</text></g>' };\n";
  const root = project({ '02-gap': { number: 2, source: tech }, '07-payoff': { number: 7, anchor: 'own', source: `// technique: before-after — the same question, fast then slow\n${tech}` } });
  const run = (env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [path.join('assets', 'kit', 'try.mjs'), 'all'], { cwd: root, encoding: 'utf8', env: { ...process.env, HELIOS_KIT_VERSION: '', ...env } });
    assert.ok(r.stdout.trim(), `try.mjs printed nothing: ${r.stderr}`);
    return { status: r.status, out: JSON.parse(r.stdout), err: r.stderr };
  };
  const strict = run({ HELIOS_KIT_VERSION: '4.1' });
  assert.equal(strict.status, 1);
  const errors = strict.out.errors as string[];
  assert.ok(!errors.some((x) => /technique/.test(x)), 'the technique header is not checked (4.2)');
  assert.ok(errors.includes('02-gap: read: the text "tiny words" is 20px at 0.00s: read text is at least 34px on a phone (explain.js READ_MIN)'), errors.join('\n'));
  assert.ok(errors.some((x) => x.startsWith('07-payoff: read: the text "tiny words" is 20px')), 'a glass frame 7 is a tech frame');
  // The job's machine-readable copy (fail open: the job stores each as a breakage:<check> warning).
  assert.ok((strict.out.problems as { rule: string; check: string }[]).every((p) => p.rule === `breakage:${p.check}`));

  const legacy = run();
  assert.equal(legacy.status, 0, legacy.err);
  assert.deepEqual(legacy.out, { ok: true, errors: [] }, 'stdout keeps the old shape');
  assert.match(legacy.err, /Explainers 4\.1 warning\(s\) \(kit legacy; errors in a 4\.1 job\)/);
  assert.match(legacy.err, /- 02-gap: read: the text "tiny words" is 20px/);
});

test('try.mjs world: in a 4.1 job the world needs SET and identity.js', () => {
  const root = project({});
  fs.mkdirSync(path.join(root, 'assets', 'world'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'world', 'world.js'), "export const CAST = { cook: { body: 'orange' } };\nexport const SIZES = {};\nexport const ROOM = () => [];\n");
  const r = spawnSync(process.execPath, [path.join('assets', 'kit', 'try.mjs'), 'world'], { cwd: root, encoding: 'utf8', env: { ...process.env, HELIOS_KIT_VERSION: '4.1' } });
  const errors = JSON.parse(r.stdout).errors as string[];
  assert.ok(!errors.some((x) => /must export SET/.test(x)), errors.join('\n'));
  assert.ok(errors.some((x) => /^assets\/world\/identity\.js does not exist/.test(x)), errors.join('\n'));
  fs.writeFileSync(path.join(root, 'assets', 'world', 'identity.js'), "import { identity } from '../kit/explain.js';\nexport default identity({ cache: { icon: 'database', color: 'teal', shape: 'disc', label: 'cache' } });\n");
  const again = spawnSync(process.execPath, [path.join('assets', 'kit', 'try.mjs'), 'world'], { cwd: root, encoding: 'utf8', env: { ...process.env, HELIOS_KIT_VERSION: '4.1' } });
  assert.ok(!(JSON.parse(again.stdout).errors as string[]).some((x) => /identity\.js/.test(x)), again.stdout);
});

// ── DOCS contract: picture-check file shape, ROOM's object, per-shot cast, frame 7 ──

test('the 4.1 picture-check file { frames, assets } feeds both the reel flags and the asset bank', async () => {
  const { verifiedAssets } = await import('@/lib/explainers/render/bank');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hx41-pc-'));
  fs.mkdirSync(path.join(root, '.hyperframes'), { recursive: true });
  const file = {
    frames: [{ frame: '04-analogy', matches_line: 'no', why: 'no trip', jump_cuts: [], floating: [], faceless: [], cut_off: [], tech_moves: 'not_tech', objects: ['a milk carton', 'a fridge'] }],
    assets: [
      { name: 'milk carton', file: 'assets/world/new-props.js', meant: 'a milk carton', seen: 'a milk carton', pass: true },
      { name: 'butter dish', file: 'assets/world/new-props.js', meant: 'a butter dish', seen: 'a box', pass: false },
    ],
  };
  fs.writeFileSync(path.join(root, PICTURE_CHECK_FILE), JSON.stringify(file));
  assert.deepEqual([...verifiedAssets(root).keys()], ['milk carton'], 'a passing row is banked; a near miss is not');
  assert.deepEqual(pictureCheckViolations(file, { required: true }).map((v) => [v.rule, v.frame]), [['picture:line', 4]]);
  // the bare per-frame array still flags frames, and banks nothing
  fs.writeFileSync(path.join(root, PICTURE_CHECK_FILE), JSON.stringify(file.frames));
  assert.equal(verifiedAssets(root).size, 0);
  assert.equal(pictureCheckViolations(file.frames, { required: true }).length, 1);
  const checker = options().agents['picture-checker'].prompt as string;
  assert.match(checker, /"objects": \[\]/);
});

test('try.mjs: a critter off its shot\'s cast is off screen on purpose, not vanished', async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const drawn = (...who: string[]) => who.map((w) => `<g data-who="${w}" data-look="ink"></g>`).join('');
  const samples = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((t) => ({ t, svg: t >= 0.3 && t < 0.6 ? drawn('cook') : drawn('cook', 'clerk') }));
  assert.equal(T.castProblems(samples).length, 1, 'no shots: the clerk vanished');
  const castAt = (t: number) => (t >= 0.3 && t < 0.6 ? ['cook'] : ['cook', 'clerk']);
  assert.deepEqual(T.castProblems(samples, castAt), [], 'shot 2 lists only the cook');
  assert.equal(T.castProblems(samples, () => ['cook', 'clerk']).length, 1, 'in the cast and missing: vanished');
  const group = [0, 0.1, 0.2, 0.3, 0.4].map((t) => ({ t, svg: t === 0.2 || t === 0.3 ? drawn('cook') : drawn('cook', 'patients-2') }));
  assert.equal(T.castProblems(group, () => ['cook', 'patients']).length, 1, 'a group id covers its members');
});

test('try.mjs: frame 7 is a callback or glass, never both', async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const f7 = (anchor?: string) => ({ number: 7, fields: anchor ? { anchor } : {} });
  const world = [{ t: 1, svg: '<g data-lens="1 0 0 540 960"><g data-who="cook"></g></g>' }];
  const glass = [{ t: 2, svg: '<g data-concept="cache" data-icon="database"></g>' }];
  assert.match(T.frame7Problems(f7(), '', world)[0], /needs `- anchor: scene`/);
  assert.deepEqual(T.frame7Problems(f7('scene'), "import { lens } from '../kit/lens.js';", world), []);
  assert.deepEqual(T.frame7Problems(f7('own'), '// technique: before-after — x\n', glass), []);
  assert.match(T.frame7Problems(f7('scene'), '', [...world, ...glass])[0], /draws glass .* at 2\.00s/);
  assert.match(T.frame7Problems(f7('scene'), "import { travel } from '../kit/explain.js';", world)[0], /imports glass\.js or explain\.js/);
  assert.match(T.frame7Problems(f7('own'), '// technique: process — x\n', [...glass, ...world])[0], /draws the analogy world .* at 1\.00s/);
});

test("try.mjs world: ROOM returns the set builder's object; SETS places are briefed and built; a list is an older world", () => {
  const BRIEF = "{ place: 'a home kitchen', tells: ['fridge', 'counter run', 'window over the sink'], architecture: { walls: ['back', 'left'], openings: [{ wall: 'back', kind: 'window' }] }, materials: { floor: 'wood', walls: 'plaster' }, colorStory: ['teal', 'paper-shade'], layers: { fg: 'a table corner', mid: 'the fridge and the cook', bg: 'the window and the street' }, beyond: { kind: 'outdoor', place: 'the street' }, density: 'lived' }";
  const world = (room: string, extra = '') => [
    "import { identity } from '../kit/explain.js';",
    "export const CAST = { cook: { body: 'orange' } };",
    'export const SIZES = {};',
    `export const SET = ${BRIEF};`,
    extra,
    `export const ROOM = (P, R, state, place = 'main') => ${room};`,
  ].join('\n');
  const root = project({});
  fs.mkdirSync(path.join(root, 'assets', 'world'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'world', 'identity.js'), "import { identity } from '../kit/explain.js';\nexport default identity({ cache: { icon: 'database', color: 'teal', shape: 'disc', label: 'cache' } });\n");
  const tryWorld = () => {
    const r = spawnSync(process.execPath, [path.join('assets', 'kit', 'try.mjs'), 'world'], { cwd: root, encoding: 'utf8', env: { ...process.env, HELIOS_KIT_VERSION: '4.1' } });
    assert.ok(r.stdout.trim(), r.stderr);
    return JSON.parse(r.stdout).errors as string[];
  };
  // the object: its meta is checked against the brief (here: no floor, too few walls, no tells)
  fs.writeFileSync(path.join(root, 'assets', 'world', 'world.js'), world("({ env: [], items: [], meta: { walls: 2, corners: 1, openings: [{ kind: 'window', beyond: true }], floor: place === 'main', surfaces: [], layers: { fg: 1, mid: 1, bg: 1 }, tells: place === 'main' ? ['fridge', 'counter run', 'window over the sink'] : ['shelves'], dressing: 9 } })", `export const SETS = { store: { ...${BRIEF}, place: 'a corner store', tells: ['shelves', 'till', 'awning'] } };`));
  let errors = tryWorld();
  assert.ok(!errors.some((e) => /must return|list of pieces/.test(e)), errors.join('\n'));
  assert.ok(!errors.some((e) => /^set: /.test(e)), `the main set is built: ${errors.join('\n')}`);
  assert.ok(errors.some((e) => /^set \(store\): the set has nothing to stand on/.test(e)), errors.join('\n'));
  // an older world's list: still loads, and a 4.1 job is told to return the builder's result
  fs.writeFileSync(path.join(root, 'assets', 'world', 'world.js'), world('[]'));
  errors = tryWorld();
  assert.ok(!errors.some((e) => /list of pieces/.test(e)), errors.join('\n'));
});

// ── Round 2 (the offline rehearsals) ────────────────────────────────────────

test('P7: a blank phone or a card waiting for its words is caught; a phone with content, or a brief slide-in, is not', async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const G: any = await import('../explainers/world-kit/glass.js');
  const C: any = await import('../explainers/world-kit/cards.js');
  const times = Array.from({ length: 21 }, (_, i) => i / 10);
  // a phone that stays blank for 1.2s, then shows a message
  const phone = (t: number) => G.phone(300, 700, { title: '', messages: t >= 1.2 ? [{ text: 'Is a tomato a fruit?', from: 'user' }] : [] });
  const blank = T.emptyContainerProblems(times.map((t) => ({ t, svg: String(phone(t)) })));
  assert.equal(blank.length, 1);
  assert.match(blank[0], /^a phone with a blank screen shows from 0\.00s to 1\.20s/);
  assert.deepEqual(T.emptyContainerProblems(times.map((t) => ({ t, svg: String(G.phone(300, 700, { title: '', messages: [{ text: 'Hi there', from: 'user' }] })) }))), []);
  // the dictionary card: words fade in through tspans; blank while it lands for well under EMPTY_MAX
  const words = [{ text: 'A', start: 0.35 }, { text: 'cache', start: 0.45 }, { text: 'keeps', start: 0.6 }];
  const card = (t: number) => C.dictionaryCard(t, { headword: 'cache', words }).svg;
  assert.deepEqual(T.emptyContainerProblems(times.map((t) => ({ t, svg: card(t) }))), []);
  // the same card with nothing in it for a second is caught
  const late = (t: number) => C.dictionaryCard(t, { headword: '', pos: '', words: [{ text: 'late', start: 1.5 }] }).svg;
  assert.match(T.emptyContainerProblems(times.map((t) => ({ t, svg: late(t) })))[0] ?? '', /^the dictionary card with no words shows/);
  // an explain.js shell still counts
  assert.equal(T.emptyContainerProblems([0, 0.5, 1].map((t) => ({ t, svg: '<g data-shell="1" data-filled="0"><rect x="0" y="0" width="10" height="10"/></g>' }))).length, 1);
});

/** A tech frame as SVG: `n` labelled chips spread down the safe area, and a counter showing `count`. */
const techSvg = (n: number, count: string, ys = [640, 980, 1380]) =>
  Array.from({ length: n }, (_, i) => {
    const x = 140 + (i % 3) * 260;
    const y = ys[i % ys.length] + Math.floor(i / 3) * 70;
    return `<rect x="${x}" y="${y}" width="200" height="90" rx="20" fill="#14B8C4"/><text x="${x + 10}" y="${y + 60}" font-size="40" font-family="Roboto" font-weight="700">item ${String.fromCharCode(65 + i)}</text>`;
  }).join('') + `<text x="700" y="1500" font-size="64" font-family="Roboto" font-weight="700">${count}</text>`;

test('P8: the tech-frame fill check: covered, no empty band, real content, and something changes', async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const G: any = await import('../explainers/world-kit/glass.js');
  const o = { measure: G.measure };
  const full = [0, 1, 2, 3].map((t) => ({ t, svg: techSvg(9, `${3 * t}/64 done`) }));
  assert.deepEqual(T.techFillProblems(full, full[3].svg, { frameNumber: 6, ...o }), []);
  // a few icons on paper: little covered, the bottom third empty, two texts, nothing changing
  const sparse = [0, 1, 2].map((t) => ({ t, svg: '<rect x="400" y="700" width="100" height="100"/><text x="380" y="860" font-size="40">server</text><text x="380" y="920" font-size="40">phone</text>' }));
  const p = T.techFillProblems(sparse, sparse[2].svg, { frameNumber: 2, ...o });
  assert.ok(p.some((e: string) => /covers \d+% of the safe area/.test(e)), p.join('\n'));
  assert.ok(p.some((e: string) => /the bottom third of the safe area is empty/.test(e)), p.join('\n'));
  assert.ok(p.some((e: string) => /2 readable text\(s\)/.test(e)), p.join('\n'));
  assert.ok(p.some((e: string) => /nothing changes value or state/.test(e)), p.join('\n'));
  // frame 3 (the definition beat) is judged on fill only
  const still = [0, 1].map((t) => ({ t, svg: techSvg(9, '64/64 done') }));
  assert.deepEqual(T.techFillProblems(still, still[1].svg, { frameNumber: 3, ...o }), []);
  assert.match(T.techFillProblems(still, still[1].svg, { frameNumber: 2, ...o }).join(), /nothing changes/);
  // what counts as a change: a number, a step state, content building up
  assert.equal(T.valueChanges(full, G.measure).values, 1);
  assert.equal(T.valueChanges([0, 1].map((t) => ({ t, svg: `<g data-ui="stop" data-state="${t ? 'done' : 'current'}"></g>` }))).states, 2);
  assert.equal(T.valueChanges([0, 1, 2, 3, 4].map((t) => ({ t, svg: techSvg(2 + 2 * t, 'x') })), G.measure).grew >= 3, true);
  assert.equal(T.valueChanges([0, 1].map((t) => ({ t, svg: `<text x="300" y="900" font-size="40">${t ? 'Sneakers' : 'Size 9'}</text>` })), G.measure).values, 0, 'a swapped label is not a measured value');
  assert.deepEqual(T.FILL, { cell: 20, maxPiece: 0.05, coverage: 0.18, third: 0.08, texts: 6, grow: 3 }, 'FRAME.md quotes these numbers (DOCS)');
});

test('P6: text moving across the edge, or pushed off the frame by a crop, is not a safe-area error; text at rest is', async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const safe = (boxes: { name: string; box: { x: number; y: number; w: number; h: number } }[]) => boxes.filter((b) => b.box.x < 96 || b.box.x + b.box.w > 940).map((b) => `${b.name} leaves the safe area`);
  const at = (x: number) => `<text x="${x}" y="900" font-size="40">chip</text>`;
  const moving = [0, 0.1, 0.2, 0.3].map((t, i) => ({ t, svg: at(800 + i * 120) }));
  assert.deepEqual(T.readTextProblems(moving, { safeProblems: safe }), []);
  const resting = [0, 0.1, 0.2].map((t) => ({ t, svg: at(900) }));
  assert.equal(T.readTextProblems(resting, { safeProblems: safe }).length, 1);
  const offFrame = [0, 0.1, 0.2].map((t) => ({ t, svg: at(1200) }));
  assert.deepEqual(T.readTextProblems(offFrame, { safeProblems: safe }), []);
});

test('P3 and P5: frame 1 is sampled once the opener has uncovered the hook; every opener has a measured reveal', async () => {
  const S = await import('../explainers/world-kit/snap.mjs');
  const B: any = await import('../explainers/world-kit/openers/bank.js');
  assert.deepEqual(Object.keys(B.HOOK_REVEAL).sort(), [...B.OPENER_KEYS].sort());
  assert.equal(B.HOOK_REVEAL.typewriter, 1.3);
  assert.deepEqual(S.sequenceTimes([{ at: 0 }, { at: 2.5 }], 4.5, B.HOOK_REVEAL.typewriter), [1.45, 2.65, 4.47]);
  assert.deepEqual(S.sequenceTimes([{ at: 0 }], 4.5), [0.15, 4.47], 'other frames keep 0.15s');
});

test('P4: the hero kind comes from the storyboard: pace picks an object-safe opener and records it; try reads it', async () => {
  const B: any = await import('../explainers/world-kit/openers/bank.js');
  const O: any = await import('../explainers/world-kit/openers/sound.mjs');
  const T = await import('../explainers/world-kit/try.mjs');
  assert.equal(B.storyboardHeroKind('## Anchor scene\n- hero: newpin — object\n'), 'object');
  assert.equal(B.storyboardHeroKind('- hero: cook — critter'), 'critter');
  assert.equal(B.storyboardHeroKind(''), 'critter');
  for (let i = 0; i < 6; i++) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hx41-op-'));
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'STORYBOARD.md'), '## Anchor scene\n- hero: newpin — object\n');
    const key = O.ensureOpener(root, () => i / 6);
    assert.ok(B.OBJECT_HERO_OPENERS.includes(key), key);
    const choice = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'opener.json'), 'utf8'));
    assert.equal(choice.hero, 'object');
    assert.equal(T.openerHero(root), 'object');
    // an older choice with no hero: the storyboard says
    fs.writeFileSync(path.join(root, 'assets', 'opener.json'), JSON.stringify({ key }));
    assert.equal(T.openerHero(root), 'object');
  }
});

test('P2: a snap whose frame throws is not counted', { skip: false }, async (t) => {
  const { findChrome, driver } = await import('../explainers/world-kit/bounds.mjs');
  if (!findChrome() || !(await driver())) {
    t.skip('no headless Chrome here');
    return;
  }
  const root = project({ '04-analogy': { number: 4, source: "export default { ground: 'paper', draw: () => { throw new Error('boom'); } };\n" } });
  const r = spawnSync(process.execPath, [path.join('assets', 'kit', 'snap.mjs'), '04-analogy', '1'], { cwd: root, encoding: 'utf8', env: { ...process.env, HELIOS_NODE_MODULES: path.join(process.cwd(), 'node_modules') } });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /threw: boom/);
  assert.equal(out.counted, false);
  assert.equal(out.left, 4);
  assert.equal(fs.readFileSync(path.join(root, '.hyperframes', 'snaps', '04-analogy.count'), 'utf8'), '0');
});

test('P9: every agent type carries its role brief and its reply format', () => {
  const a = options().agents;
  for (const name of ['scene-builder', 'frame-worker-scene', 'frame-worker-tech']) assert.match(a[name].prompt, /Hand back one short report: /, name);
  assert.match(a['scene-builder'].prompt, /what you drew instead and why/);
  for (const name of ['picture-checker', 'first-viewer']) assert.match(a[name].prompt, /Reply with JSON only/, name);
  // 4.2: the first viewer runs only the gap test; the whole reel is the readers' (code's)
  assert.match(a['first-viewer'].prompt, /"keep_watching": 1, "confused": \["\.\.\."\]\}/);
  assert.doesNotMatch(a['first-viewer'].prompt, /concept_in_my_words|## Beat 8/);
});

test('P10: a gap line with quotation marks fails the code check (the line is said word for word)', async () => {
  const { gapCheckProblems } = await import('@/lib/explainers/ideas/gap');
  const input = { term: 'vector database', analogy: { name: 'A map table', mapping: [{ analogy: 'the pins', concept: 'the vectors' }] } };
  const q = 'So how does the app find pictures that match a feeling?';
  const line = (s: string) => ({ line: `${s} ${q}`, question: q, way_in: 'x', why_it_pulls: 'x' });
  const base = 'You type a few plain words into the photo app and it shows the shots you meant, even though none of them is tagged that way.';
  assert.ok(!gapCheckProblems(line(base), input).some((p) => /quotation/.test(p)));
  const quoted = gapCheckProblems(line(base.replace('a few plain words', '"beach at sunset"')), input);
  assert.ok(quoted.some((p) => /puts words in quotation marks \("beach at sunset"\)/.test(p)), quoted.join('; '));
  assert.ok(!gapCheckProblems(line(base.replace('photo app', "photo app's search")), input).some((p) => /quotation/.test(p)), 'an apostrophe is not a quote');
});

test('cost levers: one shared cached instruction stack for every builder (same bytes, same order); the world snaps 3 times', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hx42-stack-'));
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  put('.media/recipes/helios-explainer/craft.md', '# Craft');
  put('.media/recipes/helios-explainer/house-style.md', '# House');
  put('.media/recipes/helios-explainer/minimums.md', '# Minimums');
  put('frame.md', '# Frame');
  put('assets/kit/KIT-REFERENCE.md', '# Kit');
  const { instructionStack, STACK_FILES } = await import('@/lib/explainers/render/agent');
  const stack = instructionStack(root);
  assert.deepEqual([...stack.matchAll(/<file path="([^"]+)">/g)].map((m) => m[1]), [...STACK_FILES]);
  const o = sessionOptions({ query: (async function* () {}) as AgentQuery, prompt: '', projectDir: root, homeDir: '/h', tmpDir: '/t', model: 'm', frameWorkerModel: 'm', meter: new SpendMeter(8), secrets, log: () => undefined }, new AbortController(), () => undefined) as Record<string, any>;
  for (const name of ['scene-builder', 'frame-worker-scene', 'frame-worker-tech']) assert.ok(o.agents[name].prompt.startsWith(stack), `${name} opens on the shared stack`);
  assert.equal(instructionStack(path.join(root, 'nothing')), '', 'no files, no stack');
  const S = await import('../explainers/world-kit/snap.mjs');
  assert.equal(S.callsFor('world'), 3);
  assert.equal(S.callsFor('04-analogy'), 4);
});
