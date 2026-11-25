/**
 * The one Helios voice (planning/Caption Voice/PLAN.md, 2026-11-24): tone and style shared by every
 * caption writer and the comment bot. Structure lives in each caption prompt; the comment bot's
 * routing and length live in lib/personality/prompts.ts.
 *
 * Read from disk on every call, so the voice can be edited and re-tried with no rebuild. It is static
 * text: callers put it in the cached system prefix (CLAUDE.md prompt caching).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const HELIOS_VOICE_FILE = 'lib/social/voice/helios-voice.md';

export function readHeliosVoice(root?: string): string {
  // The literal process.cwd() path lets Next's file tracing ship the file with the comment lab on Vercel.
  const file = root ? path.join(root, HELIOS_VOICE_FILE) : path.join(process.cwd(), 'lib/social/voice/helios-voice.md');
  return readFileSync(file, 'utf8').trim();
}
