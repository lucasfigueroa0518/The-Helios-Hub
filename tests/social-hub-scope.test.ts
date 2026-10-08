/**
 * Social Hub scope guard as a test (BUILD_PLAN §S4, §S5).
 *  1. Hub code writes SQL only to the `social_hub` schema.
 *  2. Hub read code never reaches a module that makes network calls
 *     (Graph, Anthropic, Jev, Storage, fetch), even transitively. Only the
 *     flagged action routes under app/api/social-hub/actions/ may.
 *  3. Every action flag ships off; the hub is read-only.
 *  4. package.json and the lockfile are byte-identical to the run's baseline.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ACTION_FLAGS, SOCIAL_HUB_FLAGS, actionEnabled, hubIsReadOnly } from '@/lib/social-hub/flags';

const ROOT = process.cwd();
const ACTIONS_DIR = 'app/api/social-hub/actions/';

function walk(dir: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = path.posix.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const HUB_FILES = [
  ...walk('lib/social-hub'),
  ...walk('app/api/social-hub'),
  ...walk('app/social/(hub)'),
  ...walk('components/social-hub'),
];

/** Strip comments so prose ("delete from the list") never trips the SQL scan. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const WRITE = new RegExp(
  '\\b(INSERT\\s+INTO|MERGE\\s+INTO|UPDATE(?:\\s+ONLY)?|DELETE\\s+FROM(?:\\s+ONLY)?|COPY|GRANT\\s+\\w+\\s+ON|ALTER\\s+TABLE(?:\\s+IF\\s+EXISTS)?|' +
    'DROP\\s+(?:TABLE|SCHEMA|INDEX|VIEW|MATERIALIZED\\s+VIEW|FUNCTION|TRIGGER)(?:\\s+IF\\s+EXISTS)?|' +
    'CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:TABLE|SCHEMA|INDEX|UNIQUE\\s+INDEX|VIEW|MATERIALIZED\\s+VIEW|FUNCTION|TRIGGER)(?:\\s+IF\\s+NOT\\s+EXISTS)?|' +
    'TRUNCATE(?:\\s+TABLE)?)\\s+(\\$\\{[^}]*\\}|[A-Za-z_"][\\w".]*)',
  'gi',
);

/**
 * Every SQL write in `text`, with its target. A target built at runtime
 * (`${table}`) can't be proven to be social_hub, so it counts as foreign.
 */
export function sqlWriteTargets(text: string): Array<{ verb: string; target: string }> {
  const body = code(text);
  const found: Array<{ verb: string; target: string }> = [];
  for (const match of body.matchAll(WRITE)) {
    const verb = match[1]!.replace(/\s+/g, ' ').toUpperCase();
    const target = match[2]!.replace(/"/g, '');
    if (verb.startsWith('UPDATE')) {
      // Only SQL-shaped: `UPDATE <table> [AS x] SET`. Prose and JS identifiers are not writes.
      const tail = body.slice(match.index! + match[0].length, match.index! + match[0].length + 60);
      if (!/^\s+(?:AS\s+)?(?:\w+\s+)?SET\b/i.test(tail)) continue;
    }
    if (verb === 'COPY' && !/^\s*(?:\([^)]*\)\s*)?FROM\b/i.test(body.slice(match.index! + match[0].length, match.index! + match[0].length + 80))) continue;
    found.push({ verb, target });
  }
  return found;
}

test('the SQL scanner catches writes and ignores prose', () => {
  assert.deepEqual(sqlWriteTargets('`INSERT INTO reels.runs (a) VALUES (1)`').map((w) => w.target), ['reels.runs']);
  assert.deepEqual(sqlWriteTargets('`UPDATE social.posting_schedule SET approved_at = now()`').map((w) => w.target), ['social.posting_schedule']);
  assert.deepEqual(sqlWriteTargets('`CREATE TABLE IF NOT EXISTS social_hub.refreshes (id int)`').map((w) => w.target), ['social_hub.refreshes']);
  assert.deepEqual(sqlWriteTargets('// update the list when it changes\nconst update = 1;'), []);
  assert.deepEqual(sqlWriteTargets('`insert into reels.runs (a) values (1)`').map((w) => w.target), ['reels.runs']);
  assert.deepEqual(sqlWriteTargets('`UPDATE ${table} SET x = 1`').map((w) => w.target), ['${table}']);
  assert.deepEqual(sqlWriteTargets('`MERGE INTO social.posts p USING x`').map((w) => w.verb), ['MERGE INTO']);
  assert.deepEqual(sqlWriteTargets('`update only reels.runs set a = 1`').map((w) => w.target), ['reels.runs']);
  assert.deepEqual(sqlWriteTargets('const updated = rows.filter((r) => r.update);'), []);
});

test('the scan covers the hub (never vacuous)', () => {
  assert.ok(HUB_FILES.includes('lib/social-hub/flags.ts'));
  assert.ok(HUB_FILES.length >= 10, `only ${HUB_FILES.length} hub files found`);
});

test('hub code writes SQL only to the social_hub schema', () => {
  const offenders: string[] = [];
  for (const file of HUB_FILES) {
    for (const write of sqlWriteTargets(readFileSync(path.join(ROOT, file), 'utf8'))) {
      if (!write.target.startsWith('social_hub.')) offenders.push(`${file}: ${write.verb} ${write.target}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// ── Network reachability ────────────────────────────────────────────────────

const NETWORK_PACKAGES = [
  '@anthropic-ai/sdk',
  '@supabase/supabase-js',
  '@typesafe-ai/sdk',
  'resend',
  '@octokit/rest',
  'google-auth-library',
  'node:http',
  'node:https',
  'http',
  'https',
  'node:net',
  'net',
  'rss-parser',
  'google-news-decoder',
  'jsdom',
  'tesseract.js',
  'playwright',
];

const NETWORK_PATHS = [
  /^lib\/(reels|social|explainers)\/jev\//,
  /^lib\/stories\/jev\.ts$/,
  /^lib\/instagram\/(graph|insights-client)\.ts$/,
  /^lib\/media-bucket\.ts$/,
  /^lib\/(explainers|stories)\/storage\.ts$/,
  /^lib\/reels\/visual\/storage\.ts$/,
  /^lib\/anthropic(-client)?\.ts$/,
  /^lib\/supabase\.ts$/,
];

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    const abs = path.join(ROOT, candidate);
    if (existsSync(abs) && statSync(abs).isFile()) return candidate;
  }
  return null;
}

function importsOf(text: string): string[] {
  const specs: string[] = [];
  const body = code(text);
  for (const m of body.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) {
    if (/^\s*(?:import|export)\s+type\s/.test(m[0])) continue; // type-only: erased at build
    specs.push(m[1]!);
  }
  for (const m of body.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!);
  for (const m of body.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!);
  return specs;
}

/**
 * Modules the scan does not walk into. `lib/session.ts` is the app's login
 * check, which every page must call (it upserts `outreach.users` at sign-in,
 * not on a hub read). Nothing else is exempt.
 */
const BOUNDARIES = new Set(['lib/session.ts']);

/**
 * The one browser-side fetch: the Content House buttons posting to the hub's
 * own flagged action routes (DECISIONS_LOG D29). Checked below: a client
 * component, and every endpoint it can be given is an action route.
 */
const ACTION_BUTTONS = 'components/social-hub/house/ActionBar.tsx';

/** First network call or foreign SQL write reachable from `start`, with the import chain, or null. */
export function networkReach(start: string): string | null {
  const seen = new Set<string>();
  const queue: Array<{ file: string; chain: string[] }> = [{ file: start, chain: [start] }];
  while (queue.length) {
    const { file, chain } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (BOUNDARIES.has(file)) continue;
    if (file === ACTION_BUTTONS) {
      for (const spec of importsOf(readFileSync(path.join(ROOT, file), 'utf8'))) {
        const next = resolveImport(file, spec);
        if (next && !seen.has(next)) queue.push({ file: next, chain: [...chain, next] });
      }
      continue;
    }
    if (NETWORK_PATHS.some((re) => re.test(file))) return `${chain.join(' → ')} (network module)`;
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    if (/\bfetch\s*\(/.test(code(text))) return `${chain.join(' → ')} (calls fetch)`;
    const write = sqlWriteTargets(text).find((w) => !w.target.startsWith('social_hub.'));
    if (write) return `${chain.join(' → ')} (writes: ${write.verb} ${write.target})`;
    for (const spec of importsOf(text)) {
      if (NETWORK_PACKAGES.includes(spec)) return `${chain.join(' → ')} → ${spec}`;
      const next = resolveImport(file, spec);
      if (next && !seen.has(next)) queue.push({ file: next, chain: [...chain, next] });
    }
  }
  return null;
}

test('the network scan catches real network modules (positive control)', () => {
  assert.ok(networkReach('lib/social/overnight/meta.ts'), 'carousel Meta client reaches Graph');
  assert.ok(networkReach('lib/explainers/storage.ts'), 'explainer storage signs URLs');
  assert.ok(networkReach('lib/instagram/insights-client.ts'));
  assert.equal(networkReach('lib/instagram/clock.ts'), null);
});

test('the reach scan also catches SQL writes in imported modules (positive control)', () => {
  assert.match(networkReach('lib/social/overnight/schedule.ts') ?? '', /writes: UPDATE social\.posting_schedule|writes:/);
});

test('action handlers stay pure: their pipeline calls come in as dependencies', () => {
  for (const file of walk(ACTIONS_DIR.replace(/\/$/, '')).filter((f) => f.endsWith('/handler.ts'))) {
    assert.equal(networkReach(file), null, file);
  }
});

test('hub read code never reaches a network module or a foreign write; only flagged action routes may', () => {
  const offenders: string[] = [];
  for (const file of HUB_FILES) {
    if (file.startsWith(ACTIONS_DIR)) continue;
    const reason = networkReach(file);
    if (reason) offenders.push(reason);
  }
  assert.deepEqual(offenders, []);
});

test('every action route checks its flag before doing anything', () => {
  const routes = walk(ACTIONS_DIR.replace(/\/$/, '')).filter((f) => f.endsWith('/route.ts'));
  assert.ok(routes.length >= 4, 'the four action routes exist');
  for (const file of routes) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(text, /actionRoute\(/, `${file} must be built with actionRoute() (flag gate)`);
  }
});

// ── Flags ───────────────────────────────────────────────────────────────────

test('the action buttons are a client component that only posts to flagged action routes', async () => {
  const text = readFileSync(path.join(ROOT, ACTION_BUTTONS), 'utf8');
  assert.match(text, /^'use client';/);
  assert.equal((text.match(/\bfetch\s*\(/g) ?? []).length, 1);
  assert.match(text, /fetch\(plan\.endpoint,/);
  const { actionsFor } = await import('@/lib/social-hub/house');
  const { previewDataset } = await import('./fixtures/social-hub/preview-dataset');
  const endpoints = new Set<string>();
  for (const post of previewDataset().posts) {
    for (const plan of actionsFor(post, { quota: null, typicalCostLabel: null })) if (plan.kind === 'post') endpoints.add(plan.endpoint);
  }
  assert.ok(endpoints.size >= 4);
  for (const endpoint of endpoints) {
    assert.match(endpoint, /^\/api\/social-hub\/actions\/[a-z-]+$/);
    assert.ok(existsSync(path.join(ROOT, `app${endpoint}/route.ts`)), endpoint);
  }
});

/**
 * Phase 2 turns flags on one at a time (P2-M3). This table is the intended
 * state; changing a flag means changing it here too, on purpose.
 */
const INTENDED: Record<(typeof ACTION_FLAGS)[number], boolean> = {
  approveCarousel: false,
  approveTrialReel: false,
  hardPublish: false,
  hardRegenerate: false,
  refreshOnVisit: false,
};

test('action flags match their intended Phase 2 state', () => {
  for (const flag of ACTION_FLAGS) assert.equal(actionEnabled(flag), INTENDED[flag], flag);
  assert.equal(hubIsReadOnly(), ACTION_FLAGS.every((f) => !INTENDED[f]));
  assert.equal(Object.isFrozen(SOCIAL_HUB_FLAGS.actions), true);
  for (const view of Object.values(SOCIAL_HUB_FLAGS.views)) assert.equal(view, true);
});

test('flags.ts holds constants only: no env, no database', () => {
  const text = code(readFileSync(path.join(ROOT, 'lib/social-hub/flags.ts'), 'utf8'));
  assert.doesNotMatch(text, /process\.env/);
  assert.doesNotMatch(text, /from\s+['"]@\/lib\/db['"]/);
});

// ── Dependencies unchanged ──────────────────────────────────────────────────

test('package.json and the lockfile match the run baseline', () => {
  const baselinePath = path.join(ROOT, 'planning/Social Hub/scope-baseline.json');
  if (!existsSync(baselinePath)) return; // the baseline lives with the Phase 1 run
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as { files: Record<string, string> };
  for (const file of ['package.json', 'package-lock.json']) {
    const hash = createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex');
    assert.equal(hash, baseline.files[file], `${file} changed`);
  }
});

test('app/social holds only the hub group and the existing render segment; render never imports the hub', () => {
  const top = readdirSync(path.join(ROOT, 'app/social')).filter((name) => !name.startsWith('.'));
  assert.deepEqual(top.sort(), ['(hub)', 'render']);
  for (const file of walk('app/social/render')) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(text, /social-hub/, `${file} imports hub code`);
  }
});

test('the fixture preview never touches the database or the session', () => {
  for (const file of walk('app/social/(hub)/preview')) {
    for (const spec of importsOf(readFileSync(path.join(ROOT, file), 'utf8'))) {
      assert.ok(!/^@\/lib\/(db|session)$/.test(spec) && !/queries\/|\/load$|store/.test(spec), `${file} imports ${spec}`);
    }
  }
});
