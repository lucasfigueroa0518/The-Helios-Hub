// One ingest worker thread (ingest-inbox.mjs runs one per CPU core): measure a file, and unless it
// is rejected or this is a dry run, write its trimmed, normalized MP3. The file is decoded once
// (48 kHz stereo PCM in memory); the measurements come from that PCM, and the encoder reads the
// same PCM, already trimmed, from a pipe (no second decode of the original).

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parentPort } from 'node:worker_threads';

import { analyze, analyzeStereo, decode, decodeStereo, OUT_SR } from './measure.mjs';
import { encodeArgs, rejectReason, trimFor } from './ingest-inbox.mjs';

parentPort.on('message', (task) => {
  const { key, src, out, mode, ffmpeg = 'ffmpeg', dryRun = false } = task;
  try {
    if (mode === 'measure') {
      const samples = decode(src, ffmpeg);
      return parentPort.postMessage({ key, m: samples ? analyze(samples) : null });
    }
    const pcm = decodeStereo(src, ffmpeg);
    const m = pcm ? analyzeStereo(pcm) : null;
    const why = rejectReason(m);
    if (why || dryRun) return parentPort.postMessage({ key, m, why });
    mkdirSync(dirname(out), { recursive: true });
    const trim = trimFor(m);
    const from = Math.min(pcm.length, Math.round(trim.lead * OUT_SR) * 2);
    const body = pcm.subarray(from);
    const r = spawnSync(ffmpeg, encodeArgs(out, trim), { input: Buffer.from(body.buffer, body.byteOffset, body.byteLength), encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status !== 0) return parentPort.postMessage({ key, m, why: `conversion failed: ${String(r.error?.message ?? r.stderr).trim().slice(0, 200)}` });
    parentPort.postMessage({ key, m, converted: true });
  } catch (e) {
    parentPort.postMessage({ key, m: null, why: `failed: ${String(e?.message ?? e).slice(0, 200)}` });
  }
});
