import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ColorProfile } from '@/lib/reels/visual/color';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../helios_text_engine');

export type BackgroundQa = {
  pass: boolean;
  reasons: string[];
  mean_luma: number;
  bright_fraction: number;
  width: number;
  height: number;
};

export type RenderedText = {
  png: Buffer;
  lines: string[];
  warnings: string[];
};

function pythonBin(): string {
  const venv = path.join(ENGINE_DIR, '.venv', 'bin', 'python');
  if (existsSync(venv)) return venv;
  return 'python3';
}

function runEngine(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), [path.join(ENGINE_DIR, 'engine.py'), ...args], {
      cwd: ENGINE_DIR,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 15_000);
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code, signal) => {
      finish(() => {
        if (signal === 'SIGKILL') {
          reject(
            new Error(
              'The text engine did not finish. The on-screen copy is likely too long for a four-line frame.',
            ),
          );
          return;
        }
        resolve({
          code: code ?? 1,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
        });
      });
    });
  });
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

export async function checkBackgroundPng(png: Buffer, profile: ColorProfile = 'noir'): Promise<BackgroundQa> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'helios-bg-'));
  const bg = path.join(dir, 'bg.png');
  try {
    await writeFile(bg, png);
    const result = await runEngine(['check-bg', '--bg', bg, '--profile', profile]);
    if (!result.stdout.trim()) {
      throw new Error(result.stderr.trim() || `Background check failed (${result.code}).`);
    }
    const qa = parseJson<BackgroundQa>(result.stdout);
    return qa;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Transparent plate at the clip's pixel size. Same type, stroke, and line breaks as the still. */
export async function renderTextPlate(
  copy: string,
  width: number,
  height: number,
  profile: ColorProfile = 'noir',
): Promise<{ png: Buffer; lines: string[]; warnings: string[] }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'helios-plate-'));
  const out = path.join(dir, 'plate.png');
  try {
    const result = await runEngine([
      'plate',
      '--copy',
      copy,
      '--width',
      String(width),
      '--height',
      String(height),
      '--out',
      out,
      '--profile',
      profile,
    ]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `Text plate failed (${result.code}).`);
    }
    const summary = parseJson<{ lines?: string[]; warnings?: string[] }>(result.stdout);
    return {
      png: await readFile(out),
      lines: summary.lines ?? [],
      warnings: summary.warnings ?? [],
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function renderTextPng(
  png: Buffer,
  copy: string,
  profile: ColorProfile = 'noir',
): Promise<{ ok: true; rendered: RenderedText } | { ok: false; error: string; details: unknown }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'helios-frame-'));
  const bg = path.join(dir, 'bg.png');
  const out = path.join(dir, 'frame.png');
  try {
    await writeFile(bg, png);
    const result = await runEngine(['render', '--bg', bg, '--copy', copy, '--out', out, '--profile', profile]);
    if (result.code === 2) {
      let details: unknown = null;
      let error = 'Copy does not fit the frame.';
      try {
        const parsed = parseJson<{ error?: string; details?: unknown }>(result.stderr);
        error = parsed.error ?? error;
        details = parsed.details ?? null;
      } catch {
        error = result.stderr.trim() || error;
      }
      return { ok: false, error, details };
    }
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `Text render failed (${result.code}).`);
    }
    const summary = parseJson<{ lines?: string[]; warnings?: string[] }>(result.stdout);
    return {
      ok: true,
      rendered: {
        png: await readFile(out),
        lines: summary.lines ?? [],
        warnings: summary.warnings ?? [],
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
