/**
 * Central intake Phase 3: the shared photo finder side by side with what each post actually shipped
 * (planning/Central Intake/PHASE3-CONTRACT.md, Owner D).
 *
 *   npx tsx scripts/photos/compare.ts                      dry: prints the posts and their needs; no model or Serper calls
 *   npx tsx scripts/photos/compare.ts --types lfd,md --posts 1
 *   env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL \
 *     npx tsx scripts/photos/compare.ts --go [--cap 2.80]   live (the lead runs this, never an agent)
 *
 * Live runs MUST unset ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL as above: Claude Code's
 * environment shadows the project key, and .env.local only fills variables that are unset.
 *
 * Prod is read only: every query goes through readOnlyQuery (BEGIN READ ONLY / query / ROLLBACK on one client),
 * never a session-level SET, never a write. The photo bank is read but never offered to (bankWrites: false).
 * `--go` output: planning/Central Intake/phase3-review/{index.html,results.json}. Dry mode writes no files.
 */
import fs from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { readOnly, type ReadPool } from '@/lib/photos/compare/db';
import { renderHtml } from '@/lib/photos/compare/html';
import { DEFAULT_POSTS, excludeFor, loadType, type ComparePost, type SkippedPost } from '@/lib/photos/compare/plan';
import { planLines, runComparison } from '@/lib/photos/compare/run';
import { PHOTO_PROFILE_IDS, type PhotoProfileId } from '@/lib/photos/types';

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));

type Args = { go: boolean; capUsd: number; types: PhotoProfileId[]; posts: number | null };

function parseArgs(argv: string[]): Args {
  const val = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const capRaw = val('--cap');
  const capUsd = capRaw === undefined ? 2.8 : Number(capRaw);
  if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error(`--cap must be a positive number (got ${capRaw})`);
  const typesRaw = val('--types');
  const types = typesRaw ? typesRaw.split(',').map((t) => t.trim()).filter(Boolean) : [...PHOTO_PROFILE_IDS];
  for (const t of types) if (!PHOTO_PROFILE_IDS.includes(t as PhotoProfileId)) throw new Error(`unknown type ${t} (use ${PHOTO_PROFILE_IDS.join(',')})`);
  const postsRaw = val('--posts');
  const posts = postsRaw === undefined ? null : Number(postsRaw);
  if (posts !== null && (!Number.isInteger(posts) || posts < 1)) throw new Error(`--posts must be a positive integer (got ${postsRaw})`);
  return { go: argv.includes('--go'), capUsd, types: types as PhotoProfileId[], posts };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (.env.local)');
  const pool = new pg.Pool({ connectionString: url, max: 1, ssl: /@(127\.0\.0\.1|localhost)[:/]/.test(url) ? false : { rejectUnauthorized: false } });
  pool.on('error', (err) => console.error(`db: ${err.message}`));
  const q = readOnly(pool as unknown as ReadPool);
  try {
    const posts: ComparePost[] = [];
    const skipped: SkippedPost[] = [];
    for (const type of args.types) {
      const part = await loadType(q, type, args.posts ?? DEFAULT_POSTS[type]);
      posts.push(...part.posts);
      skipped.push(...part.skipped);
    }
    const deps = args.go ? await (await import('@/lib/photos/live')).livePhotoDeps(process.env, { bankWrites: false }) : undefined;
    const find = args.go ? (await import('@/lib/photos/find')).findPhotos : undefined;
    const results = await runComparison(posts, skipped, { mode: args.go ? 'go' : 'dry', capUsd: args.capUsd, find, deps, exclude: (p) => excludeFor(q, p), log: (l) => console.log(l) });
    for (const line of planLines(results)) console.log(line);
    if (args.go) {
      const dir = path.join(process.cwd(), 'planning', 'Central Intake', 'phase3-review');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
      fs.writeFileSync(path.join(dir, 'index.html'), renderHtml(results));
      console.log(`Wrote ${path.relative(process.cwd(), dir)}/index.html and results.json`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
