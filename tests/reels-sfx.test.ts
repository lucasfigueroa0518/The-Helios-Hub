import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeSource, FLOOR_DB } from '@/lib/reels/sfx/analyze';
import { buildDraft, draftLength, DRAFT_SETTINGS, gateCurve, pickOffset } from '@/lib/reels/sfx/draft';
import { frameMap, frameStartSample } from '@/lib/reels/sfx/frame-map';
import { LIMITER_SETTINGS, limitToCeiling } from '@/lib/reels/sfx/limiter';
import { truePeak } from '@/lib/reels/sfx/true-peak';
import { readWav, writeWav16 } from '@/lib/reels/sfx/wav';

const RATE = 48_000;

/** A sine at `amplitude` from startMs to endMs, silence elsewhere. */
function tone(totalMs: number, spans: Array<{ startMs: number; endMs: number; amplitude: number }>): Float32Array {
  const out = new Float32Array((RATE * totalMs) / 1000);
  for (const span of spans) {
    for (let i = (RATE * span.startMs) / 1000; i < (RATE * span.endMs) / 1000; i += 1) {
      out[i] = span.amplitude * Math.sin((2 * Math.PI * 440 * i) / RATE);
    }
  }
  return out;
}

describe('SFX WAV reader', () => {
  it('round-trips 16-bit stereo', () => {
    const left = tone(20, [{ startMs: 0, endMs: 20, amplitude: 0.5 }]);
    const right = new Float32Array(left.length).fill(-0.25);
    const wav = readWav(writeWav16([left, right], RATE));
    assert.equal(wav.sampleRate, RATE);
    assert.equal(wav.bitDepth, 16);
    assert.equal(wav.channels.length, 2);
    assert.equal(wav.channels[0].length, left.length);
    assert.ok(Math.abs(wav.channels[0][100] - left[100]) < 1e-4);
    assert.ok(Math.abs(wav.channels[1][5] + 0.25) < 1e-4);
  });

  it('reads 24-bit PCM, including negative samples', () => {
    const bytes = writeWav16([new Float32Array(2)], RATE);
    const header = bytes.slice(0, 44);
    const view = new DataView(header.buffer);
    view.setUint32(28, RATE * 3, true);
    view.setUint16(32, 3, true);
    view.setUint16(34, 24, true);
    view.setUint32(40, 6, true);
    view.setUint32(4, 36 + 6, true);
    // 0x400000 = +0.5, 0xC00000 = -0.5
    const file = new Uint8Array([...header, 0x00, 0x00, 0x40, 0x00, 0x00, 0xc0]);
    const wav = readWav(file);
    assert.equal(wav.bitDepth, 24);
    assert.deepEqual([...wav.channels[0]], [0.5, -0.5]);
  });

  it('refuses a file that is not a WAV', () => {
    assert.throws(() => readWav(new Uint8Array(64)), /RIFF/);
  });
});

describe('SFX source analysis', () => {
  it('finds the audible span, the bursts, and their onsets', () => {
    const signal = tone(600, [
      { startMs: 100, endMs: 200, amplitude: 0.5 },
      // 25 dB down: audible, but not a burst.
      { startMs: 250, endMs: 300, amplitude: 0.5 * 10 ** (-25 / 20) },
      { startMs: 400, endMs: 450, amplitude: 0.5 },
    ]);
    const record = analyzeSource('fixture.wav', readWav(writeWav16([signal, signal], RATE)));
    assert.equal(record.durationMs, 600);
    assert.equal(record.envelope.db.length, 60);
    // A 0.5 sine has RMS 0.354, about -9 dBFS.
    assert.ok(Math.abs(record.envelopePeakDb + 9) < 0.2, `peak ${record.envelopePeakDb}`);
    assert.deepEqual(record.audible, { startMs: 100, endMs: 450 });
    assert.deepEqual(
      record.bursts.map(({ startMs, endMs }) => [startMs, endMs]),
      [
        [100, 200],
        [400, 450],
      ],
    );
    assert.deepEqual(record.onsetsMs, [100, 400]);
  });

  it('reports digital silence without inventing spans', () => {
    const record = analyzeSource('silent.wav', readWav(writeWav16([new Float32Array(4800)], RATE)));
    assert.equal(record.audible, null);
    assert.equal(record.audibleRmsDb, null);
    assert.deepEqual(record.bursts, []);
    assert.equal(record.envelopePeakDb, FLOOR_DB);
  });
});

describe('SFX frame map', () => {
  it('matches the plan table at 24 fps', () => {
    const double = frameMap('double');
    assert.deepEqual(double.on, [[0, 4], [7, 11]]);
    assert.deepEqual(double.off, [[5, 6]]);
    assert.equal(double.silentFromFrame, 14);
    const strobe = frameMap('strobe');
    assert.deepEqual(strobe.on, [[0, 1], [5, 6], [10, 11]]);
    assert.deepEqual(strobe.off, [[2, 4], [7, 9]]);
    assert.equal(strobe.silentFromFrame, 14);
    const tail = frameMap('tail');
    assert.deepEqual(tail.on, [[0, 1], [5, 6], [10, 13]]);
    assert.equal(tail.cushionEndFrame, 15);
    assert.equal(tail.silentFromFrame, 16);
  });

  it('puts frames on exact sample boundaries at 48 kHz', () => {
    assert.equal(frameStartSample(1), 2000);
    assert.equal(frameStartSample(14), 28_000);
  });
});

describe('SFX drafts', () => {
  const map = frameMap('strobe');

  it('gates every off-frame to zero and ends at the cushion', () => {
    const curve = gateCurve(map, RATE, DRAFT_SETTINGS);
    assert.equal(curve.length, draftLength(map, RATE));
    for (const [start, end] of map.off) {
      for (let i = frameStartSample(start); i < frameStartSample(end + 1); i += 1) assert.equal(curve[i], 0);
    }
    assert.equal(curve[frameStartSample(1)], 1);
    assert.ok(curve[frameStartSample(map.silentFromFrame) - 1] < 1e-6);
  });

  it('hits the RMS target on the flickers and leaves the gaps silent', () => {
    const steady = tone(1000, [{ startMs: 0, endMs: 1000, amplitude: 0.05 }]);
    const draft = buildDraft([steady, steady], map, RATE, 0);
    assert.ok(Math.abs(draft.metrics.onRmsDb - DRAFT_SETTINGS.targetRmsDb) < 0.2);
    assert.equal(draft.metrics.ceilingBound, false);
    assert.ok(draft.metrics.offPeakDb.every((db) => db === FLOOR_DB));
  });

  it('lets the peak ceiling win over the RMS target', () => {
    const spiky = tone(1000, [{ startMs: 0, endMs: 1000, amplitude: 0.01 }]);
    spiky[100] = 0.9;
    const draft = buildDraft([spiky], map, RATE, 0);
    assert.equal(draft.metrics.ceilingBound, true);
    assert.ok(Math.abs(draft.metrics.truePeakDb - DRAFT_SETTINGS.peakCeilingDb) < 0.2);
  });

  it('picks a start that keeps every flicker out of the source gaps', () => {
    // Sound, then a 150 ms hole, then sound. Starting at 0 would put the second flicker in the hole.
    const holed = tone(1200, [
      { startMs: 0, endMs: 220, amplitude: 0.5 },
      { startMs: 370, endMs: 1200, amplitude: 0.5 },
    ]);
    const offset = pickOffset([holed], map, RATE, { fromSample: 0, toSample: RATE });
    const draft = buildDraft([holed], map, RATE, offset);
    assert.ok(Math.min(...draft.metrics.spanRmsDb) > -30, `spans ${draft.metrics.spanRmsDb}`);
  });
});

describe('SFX true peak', () => {
  it('finds the inter-sample peak a sample meter misses', () => {
    // A quarter-rate sine sampled 45 degrees off its crest: every sample reads 0.707.
    const wave = new Float32Array(4800);
    for (let i = 0; i < wave.length; i += 1) wave[i] = Math.sin((Math.PI / 2) * i + Math.PI / 4);
    const samplePeak = Math.max(...wave.map(Math.abs));
    assert.ok(Math.abs(samplePeak - Math.SQRT1_2) < 1e-3);
    assert.ok(Math.abs(truePeak([wave]) - 1) < 0.02, `true peak ${truePeak([wave])}`);
  });
});

describe('SFX limiter', () => {
  it('holds the true peak under the ceiling, keeps silence silent, and never adds gain', () => {
    const signal = tone(300, [{ startMs: 0, endMs: 100, amplitude: 0.3 }, { startMs: 200, endMs: 300, amplitude: 0.3 }]);
    signal[2400] = 1.6; // one spike far over full scale
    const { channels, stats } = limitToCeiling([signal], -1, RATE);
    assert.ok(truePeak(channels) <= 10 ** (-1 / 20) * 1.001);
    for (let i = RATE * 0.1 + 100; i < RATE * 0.2 - 100; i += 1) assert.equal(channels[0][i], 0);
    for (let i = 0; i < signal.length; i += 1) assert.ok(Math.abs(channels[0][i]) <= Math.abs(signal[i]) + 1e-9);
    // 1.6 into a ceiling just under 0.89 needs about 5.4 dB. The release tail counts as limited time.
    assert.ok(stats.maxReductionDb > 4 && stats.maxReductionDb < 8, `reduction ${stats.maxReductionDb}`);
  });

  it('lets a Stage 3 draft reach a target that gain alone could not', () => {
    const spiky = tone(1000, [{ startMs: 0, endMs: 1000, amplitude: 0.05 }]);
    spiky[100] = 0.9;
    const settings = { ...DRAFT_SETTINGS, targetRmsDb: -16, limiter: LIMITER_SETTINGS };
    const draft = buildDraft([spiky], frameMap('strobe'), RATE, 0, settings);
    assert.ok(Math.abs(draft.metrics.onRmsDb + 16) < 0.2, `on ${draft.metrics.onRmsDb}`);
    assert.ok(draft.metrics.truePeakDb <= -0.99);
    assert.ok(draft.metrics.limiter);
  });
});
