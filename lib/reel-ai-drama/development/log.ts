import fs from 'node:fs';
import path from 'node:path';

/** Where every live response is appended (CONTRACT.md § Rules: one JSONL line per response). */
export const LOG_DIR = path.join(process.cwd(), '.explainers-local', 'reel-ai-drama', 'logs');

export function appendJsonl(component: string, entry: unknown, dir: string = LOG_DIR, now: Date = new Date()): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${component}-${now.toISOString().slice(0, 10)}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify({ at: now.toISOString(), ...(entry as object) })}\n`);
}
