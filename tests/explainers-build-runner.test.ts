/**
 * Cost fix 1 (2026-10-28): the build run by code (lib/explainers/render/build.ts) runs the workflow's
 * Steps 3.1–6 in order, dispatches the same builders with the same messages (packets inline), and
 * gives each check its one fix round. Cost fix 2: builders never browse kit source. Offline: the
 * commands and the builder sessions are stubbed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { finalizeFailures, runBuild, worldRequests, type CmdResult } from '@/lib/explainers/render/build';
import type { SessionResult } from '@/lib/explainers/render/agent';

const IDS = ['01-opener', '02-define', '03-handoff', '04-analogy', '05-payoff', '06-example', '07-tie', '08-close'];
const LOOKS: Record<number, string> = { 1: 'world', 2: 'mechanism', 4: 'world', 5: 'blend', 6: 'mechanism', 7: 'world' };

function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-runner-'));
  const board = IDS.map((id, i) => `## Frame ${i + 1} — ${id}\n- status: outline\n${LOOKS[i + 1] ? `- look: ${LOOKS[i + 1]}\n` : ''}`).join('\n');
  fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), `# Storyboard\n\n${board}`);
  fs.mkdirSync(path.join(dir, '.hyperframes', 'frame-packets'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'frames'), { recursive: true });
  return dir;
}
const result = (lastText = ''): SessionResult => ({ sessionId: null, subtype: 'success', isError: false, totalCostUsd: 0.1, modelUsage: {}, capped: false, denials: [], errors: [], lastText });
const ok = (o: Record<string, unknown> = {}): CmdResult => ({ status: 0, stdout: JSON.stringify({ ok: true, errors: [], ...o }), stderr: '' });
const bad = (o: Record<string, unknown>): CmdResult => ({ status: 1, stdout: JSON.stringify({ ok: false, ...o }), stderr: '' });

test('cost fix 1: code runs the build in order, by look, with each one fix round', async () => {
  const dir = project();
  const steps: string[] = [];
  const counts = new Map<string, number>();
  const nth = (k: string) => {
    counts.set(k, (counts.get(k) ?? 0) + 1);
    return counts.get(k)!;
  };
  const exec = (program: 'node' | 'hyperframes', args: string[]): CmdResult => {
    const name = program === 'node' ? `${path.basename(args[0])}${args[1] && !args[1].startsWith('--') ? ` ${args[1]}` : ''}` : `hyperframes ${args[0]}`;
    steps.push(name);
    const n = nth(name);
    switch (name) {
      case 'audio.mjs':
        fs.writeFileSync(path.join(dir, 'audio_meta.json'), '{}');
        return ok();
      case 'music.mjs':
        return n === 1 ? bad({ errors: ['bed not found'] }) : ok();
      case 'frame-packets.mjs':
        fs.writeFileSync(path.join(dir, '.hyperframes', 'frame-packets', '_role.md'), 'ROLE TEXT');
        for (const id of IDS) fs.writeFileSync(path.join(dir, '.hyperframes', 'frame-packets', `${id}.md`), `PACKET ${id}`);
        return ok();
      case 'try.mjs world':
        return n === 1 ? bad({ errors: ['world: VIEWS is missing'] }) : ok();
      case 'try.mjs all':
        return n === 1 ? bad({ errors: [], problems: [{ frame: '05-payoff', check: 'framing', message: 'the subject leaves the frame' }, { frame: '03-handoff', check: 'cast', message: 'drawn 2 times' }] }) : bad({ errors: [], problems: [{ frame: '03-handoff', check: 'cast', message: 'drawn 2 times' }] });
      case 'mount.mjs':
        for (const id of IDS) {
          fs.mkdirSync(path.join(dir, 'compositions', 'frames'), { recursive: true });
          fs.writeFileSync(path.join(dir, 'compositions', 'frames', `${id}.html`), '<html/>');
        }
        return ok();
      case 'sound.mjs':
        return n === 1 ? ok({ dropped: [{ frame: '06-example', event: { what: 'zorp' }, why: 'no match' }, { frame: '06-example', event: { what: 'blip' }, why: 'no match' }, { frame: '07-tie', event: { what: 'x' }, why: 'no match' }] }) : ok({ dropped: [] });
      case 'hyperframes check':
        return { status: 1, stdout: JSON.stringify({ ok: false, layout: { issues: [{ severity: 'error', code: 'text_box_overflow', selector: '#caption-word-3', message: 'overflow 2px' }] } }), stderr: '' };
      default:
        return ok();
    }
  };
  const dispatched: { agent: string; prompt: string }[] = [];
  const dispatch = async (agent: string, prompt: string) => {
    dispatched.push({ agent, prompt });
    const id = /packet \(\.hyperframes\/frame-packets\/([\w-]+)\.md\)/.exec(prompt)?.[1];
    if (id) {
      const mod = id === '01-opener' ? '01-hook' : id;
      // frame 2's first builder forgets its events file
      const first = dispatched.filter((d) => d.prompt.includes(`frame-packets/${id}.md)`)).length === 1;
      fs.writeFileSync(path.join(dir, 'assets', 'frames', `${mod}.js`), 'export default {}');
      if (!(id === '02-define' && first)) fs.writeFileSync(path.join(dir, 'assets', 'frames', `${mod}.events.json`), '[]');
      if (id === '04-analogy' && first) return result('Wrote 04-analogy.js.\nWORLD REQUEST: pose puppy: sits with its head tilted');
    }
    return result('done');
  };
  const out = await runBuild({ projectDir: dir, voiceId: 'v1', dispatch: dispatch as never, overCap: () => false, log: () => undefined, exec });

  // the order of work (SKILL.md Steps 3.1–6)
  const order = ['audio.mjs', 'audio.mjs sync-durations', 'pace.mjs', 'music.mjs', 'music.mjs', 'opener-sfx.mjs', 'frame-packets.mjs', 'try.mjs world', 'try.mjs props', 'try.mjs world', 'try.mjs props', 'try.mjs world', 'pace.mjs handoff', 'mount.mjs', 'try.mjs all', 'bounds.mjs all', 'mount.mjs 05-payoff', 'try.mjs all', 'bounds.mjs all', 'sound.mjs', 'sound.mjs', 'captions.mjs build', 'assemble-index.mjs', 'transitions.mjs inject', 'transitions.mjs verify', 'hyperframes lint', 'hyperframes check'];
  assert.deepEqual(steps, order);
  // the scene builder: first, then once with the exact errors, then once with the world request
  const scene = dispatched.filter((d) => d.agent === 'scene-builder');
  assert.equal(scene.length, 3);
  assert.match(scene[0].prompt, /^Build the reel's world\. Read \.claude\/skills\/helios-explainer-director\/scene-builder\.md and follow it\./);
  assert.match(scene[1].prompt, /world: VIEWS is missing/);
  assert.match(scene[2].prompt, /04-analogy: pose puppy: sits with its head tilted/);
  // frames 1, 2, 4, 5, 6, 7 by look (never 3 or 8), packets inline
  const firsts = dispatched.filter((d) => d.agent !== 'scene-builder' && !/Your module|missing|added what you asked|Rewrite your events|finalize/.test(d.prompt));
  assert.deepEqual(firsts.map((d) => /packet \(\.hyperframes\/frame-packets\/([\w-]+)\.md\)/.exec(d.prompt)![1]), ['01-opener', '02-define', '04-analogy', '05-payoff', '06-example', '07-tie']);
  assert.deepEqual(firsts.map((d) => d.agent), ['frame-worker-scene', 'frame-worker-tech', 'frame-worker-scene', 'frame-worker-scene', 'frame-worker-tech', 'frame-worker-scene']);
  assert.ok(firsts.every((d) => d.prompt.includes('ROLE TEXT') && /PACKET \d\d-/.test(d.prompt) && /never Read them/.test(d.prompt)));
  assert.ok(!dispatched.some((d) => /frame-packets\/0[38]-/.test(d.prompt)), 'never frame 3 or 8');
  // re-dispatches: the missing events file, the world request, the check round (with try's exact error), the dropped sounds (two or more)
  assert.equal(dispatched.filter((d) => /02-define\.js or its events file is missing/.test(d.prompt)).length, 1);
  assert.equal(dispatched.filter((d) => /added what you asked for/.test(d.prompt) && d.prompt.includes('04-analogy.md')).length, 1);
  const fix = dispatched.filter((d) => /build-check errors left/.test(d.prompt));
  assert.equal(fix.length, 1);
  assert.match(fix[0].prompt, /05-payoff: the subject leaves the frame/);
  assert.deepEqual(dispatched.filter((d) => /Rewrite your events file/.test(d.prompt)).map((d) => /assets\/frames\/([\w-]+)\.events/.exec(d.prompt)![1]), ['06-example']);
  assert.ok(!dispatched.some((d) => /finalize checks report/.test(d.prompt)), 'the caption-word overflow is ignored');
  // leftovers are named, the frames are marked animated, nothing is capped
  assert.ok(out.notes.some((n) => /03-handoff.*drawn 2 times/s.test(n)), 'a code frame\'s error is a note, never a dispatch');
  assert.ok(!out.notes.some((n) => /No music/.test(n)), 'music worked on its retry');
  assert.equal((fs.readFileSync(path.join(dir, 'STORYBOARD.md'), 'utf8').match(/status: animated/g) ?? []).length, 8);
  assert.equal(out.capped, false);
});

test('cost fix 1: an empty voice id stops the build; the cap stops dispatches but not code', async () => {
  const dir = project();
  const out = await runBuild({ projectDir: dir, voiceId: ' ', dispatch: async () => result(), overCap: () => false, log: () => undefined, exec: () => ok() });
  assert.equal(out.stopped, true);
  assert.match(out.notes[0], /HELIOS_VOICE_ID is empty/);

  const dir2 = project();
  let calls = 0;
  const steps: string[] = [];
  const exec = (program: 'node' | 'hyperframes', args: string[]) => {
    steps.push(path.basename(args[0]));
    if (path.basename(args[0]) === 'audio.mjs') fs.writeFileSync(path.join(dir2, 'audio_meta.json'), '{}');
    return ok();
  };
  const capped = await runBuild({ projectDir: dir2, voiceId: 'v', dispatch: async () => (calls++, result()), overCap: () => true, log: () => undefined, exec });
  assert.equal(calls, 0);
  assert.equal(capped.capped, true);
  assert.ok(steps.includes('assemble-index.mjs'), 'the code steps still run');
});

test('cost fix 1: world requests and finalize failures parse', () => {
  assert.deepEqual(worldRequests('Done.\nWORLD REQUEST: view kitchen: a low shot from the floor\n- `WORLD REQUEST: state oven: door open`'), ['view kitchen: a low shot from the floor', 'state oven: door open']);
  const f = finalizeFailures('{"findings":[{"file":"compositions/frames/04-analogy.html","severity":"error","code":"x","message":"bad"}]}', '{"layout":{"issues":[{"severity":"error","code":"text_box_overflow","selector":"#caption-word-1","message":"2px"},{"severity":"error","code":"overlap","selector":"#f06-score","message":"overlaps"}]}}');
  assert.deepEqual([...f.keys()].sort(), [4, 6]);
});

test('kit source is open to builders: no read block, no Grep cap', () => {
  const policy = fs.readFileSync(path.join(process.cwd(), 'lib/explainers/render/policy.ts'), 'utf8');
  assert.ok(!/export function kitAccess|KIT_GREPS_PER_BUILDER/.test(policy));
  const agent = fs.readFileSync(path.join(process.cwd(), 'lib/explainers/render/agent.ts'), 'utf8');
  assert.ok(!/Never Read kit source|kitAccess/.test(agent));
});

test('blocking: the frame builder gets its frame slice of blocking.json; the kit validates its shape', async () => {
  const { builderMessage, blockingSlice } = await import('@/lib/explainers/render/build');
  const { blockingFor, blockingProblems } = await import('../explainers/world-kit/blocking.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocking-'));
  fs.mkdirSync(path.join(dir, '.hyperframes', 'frame-packets'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.hyperframes', 'frame-packets', '_role.md'), 'role');
  fs.writeFileSync(path.join(dir, '.hyperframes', 'frame-packets', '04-x.md'), 'packet');
  assert.equal(blockingSlice(dir, '04-x'), null);
  assert.ok(!builderMessage(dir, '04-x').includes('<blocking'));
  const blocking = { main: { '04-x': { hero: { at: [0, 10, 0], state: { holding: 'cup' }, view: 'front' } }, '06-y': { cup: { at: [1, 2, 3] } } } };
  fs.mkdirSync(path.join(dir, 'assets', 'world'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'world', 'blocking.json'), JSON.stringify(blocking));
  const msg = builderMessage(dir, '04-x');
  assert.ok(msg.includes('<blocking path="assets/world/blocking.json" frame="04-x">'));
  assert.ok(msg.includes('"hero"') && !msg.includes('"cup": {'));
  assert.deepEqual(Object.keys(blockingFor(blocking, '06-y')), ['main']);
  assert.deepEqual(blockingProblems(blocking, ['04-x', '06-y'] as any), []);
  assert.equal(blockingProblems({ main: { '04-x': { hero: { at: [0, 1] } } } }).length, 1);
  assert.equal(blockingProblems({ main: { '09-z': {} } }, ['04-x'] as any).length, 1);
});

test('mechanism builders run on tech_frame_worker_model (Opus by default); world builders stay on frame_worker_model', async () => {
  const { builderModel } = await import('@/lib/explainers/render/job');
  const { DEFAULT_SETTINGS } = await import('@/lib/explainers/settings');
  assert.equal(DEFAULT_SETTINGS.tech_frame_worker_model, 'claude-opus-5-5');
  assert.equal(builderModel(DEFAULT_SETTINGS, 'claude-sonnet-5-5', 'frame-worker-tech'), 'claude-opus-5-5');
  assert.equal(builderModel(DEFAULT_SETTINGS, 'claude-sonnet-5-5', 'frame-worker-scene'), 'claude-sonnet-5-5');
  assert.equal(builderModel(DEFAULT_SETTINGS, 'claude-sonnet-5-5', 'scene-builder'), DEFAULT_SETTINGS.scene_builder_model);
  assert.equal(builderModel({}, 'claude-sonnet-5-5', 'frame-worker-tech'), 'claude-sonnet-5-5');
});
