// The analogy fix pass (analogy:no_pass) and the picture fix round's skip, offline with stubs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { analogyFixPass } from '@/lib/explainers/render/job';
import { pictureFixNeeded, RISKY_AT, frameRisk, type ManifestFrame } from '@/lib/explainers/render/picture';
import { ANALOGY_FIX_PROMPT, FINDINGS_FILE } from '@/lib/explainers/render/understanding';
import type { SessionResult } from '@/lib/explainers/render/agent';

const ok = (over: Partial<SessionResult> = {}): SessionResult => ({ sessionId: 's', subtype: 'success', isError: false, totalCostUsd: 0.1, modelUsage: {}, capped: false, denials: [], errors: [], lastText: 'done', ...over });
const project = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analogy-fix-'));
  fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), 'board v1');
  fs.writeFileSync(path.join(dir, 'SCRIPT.md'), 'script v1');
  return dir;
};

test('analogy:no_pass: the director gets one PHASE: fix pass on mapping findings, and its plan goes ahead', async () => {
  const dir = project();
  const seen: { prompt: string; findings: { serious: { cause: string; reader: string; reader_quote: string }[] } }[] = [];
  const out = await analogyFixPass({
    projectDir: dir, analogy: 'a mail sorter', misses: ['two parts map to one real thing', 'the boundary is unclear'], storyboard: 'board v1', script: 'script v1', model: 'm',
    session: async (prompt) => {
      seen.push({ prompt, findings: JSON.parse(fs.readFileSync(path.join(dir, FINDINGS_FILE), 'utf8')) });
      fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), 'board v2');
      fs.writeFileSync(path.join(dir, 'SCRIPT.md'), 'script v2');
      return ok();
    },
  });
  assert.equal(seen.length, 1, 'one pass');
  assert.equal(seen[0].prompt, ANALOGY_FIX_PROMPT);
  assert.match(seen[0].prompt, /PHASE: fix/);
  assert.deepEqual(seen[0].findings.serious.map((f) => [f.cause, f.reader, f.reader_quote]), [['mapping', 'analogy_check', 'two parts map to one real thing'], ['mapping', 'analogy_check', 'the boundary is unclear']]);
  assert.deepEqual(out, { storyboard: 'board v2', script: 'script v2', ran: true });
  assert.ok(!fs.existsSync(path.join(dir, FINDINGS_FILE)), 'the findings file does not linger for the understanding test');
});

let dirNow = '';
test('analogy:no_pass fails open: a session that throws, errors or loses the plan keeps the plan as it was', async () => {
  for (const session of [
    async () => { throw new Error('boom'); },
    async () => ok({ isError: true, subtype: 'error_during_execution' }),
    async (_p: string) => { fs.writeFileSync(path.join(dirNow, 'STORYBOARD.md'), ''); return ok(); },
  ]) {
    dirNow = project();
    const out = await analogyFixPass({ projectDir: dirNow, analogy: 'x', misses: [], storyboard: 'board v1', script: 'script v1', model: 'm', session });
    assert.deepEqual(out, { storyboard: 'board v1', script: 'script v1', ran: false });
    assert.equal(fs.readFileSync(path.join(dirNow, 'STORYBOARD.md'), 'utf8'), 'board v1');
  }
});

test('picture fix round: skipped for a frame that passes every code check and is low risk', () => {
  const frame = (over: Partial<ManifestFrame> = {}): ManifestFrame => ({ id: '04-analogy', number: 4, look: 'world', stills: [{ t: 0, file: 'a', shot: 0 }, { t: 1, file: 'b', shot: 1 }], ...over });
  assert.equal(pictureFixNeeded(frame(), []), false, 'clean and quiet: no fix');
  assert.equal(pictureFixNeeded(frame(), [{ source: 'storyboard', rule: 'breakage:framing', frame: 4, severity: 'warning', detail: 'x' }]), true, 'a code check still failing: fix');
  assert.equal(pictureFixNeeded(frame(), [{ source: 'storyboard', rule: 'breakage:framing', frame: 5, severity: 'warning', detail: 'x' }]), false, "another frame's breakage does not count");
  const risky = frame({ look: 'blend', stills: [0, 1, 2, 3].map((s) => ({ t: s, file: String(s), shot: s })) });
  assert.ok(frameRisk(risky, []) >= RISKY_AT);
  assert.equal(pictureFixNeeded(risky, []), true, 'high risk: fix even with no breakage');
});
