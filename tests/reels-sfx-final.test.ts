import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { draftLength } from '@/lib/reels/sfx/draft';
import { frameMap, SFX_FPS, SFX_SAMPLE_RATE, SFX_TIMINGS } from '@/lib/reels/sfx/frame-map';
import { frameTest } from '@/lib/reels/sfx/frame-test';
import { FINAL_DIR, hookSfxPlan, SFX_FINAL_SETTINGS, sfxFileName, type SfxManifest } from '@/lib/reels/sfx/manifest';
import { motionRecord, type MotionPrompt } from '@/lib/reels/visual/motion-prompt';
import { SFX_PICKS } from '@/lib/reels/sfx/picks';
import { SFX_WAV_TOLERANCES } from '@/lib/reels/sfx/tolerances';
import { toDb } from '@/lib/reels/sfx/analyze';
import { truePeak } from '@/lib/reels/sfx/true-peak';
import { readWav } from '@/lib/reels/sfx/wav';
import { HOOKS } from '@/lib/reels/visual/hook';

/** Stage 4 frame test (SFX-09) over every finished file in the manifest. Offline. */
const manifest = JSON.parse(fs.readFileSync(path.join(FINAL_DIR, 'manifest.json'), 'utf8')) as SfxManifest;

describe('finished hook SFX', () => {
  it('has one file per hook and timing, from six different sources (SFX-03, D-129)', () => {
    for (const hook of HOOKS) {
      for (const timing of SFX_TIMINGS) {
        const entry = manifest.files[sfxFileName(hook, timing)];
        assert.ok(entry, `missing ${hook}-${timing}`);
        assert.equal(entry.source, SFX_PICKS[hook]);
      }
    }
    assert.equal(Object.keys(manifest.files).length, 18);
    assert.equal(new Set(Object.values(SFX_PICKS)).size, 6);
    assert.equal(manifest.fps, SFX_FPS);
    assert.equal(manifest.sampleRate, SFX_SAMPLE_RATE);
  });

  for (const [file, entry] of Object.entries(manifest.files)) {
    it(`${file} passes the frame test and matches the manifest`, () => {
      const bytes = fs.readFileSync(path.join(FINAL_DIR, file));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, 'file changed since the manifest was written');
      const wav = readWav(bytes);
      const map = frameMap(entry.timing, SFX_FPS);
      assert.equal(wav.sampleRate, SFX_SAMPLE_RATE);
      assert.equal(wav.channels[0].length, draftLength(map, SFX_SAMPLE_RATE), 'file must end at the cushion');

      const result = frameTest(wav, map, SFX_WAV_TOLERANCES);
      assert.ok(result.pass, result.failures.join(' '));

      // SFX-06 / D-131: matched loudness under the true-peak ceiling. 16-bit rounding allows a hair.
      assert.ok(Math.abs(entry.measured.onRmsDb - SFX_FINAL_SETTINGS.targetRmsDb) <= 0.2, `on ${entry.measured.onRmsDb}`);
      assert.ok(toDb(truePeak(wav.channels)) <= SFX_FINAL_SETTINGS.peakCeilingDb + 0.05);
    });
  }
});

describe('hook SFX at render time', () => {
  it('follows the hook actually stamped, including the invert fallback (SFX-07)', () => {
    assert.deepEqual(hookSfxPlan('glitch', 24, 'strobe', SFX_FPS), { file: 'glitch-strobe.wav' });
    assert.deepEqual(hookSfxPlan('invert', 24, 'tail', SFX_FPS), { file: 'invert-tail.wav' });
    assert.deepEqual(hookSfxPlan(null, 24, 'double', SFX_FPS), { file: null, notice: null });
    for (const hook of HOOKS) {
      for (const timing of SFX_TIMINGS) {
        const plan = hookSfxPlan(hook, 24, timing, SFX_FPS);
        assert.ok(plan.file && fs.existsSync(path.join(FINAL_DIR, plan.file)), `${hook}-${timing} has no file`);
      }
    }
  });

  it('ships silent with a notice when the clip is not 24 fps (D-123)', () => {
    const plan = hookSfxPlan('vhs', 30, 'double', SFX_FPS);
    assert.equal(plan.file, null);
    assert.match(String('notice' in plan && plan.notice), /30 fps/);
  });

  it('records the stamped hook, the routed hook when it differs, and the SFX (D-122)', () => {
    const prompt: MotionPrompt = { text: 'KLING', camera: 'in', cameraCurve: '', spans: [], profile: 'noir', polarity: null, warnings: [] };
    const fallback = motionRecord('invert', prompt, 'tail', { routedHook: 'glitch', sfx: 'invert-tail.wav' });
    assert.match(fallback, /^Hook: invert\nRouted hook: glitch\nHook timing: tail\nHook SFX: invert-tail.wav\n/);
    const none = motionRecord(null, prompt, 'double', { routedHook: 'vhs', sfx: null });
    assert.match(none, /^Hook: none\nRouted hook: vhs\nHook timing: double\nHook SFX: none\n/);
    const same = motionRecord('vhs', prompt, 'strobe', { routedHook: 'vhs', sfx: 'vhs-strobe.wav' });
    assert.doesNotMatch(same, /Routed hook/);
  });
});
