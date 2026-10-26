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

import { PICTURE_CHECK_FILE, sessionOptions, UNSANDBOXED_HYPERFRAMES, type AgentQuery } from '@/lib/explainers/render/agent';
import { pictureCheckViolations } from '@/lib/explainers/render/job';
import { SpendMeter } from '@/lib/explainers/render/meter';
import { checkBash, checkToolCall, SNAP_COMMAND } from '@/lib/explainers/render/policy';
import { checkDefinitionMapping, storyboardFrameField, termRow } from '@/lib/explainers/render/understanding';
import { DEFAULT_SETTINGS, parseSetting } from '@/lib/explainers/settings';
import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';

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
  for (const agent of ['picture-checker', 'first-viewer']) {
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

test('agent types: scene builder, scene and tech frame workers, the picture checker, each on its setting', () => {
  const o = options({
    sceneBuilderModel: DEFAULT_SETTINGS.scene_builder_model,
    sceneFrameModel: DEFAULT_SETTINGS.scene_frame_model,
    techFrameModel: DEFAULT_SETTINGS.tech_frame_model,
    pictureCheckModel: DEFAULT_SETTINGS.picture_check_model,
  });
  const a = o.agents;
  assert.equal(a['scene-builder'].model, 'claude-opus-5-5');
  assert.equal(a['frame-worker-scene'].model, 'claude-opus-5-5');
  assert.equal(a['frame-worker-tech'].model, 'claude-sonnet-5-5');
  assert.equal(a['picture-checker'].model, 'claude-sonnet-5-5', 'off Haiku: it looks at PNG stills');
  assert.equal(a['first-viewer'].model, 'claude-sonnet-5-5');
  // The legacy frame worker stays (Real Case overrides its prompt), on the frame worker model, with no Bash.
  assert.equal(a['frame-worker'].model, 'claude-sonnet-5-5');
  assert.ok(!a['frame-worker'].tools.includes('Bash'));
  for (const name of SNAPPERS) {
    assert.ok(a[name].tools.includes('Bash'), name);
    assert.ok(!a[name].tools.includes('WebSearch') && !a[name].tools.includes('Agent'), name);
    assert.match(a[name].prompt, /principles\.md/, name);
    assert.match(a[name].prompt, /node assets\/kit\/snap\.mjs/, name);
    assert.match(a[name].prompt, /at most four snaps/, name);
    assert.match(a[name].prompt, /Hand back one short report/, name);
  }
  assert.match(a['scene-builder'].prompt, /assets\/world\/identity\.js/);
  assert.match(a['frame-worker-tech'].prompt, /\/\/ technique: <id> — <reason>/);
  assert.deepEqual(a['picture-checker'].tools, ['Read', 'SubagentHandback']);
  const checker = a['picture-checker'].prompt as string;
  for (const re of [/named character/, /matches the voiceover line/, /felt like a jump/, /floating/, /faceless/, /cut off/, /crowded/, /shows the idea moving/, /"tech_moves": "moves\|only_labels\|not_tech"/]) assert.match(checker, re);
  assert.equal(PICTURE_CHECK_FILE, '.hyperframes/picture-check.json');
  assert.ok(UNSANDBOXED_HYPERFRAMES.includes('node assets/kit/snap.mjs *'), 'snap.mjs drives Chrome outside the OS sandbox, still through the policy');
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

test('settings: the four 4.1 models, their defaults, and the per-reel cap unchanged', () => {
  assert.equal(DEFAULT_SETTINGS.scene_builder_model, 'claude-opus-5-5');
  assert.equal(DEFAULT_SETTINGS.scene_frame_model, 'claude-opus-5-5');
  assert.equal(DEFAULT_SETTINGS.tech_frame_model, 'claude-sonnet-5-5');
  assert.equal(DEFAULT_SETTINGS.picture_check_model, 'claude-sonnet-5-5');
  assert.equal(DEFAULT_SETTINGS.per_reel_cap_usd, 8);
  for (const key of ['scene_builder_model', 'scene_frame_model', 'tech_frame_model', 'picture_check_model'] as const) {
    assert.equal(parseSetting(key, 'claude-sonnet-5-5'), 'claude-sonnet-5-5');
    assert.throws(() => parseSetting(key, ''));
  }
  // The settings page and route edit them; the schema seeds them.
  const route = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'explainers', 'settings', 'route.ts'), 'utf8');
  const form = fs.readFileSync(path.join(process.cwd(), 'app', 'explainers', 'settings', 'settings-form.tsx'), 'utf8');
  const schema = fs.readFileSync(path.join(process.cwd(), 'db', 'explainers_schema.sql'), 'utf8');
  for (const key of ['scene_builder_model', 'scene_frame_model', 'tech_frame_model', 'picture_check_model']) {
    assert.match(route, new RegExp(`'${key}'`), key);
    assert.match(form, new RegExp(`key: '${key}'`), key);
    assert.match(schema, new RegExp(`\\('${key}',\\s+'"${(DEFAULT_SETTINGS as Record<string, unknown>)[key]}"'::jsonb\\)`), key);
  }
});

// ── The definition check (Jev stubbed) ──────────────────────────────────────

const CACHE_MAPPING = [
  { analogy: 'the fridge', concept: 'the cache' },
  { analogy: 'the milk carton', concept: 'a cached copy' },
  { analogy: 'the corner store', concept: 'the original source' },
];

/** Jev that says no when the definition calls the copy the cache while the fridge stands for it. */
function stubJev(seen: Record<string, unknown>[] = []): ExplainersJevRunner {
  return {
    callCount: 0,
    usd: 0,
    async ask(request) {
      const s = request.state as Record<string, unknown>;
      seen.push({ ...s, keys: Object.keys(request.questions) });
      const copy = /copy/i.test(String(s.definition_line)) && String(s.term_row).startsWith('the fridge');
      return { model: 'jev-stub', answers: { same_part: { type: 'noul', noul: copy ? 0.08 : 0.92 } }, usage: { input_tokens: 1, output_tokens: 0 } } as never;
    },
  };
}

const cacheScript = (line3: string) =>
  [
    '# SCRIPT', '',
    '## Line 3 — Define (Frame 3)', '', `    ${line3}`, '',
    '## Line 4 — Analogy (Frame 4)', '', '    The fridge keeps what you used last close by.', '',
    '## Line 5 — Why (Frame 5)', '', '    No trip to the store for milk you already have.', '',
  ].join('\n');
const cacheBoard = '## Frame 3 — Define\n- part_of_speech: noun\n- definition: "A cache is a store of recent data kept close by."\n\n## Frame 4 — Analogy\n- definition: not this one\n';

test('the definition check: "the copy is called the cache, but the fridge is the cache" fails; the same part passes', async () => {
  const seen: Record<string, unknown>[] = [];
  const jev = stubJev(seen);
  const bad = await checkDefinitionMapping({ jev, topicId: 't', term: 'cache', storyboard: cacheBoard, script: cacheScript('A cache is a saved copy of something you fetched.'), mapping: CACHE_MAPPING });
  assert.ok(bad);
  assert.equal(bad.p, 0.08);
  assert.equal(bad.finding?.kind, 'definition_mapping');
  assert.deepEqual(bad.finding?.beats, [3]);
  assert.match(bad.finding!.detail, /"the fridge" stands for the cache/);
  assert.deepEqual(seen[0].keys, ['same_part']);
  assert.equal(seen[0].term_row, 'the fridge = the cache', 'the term row is the exact concept, not "a cached copy"');
  assert.equal(seen[0].definition_card, 'A cache is a store of recent data kept close by.');
  assert.equal(seen[0].analogy_lines, 'The fridge keeps what you used last close by.\nNo trip to the store for milk you already have.');

  const good = await checkDefinitionMapping({ jev, topicId: 't', term: 'cache', storyboard: cacheBoard, script: cacheScript('A cache is a nearby store of things you used recently.'), mapping: CACHE_MAPPING });
  assert.equal(good?.finding, null);
  // Nothing to compare: no definition at all, or no mapping.
  assert.equal(await checkDefinitionMapping({ jev, topicId: 't', term: 'cache', storyboard: '', script: '', mapping: CACHE_MAPPING }), null);
  assert.equal(await checkDefinitionMapping({ jev, topicId: 't', term: 'cache', storyboard: cacheBoard, script: '', mapping: [] }), null);
  // Jev with no answer is an error the caller records.
  const silent: ExplainersJevRunner = { callCount: 0, usd: 0, ask: async () => ({ answers: {} }) as never };
  await assert.rejects(checkDefinitionMapping({ jev: silent, topicId: 't', term: 'cache', storyboard: cacheBoard, script: '', mapping: CACHE_MAPPING }), /no same_part/);
});

test('the term row and frame fields are read from the plan', () => {
  assert.deepEqual(termRow(CACHE_MAPPING, 'Cache'), CACHE_MAPPING[0]);
  assert.deepEqual(termRow(CACHE_MAPPING, 'cached copy'), CACHE_MAPPING[1]);
  assert.deepEqual(termRow([{ analogy: 'a', concept: 'the model router' }, { analogy: 'b', concept: 'the routing table' }], 'router'), { analogy: 'a', concept: 'the model router' });
  assert.deepEqual(termRow(CACHE_MAPPING, 'latency'), CACHE_MAPPING[0], 'no row names it: the most important row');
  assert.equal(termRow([], 'cache'), null);
  assert.equal(storyboardFrameField(cacheBoard, 3, 'definition'), 'A cache is a store of recent data kept close by.');
  assert.equal(storyboardFrameField(cacheBoard, 4, 'definition'), 'not this one');
  assert.equal(storyboardFrameField(cacheBoard, 6, 'definition'), null);
});

// ── The picture check's findings ────────────────────────────────────────────

test('the picture check: missing is an error only in a 4.1 job; failures become warnings per frame', () => {
  assert.deepEqual(pictureCheckViolations(null, { required: false }), []);
  const missing = pictureCheckViolations(null, { required: true });
  assert.deepEqual(missing.map((v) => [v.rule, v.severity, v.frame]), [['picture_check_missing', 'error', null]]);
  assert.equal(pictureCheckViolations({ nope: 1 }, { required: true })[0].rule, 'picture_check_missing', 'unreadable counts as missing');
  const found = pictureCheckViolations(
    { frames: [
      { frame: '02-gap', matches_line: 'yes', jump_cuts: [], floating: [], faceless: [], cut_off: ['the bubble at the left edge'], tech_moves: 'moves', named_character: 'none' },
      { frame: '05-why', matches_line: 'partly', jump_cuts: [], floating: [], faceless: ['the patient by the door'], cut_off: [], tech_moves: 'not_tech' },
      { frame: '04-analogy', matches_line: 'yes', jump_cuts: [], floating: [], faceless: [], cut_off: [], tech_moves: 'not_tech' },
    ] },
    { required: true },
  );
  assert.deepEqual(found.map((v) => [v.rule, v.frame, v.severity]), [['picture_check', 2, 'warning'], ['picture_check', 5, 'warning']]);
  assert.match(found[0].detail, /^02-gap: cut off: the bubble at the left edge$/);
  assert.match(found[1].detail, /faceless: the patient by the door/);
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
  assert.ok(setKit.setProblems(meta).some((p: string) => /ceiling takes 20%/.test(p)));
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
  assert.ok(errors.includes('02-gap: technique: the frame does not start with `// technique: <id> — <reason>`'), errors.join('\n'));
  assert.ok(!errors.some((x) => x.startsWith('07-payoff: technique:')), 'frame 7 declares its technique');
  assert.ok(errors.includes('02-gap: read: the text "tiny words" is 20px at 0.00s: read text is at least 34px on a phone (explain.js READ_MIN)'), errors.join('\n'));
  assert.ok(errors.some((x) => x.startsWith('07-payoff: read: the text "tiny words" is 20px')), 'a glass frame 7 is a tech frame');

  const legacy = run();
  assert.equal(legacy.status, 0, legacy.err);
  assert.deepEqual(legacy.out, { ok: true, errors: [] }, 'stdout keeps the old shape');
  assert.match(legacy.err, /Explainers 4\.1 warning\(s\) \(kit legacy; errors in a 4\.1 job\)/);
  assert.match(legacy.err, /- 02-gap: technique: the frame does not start/);
});

test('try.mjs world: in a 4.1 job the world needs SET and identity.js', () => {
  const root = project({});
  fs.mkdirSync(path.join(root, 'assets', 'world'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'world', 'world.js'), "export const CAST = { cook: { body: 'orange' } };\nexport const SIZES = {};\nexport const ROOM = () => [];\n");
  const r = spawnSync(process.execPath, [path.join('assets', 'kit', 'try.mjs'), 'world'], { cwd: root, encoding: 'utf8', env: { ...process.env, HELIOS_KIT_VERSION: '4.1' } });
  const errors = JSON.parse(r.stdout).errors as string[];
  assert.ok(errors.some((x) => /^world\.js must export SET = /.test(x)), errors.join('\n'));
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
  assert.deepEqual(pictureCheckViolations(file, { required: true }).map((v) => [v.rule, v.frame]), [['picture_check', 4]]);
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
  assert.ok(errors.some((e) => /^set \(store\): the set has no floor/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /^set \(store\): the brief's tell "till" is never built/.test(e)), errors.join('\n'));
  // an older world's list: still loads, and a 4.1 job is told to return the builder's result
  fs.writeFileSync(path.join(root, 'assets', 'world', 'world.js'), world('[]'));
  errors = tryWorld();
  assert.ok(errors.some((e) => /^set: ROOM returns a list of pieces/.test(e)), errors.join('\n'));
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
  assert.match(a['frame-worker-tech'].prompt, /never a blank device, an empty card waiting for content, or a few icons on paper/);
  for (const name of ['picture-checker', 'first-viewer']) assert.match(a[name].prompt, /Reply with JSON only/, name);
  // the first viewer's questions and both answer shapes live in its own prompt
  assert.match(a['first-viewer'].prompt, /"keep_watching": 1, "confused": \["\.\.\."\]\}/);
  assert.match(a['first-viewer'].prompt, /"concept_in_my_words": "\.\.\."/);
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

test('the definition check reads both rows of a paired term', async () => {
  const seen: Record<string, unknown>[] = [];
  const mapping = [
    { analogy: 'the tap', concept: 'the frontend' },
    { analogy: 'the tank', concept: 'the backend' },
  ];
  await checkDefinitionMapping({ jev: stubJev(seen), topicId: 't', term: 'frontend vs backend', storyboard: '', script: cacheScript('The frontend is what you touch; the backend does the work.'), mapping });
  assert.equal(seen[0].term_row, 'the tap = the frontend\nthe tank = the backend');
});
