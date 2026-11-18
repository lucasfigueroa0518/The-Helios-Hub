import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { catalogMissWatcher, CATALOG_REL, FULL_REL, restoreCatalog, splitCatalog, trimCatalog } from '@/lib/explainers/injection/catalog';
import { applyGuidance, emptyLedger, errorKind, foldRender, governingSections, guidance, type ContextLog } from '@/lib/explainers/injection/ledger';
import { frameOfLabel, InjectionRun, missOf, tryErrorsOfText } from '@/lib/explainers/injection/recorder';
import { coreStack, loadIndex, prepareSections, splitSections } from '@/lib/explainers/injection/sections';
import { jevPick, pickerSet } from '@/lib/explainers/jev/questions/section-picker';
import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { instructionStack } from '@/lib/explainers/render/agent';

// All offline: Jev is a stub (CLAUDE.md Rule 1).

const REPO_FILES: Record<string, string> = {
  craft: 'explainers/recipe/craft.md',
  'house-style': 'explainers/recipe/house-style.md',
  minimums: 'explainers/recipe/minimums.md',
  frame: 'explainers/recipe/frame.md',
  kit: 'explainers/world-kit/KIT-REFERENCE.md',
};

/** A project holding the real stack at the paths the index names. */
function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inj-'));
  const index = loadIndex();
  for (const [source, rel] of Object.entries(index.sources)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(REPO_FILES[source], path.join(dir, rel));
  }
  return dir;
}

function stubJev(score: (question: string) => number, fail = false): ExplainersJevRunner & { calls: number } {
  return {
    calls: 0,
    usd: 0,
    get callCount() {
      return this.calls;
    },
    async ask(req) {
      this.calls++;
      if (fail) throw new Error('down');
      const answers = Object.fromEntries(Object.entries(req.questions).map(([k, q]) => [k, { noul: score(String((q as { instructions?: { question?: string } }).instructions?.question ?? "")) }]));
      return { answers, usage: { input_tokens: 10, output_tokens: 1 }, model: 'jev-stub' } as never;
    },
  } as ExplainersJevRunner & { calls: number };
}

test('every ## section of the builder stack has an index entry (no untagged instructions)', () => {
  const index = loadIndex();
  const missing: string[] = [];
  for (const [source, rel] of Object.entries(REPO_FILES)) {
    for (const s of splitSections(source, fs.readFileSync(rel, 'utf8'))) if (!index.sections[s.id]) missing.push(s.id);
  }
  assert.deepEqual(missing, []);
  for (const [id, e] of Object.entries(index.sections)) {
    assert.ok(['core', 'pick', 'ref'].includes(e.tier), id);
    assert.ok(e.summary.length > 5, id);
  }
});

test('the core stack is much smaller than the full stack, and turns on only once sections are prepared', () => {
  const dir = project();
  const full = instructionStack(dir);
  const sections = prepareSections(dir)!;
  const core = instructionStack(dir);
  assert.ok(core.length < full.length * 0.45, `${core.length} vs ${full.length}`);
  assert.equal(core, coreStack(dir, loadIndex()));
  assert.ok(core.includes('## The build checks'));
  assert.ok(!core.includes('## lens.js'));
  const rest = sections.filter((s) => s.tier !== 'core');
  for (const s of rest) assert.ok(fs.existsSync(path.join(dir, '.hyperframes', 'sections', `${s.id.replace(':', '--')}.md`)));
  assert.match(fs.readFileSync(path.join(dir, '.hyperframes', 'sections', 'INDEX.md'), 'utf8'), /kit--lens-js\.md/);
});

test('the picker set has one unique question per candidate and a version from its content', () => {
  const a = pickerSet('sections', [{ id: 'kit:lens-js', label: 'lens', summary: 'camera' }, { id: 'kit:lens.js', label: 'lens2', summary: 'x' }]);
  assert.equal(Object.keys(a.set.questions).length, 2);
  const b = pickerSet('sections', [{ id: 'kit:lens-js', label: 'lens', summary: 'camera!' }]);
  assert.notEqual(a.set.version, b.set.version);
});

test('jevPick keeps what scores at or above the bar, batches, and picks everything when Jev fails', async () => {
  const cands = Array.from({ length: 30 }, (_, i) => ({ id: `s:${i}`, label: `S${i}`, summary: i % 2 ? 'odd' : 'even' }));
  const jev = stubJev((q) => (q.includes('odd') ? 0.9 : 0.1));
  const r = await jevPick(jev, 'sections', cands, { role: 'x' });
  assert.equal(jev.calls, 2);
  assert.equal(r.picked.length, 15);
  const down = await jevPick(stubJev(() => 0, true), 'sections', cands, { role: 'x' });
  assert.equal(down.picked.length, 30);
  assert.equal(down.failed, 2);
});

const ctx = (over: Partial<ContextLog>): ContextLog => ({ label: 'frame:build:05-x', role: 'frame-worker-tech', look: 'mechanism', frame: '05-x', injected: [], scores: {}, misses: [], firstTry: null, ...over });

test('a section missed in 2 of the last 5 renders is promoted; a recurring first-try error becomes a lesson', () => {
  let l = emptyLedger();
  l = foldRender(l, { jobId: 'a', at: '1', contexts: [ctx({ misses: ['kit:glass-js'], firstTry: ['05-x: the critter "Bo" vanishes at 1.20s and comes back at 2.00s'] })] });
  assert.deepEqual(guidance(l, 'frame-worker-tech', 'mechanism').always, []);
  l = foldRender(l, { jobId: 'b', at: '2', contexts: [ctx({ misses: ['kit:glass-js'], firstTry: ['05-x: the critter "Al" vanishes at 3.10s and comes back at 4.00s'] })] });
  const g = guidance(l, 'frame-worker-tech', 'mechanism');
  assert.ok(g.always.includes('kit:glass-js'));
  // the critter error governs frame:critters, which was not injected: a miss twice → promoted too
  assert.ok(g.always.includes('frame:critters'));
  assert.equal(g.lessons.length, 1);
  // a kind no rule covers yet: its normalized text, never another reel's names or numbers
  assert.match(g.lessons[0], /^Avoid this self-check error: the critter "…" vanishes at Ns/);
  assert.doesNotMatch(g.lessons[0], /Bo|Al|\d/);
  // another role and look is untouched
  assert.deepEqual(guidance(l, 'scene-builder', 'world').always, []);
  // overrides win
  l.overrides.never['*'] = ['kit:glass-js'];
  assert.ok(!guidance(l, 'frame-worker-tech', 'mechanism').always.includes('kit:glass-js'));
});

test('a section injected 10 renders running on borderline scores, never missed, is demoted', () => {
  let l = emptyLedger();
  for (let i = 0; i < 10; i++) l = foldRender(l, { jobId: `j${i}`, at: String(i), contexts: [ctx({ injected: ['kit:mark-js', 'kit:lens-js'], scores: { 'kit:mark-js': 0.4, 'kit:lens-js': 0.9 } })] });
  const g = guidance(l, 'frame-worker-tech', 'mechanism');
  assert.deepEqual(g.demoted, ['kit:mark-js']);
  assert.deepEqual(applyGuidance(['kit:mark-js', 'kit:lens-js'], { 'kit:mark-js': 0.5, 'kit:lens-js': 0.5 }, g, 0.35), ['kit:lens-js']);
});

test('errors normalise to one kind and point at the sections that govern them', () => {
  assert.equal(errorKind('the critter "Bo" vanishes at 1.20s'), errorKind('the critter "Al" vanishes at 3.40s'));
  assert.ok(governingSections('SIZES.cup must be { w, d, h }').includes('kit:props-js'));
});

test('the recorder reads labels, misses and try output', () => {
  assert.equal(frameOfLabel('frame:checks:05-payoff'), '05-payoff');
  assert.equal(frameOfLabel('scene-builder:fix'), null);
  const byFile = new Map([['kit--lens-js.md', 'kit:lens-js']]);
  assert.equal(missOf('/job/project/.hyperframes/sections/kit--lens-js.md', byFile), 'kit:lens-js');
  assert.equal(missOf('/job/project/STORYBOARD.md', byFile), null);
  assert.deepEqual(tryErrorsOfText('ok\n{"ok": false, "errors": ["a", "b"]}'), ['a', 'b']);
  assert.deepEqual(tryErrorsOfText('{"ok": false, "problems": [{"frame": "05-x", "message": "m"}]}'), ['05-x: m']);
});

test('a dispatch gets picked sections and lessons in front, logs its misses and first try, and folds into the ledger', async () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.hyperframes', 'frame-packets'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.hyperframes', 'frame-packets', '05-x.md'), 'Show the GPU screen in glass.');
  const ledgerFile = path.join(dir, 'ledger.json');
  const jev = stubJev((q) => (/glass|camera/.test(q) ? 0.9 : 0.05));
  const run = new InjectionRun({ projectDir: dir, jobId: 'job1', telemetryDir: path.join(dir, 'telemetry'), ledgerFile, jev, log: () => {} });
  assert.ok(run.prepare());
  const d = await run.dispatch('frame-worker-tech', 'TASK', 'frame:build:05-x', 'mechanism');
  assert.match(d.prompt, /<section id="kit:glass-js"/);
  assert.ok(!d.prompt.includes('<section id="kit:mark-js"'));
  assert.ok(d.prompt.endsWith('TASK'));
  d.onMessage({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: path.join(dir, '.hyperframes/sections/kit--cast-js.md') } }, { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'node assets/kit/try.mjs frame 05-x' } }] } });
  d.onMessage({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: '{"ok":false,"errors":["05-x: the critter \\"Bo\\" vanishes at 1.20s"]}' }] } });
  d.end();
  // a fix round reuses the same picks (one Jev pass per window)
  const calls = jev.calls;
  await run.dispatch('frame-worker-tech', 'FIX', 'frame:checks:05-x', 'mechanism');
  assert.equal(jev.calls, calls);
  run.finish();
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  assert.equal(ledger.renders.length, 1);
  assert.deepEqual(ledger.renders[0].contexts[0].misses, ['kit:cast-js']);
  assert.equal(ledger.renders[0].contexts[0].firstTry.length, 1);
  assert.ok(fs.readFileSync(path.join(dir, 'telemetry', 'injection.jsonl'), 'utf8').includes('"kind":"summary"'));
});

test('without sections the dispatch is untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inj-empty-'));
  const run = new InjectionRun({ projectDir: dir, jobId: 'j', telemetryDir: dir, ledgerFile: path.join(dir, 'l.json'), jev: null, log: () => {} });
  assert.equal(run.prepare(), false);
  assert.equal((await run.dispatch('scene-builder', 'P', 'scene-builder', 'world')).prompt, 'P');
});

test('the planner catalog is trimmed to Jev picks and restored after session A', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inj-cat-'));
  fs.mkdirSync(path.join(dir, path.dirname(CATALOG_REL)), { recursive: true });
  const md = fs.readFileSync('explainers/world-kit/props/CATALOG.md', 'utf8');
  fs.writeFileSync(path.join(dir, CATALOG_REL), md);
  const total = splitCatalog(md).entries.length;
  assert.ok(total > 100);
  const r = await trimCatalog({ projectDir: dir, jev: stubJev((q) => (/kitchen|fridge|kettle/i.test(q) ? 0.8 : 0.1)), ledger: emptyLedger(), state: { topic: 'caching' } });
  assert.ok(r.trimmed && r.kept > 0 && r.kept < total);
  assert.ok(fs.existsSync(path.join(dir, FULL_REL)));
  assert.match(fs.readFileSync(path.join(dir, CATALOG_REL), 'utf8'), /CATALOG-FULL\.md/);
  const w = catalogMissWatcher();
  w.onMessage({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'assets/kit/props/CATALOG-FULL.md' } }] } });
  assert.ok(w.missed());
  restoreCatalog(dir);
  assert.equal(fs.readFileSync(path.join(dir, CATALOG_REL), 'utf8'), md);
  // the ledger can turn the trim off
  const l = emptyLedger();
  l.overrides.always['planner|catalog'] = ['catalog:full'];
  assert.equal((await trimCatalog({ projectDir: dir, jev: stubJev(() => 0.1), ledger: l, state: {} })).trimmed, false);
});
