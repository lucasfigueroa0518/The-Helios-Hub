import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prepareTts, restoreSpelling, restoreWords, ttsScript, ttsText } from '../explainers/reel-ai-drama/kit/pronounce.mjs';

const SAY = [{ word: 'Delangue', say: 'duh-LAHNG' }];
const SCRIPT = [
  '# SCRIPT — Example', '', '## L1 — Delangue arrives (Frame 1)', '', '**Lines:** L1', '',
  '    Clément Delangue\'s company, Hugging Face, grew. delangue said yes.', '',
].join('\n');

test('ttsText respells whole words only, any case, keeping possessives', () => {
  assert.equal(ttsText("Delangue's plan; delangue. Delanguex", SAY), "duh-LAHNG's plan; duh-LAHNG. Delanguex");
  assert.equal(ttsText('nothing here', []), 'nothing here');
});

test('ttsScript touches only the spoken lines', () => {
  const out = ttsScript(SCRIPT, SAY);
  assert.ok(out.includes('## L1 — Delangue arrives (Frame 1)'), 'heading keeps the spelling');
  assert.ok(out.includes("    Clément duh-LAHNG's company"));
  assert.ok(out.includes('duh-LAHNG said yes.'));
});

test('restoreWords puts the spelling back, joining split respellings', () => {
  const one = restoreWords([{ text: 'Clément', start: 0, end: 0.4 }, { text: "duh-LAHNG's", start: 0.5, end: 1 }, { text: 'company,', start: 1.1, end: 1.5 }], SAY);
  assert.deepEqual(one.words.map((w: { text: string }) => w.text), ['Clément', "Delangue's", 'company,']);
  assert.equal(one.restored, 1);
  const split = restoreWords([{ text: 'duh', start: 0, end: 0.2 }, { text: 'LAHNG.', start: 0.25, end: 0.6 }, { text: 'Next', start: 0.8, end: 1 }], SAY);
  assert.deepEqual(split.words, [{ text: 'Delangue.', start: 0, end: 0.6 }, { text: 'Next', start: 0.8, end: 1 }]);
});

test('prepareTts + restoreSpelling: TTS copy in, captions keep the spelling', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-pron-'));
  fs.writeFileSync(path.join(root, 'SCRIPT.md'), SCRIPT);
  const prep = prepareTts(root, SAY);
  assert.equal(prep.script, './SCRIPT.tts.md');
  assert.equal(fs.readFileSync(path.join(root, 'SCRIPT.md'), 'utf8'), SCRIPT, 'SCRIPT.md untouched');
  assert.ok(fs.readFileSync(path.join(root, 'SCRIPT.tts.md'), 'utf8').includes('duh-LAHNG'));
  fs.writeFileSync(path.join(root, 'audio_meta.json'), JSON.stringify({ voices: [{ frame: 1, words: [{ text: 'Clément', start: 0, end: 0.3 }, { text: "duh-LAHNG's", start: 0.4, end: 0.9 }] }] }));
  assert.deepEqual(restoreSpelling(root), { ok: true, restored: 1 });
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8'));
  assert.equal(meta.voices[0].words[1].text, "Delangue's");
  // No list → the plain script, nothing restored.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-pron-'));
  fs.writeFileSync(path.join(empty, 'SCRIPT.md'), SCRIPT);
  assert.equal(prepareTts(empty, []).script, './SCRIPT.md');
});
