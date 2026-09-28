import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { CLAP_SAMPLE_RATE } from '@/lib/reels/config';

/** Decoding, probing, and BPM for cached previews. All local: ffmpeg and the worker's Python venv. */

function run(bin: string, args: string[]): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'ENOENT' ? new Error(`${bin} is not installed.`) : error);
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
}

/** 48 kHz mono float32, the shape CLAP's feature extractor expects. */
export async function decodePcm(inputPath: string): Promise<Float32Array> {
  const result = await run('ffmpeg', [
    '-v', 'error', '-i', inputPath, '-ac', '1', '-ar', String(CLAP_SAMPLE_RATE), '-f', 'f32le', 'pipe:1',
  ]);
  if (result.code !== 0) throw new Error(`Could not decode the preview: ${result.stderr.slice(0, 300)}`);
  const bytes = result.stdout;
  const aligned = new ArrayBuffer(bytes.byteLength - (bytes.byteLength % 4));
  new Uint8Array(aligned).set(bytes.subarray(0, aligned.byteLength));
  return new Float32Array(aligned);
}

export async function probeDurationMs(inputPath: string): Promise<number | null> {
  const result = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputPath,
  ]);
  const seconds = Number(result.stdout.toString('utf8').trim());
  return result.code === 0 && Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

function pythonBin(): string {
  if (process.env.REELS_PYTHON) return process.env.REELS_PYTHON;
  const venv = path.join(process.cwd(), 'helios_text_engine/.venv/bin/python');
  return existsSync(venv) ? venv : 'python3';
}

export type BpmReading = { bpm: number | null; library: string; settings: Record<string, unknown> };

/** D-175: librosa's beat tracker on the worker. The library and its settings ride along for gate 1 (R4). */
export async function measureBpm(inputPath: string): Promise<BpmReading> {
  const script = path.join(process.cwd(), 'scripts/reels_bpm.py');
  const result = await run(pythonBin(), [script, inputPath]);
  if (result.code !== 0) throw new Error(`BPM failed: ${result.stderr.slice(-300)}`);
  const parsed = JSON.parse(result.stdout.toString('utf8')) as BpmReading;
  return { bpm: parsed.bpm == null ? null : Math.round(parsed.bpm * 10) / 10, library: parsed.library, settings: parsed.settings };
}
