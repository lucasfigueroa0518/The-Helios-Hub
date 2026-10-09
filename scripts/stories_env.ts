/**
 * Load .env.local for Stories scripts before anything reads process.env, the
 * way scripts/reels_worker.ts does (Next.js does this for the app, plain tsx
 * does not). Values already in the environment win. Import it first.
 */
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
  }
}
