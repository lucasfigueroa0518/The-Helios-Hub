import { AsyncLocalStorage } from 'node:async_hooks';

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { markIsolateBoot } from '@/lib/observability/isolate';
import { logError, logWarn } from '@/lib/observability/log-event';

/** One checkout attempt. A stalled pooler fails this fast so the retry can run. */
export const DB_CONNECT_TIMEOUT_MS = 3_000;
/** First try plus two retries. A query error is not one of these attempts. */
export const DB_CONNECT_ATTEMPTS = 3;

const globalPool = globalThis as typeof globalThis & {
  __outreachHubPool?: Pool;
  __outreachHubGate?: DbGate;
};

/** Set while this async call already holds a gate slot, so a nested query cannot deadlock. */
const dbSlotDepth = new AsyncLocalStorage<number>();

/**
 * Runtime connection selection.
 *
 * Supavisor session mode (:5432) maps one client to one Postgres connection
 * and rejects anything past pool_size (15) with EMAXCONNSESSION. The web app,
 * the orchestration worker, and the reels worker each keep their own node-pg
 * pool, so session mode overflows as soon as those processes are up.
 *
 * Transaction mode (:6543) multiplexes those clients onto the same server
 * pool. That is the runtime default. DIRECT_DATABASE_URL stays on :5432 for
 * psql and schema scripts, which need a real session. Set
 * OUTREACH_DB_USE_SESSION_POOLER=1 to force the runtime back onto session mode.
 */
export type DbConnectionChoice = {
  mode: 'session' | 'transaction';
  connectionString: string;
  hostPort: string;
};

type DbEnv = Record<string, string | undefined>;

function connectionMode(url: string): 'session' | 'transaction' {
  let port = '';
  try {
    port = new URL(url).port;
  } catch {
    throw new Error('Database URL is not a valid connection string');
  }
  return (port || '5432') === '6543' ? 'transaction' : 'session';
}

function hostPort(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || '5432'}`;
}

export function chooseDbConnection(env: DbEnv = process.env): DbConnectionChoice {
  const candidates = [env.DATABASE_URL, env.DIRECT_DATABASE_URL]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean);
  if (candidates.length === 0) {
    throw new Error('DATABASE_URL or DIRECT_DATABASE_URL is not set');
  }

  const transaction = candidates.find((url) => connectionMode(url) === 'transaction');
  const session = candidates.find((url) => connectionMode(url) === 'session');
  const forceSession = env.OUTREACH_DB_USE_SESSION_POOLER === '1';
  const chosen = (forceSession ? session || transaction : transaction || session)!;

  return {
    mode: connectionMode(chosen),
    connectionString: chosen,
    hostPort: hostPort(chosen),
  };
}

function runtimeConnectionString(choice: DbConnectionChoice): string {
  const url = choice.connectionString;
  if (process.platform !== 'win32' || /[?&]sslmode=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}sslmode=disable`;
}

/**
 * Session mode is clamped to 2 clients per process so several processes fit under pool_size 15.
 * Transaction mode on a long-lived worker defaults to 6. A Vercel isolate defaults to 3:
 * Home, Social Hub, Trello, and Dashboards can boot together, and each isolate has its own pool.
 */
export function resolvePoolMax(mode: 'session' | 'transaction', env: DbEnv = process.env): number {
  const web = env.VERCEL === '1';
  const fallback = mode === 'session' ? 2 : (web ? 3 : 6);
  const parsed = Number(env.PG_POOL_MAX ?? fallback);
  const requested = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  const cap = mode === 'session' ? 2 : (web ? 3 : 8);
  return Math.max(1, Math.min(cap, requested));
}

/** A Vercel isolate is short-lived and frozen between requests: it lets idle clients go fast. */
export const WEB_IDLE_TIMEOUT_MS = 10_000;
/**
 * A long-lived worker keeps an idle client for a minute. Workers poll about every 17 s, so a
 * 10 s timeout meant a new TLS handshake to the pooler on nearly every poll (~580 ms a read from
 * the GCP VM). Nothing upstream drops a minute-idle client: Postgres idle_session_timeout is 0,
 * Supavisor keeps idle clients, and GCP drops idle TCP only after 10 minutes. allowExitOnIdle
 * still lets a one-off script exit without waiting it out. PG_IDLE_TIMEOUT_MS overrides both.
 */
export const WORKER_IDLE_TIMEOUT_MS = 60_000;

export function resolveIdleTimeoutMs(env: DbEnv = process.env): number {
  const fallback = env.VERCEL === '1' ? WEB_IDLE_TIMEOUT_MS : WORKER_IDLE_TIMEOUT_MS;
  const parsed = Number(env.PG_IDLE_TIMEOUT_MS ?? fallback);
  return Number.isFinite(parsed) && parsed >= 1_000 ? Math.floor(parsed) : fallback;
}

export function dbPoolSettings(mode: 'session' | 'transaction', env: DbEnv = process.env): {
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  allowExitOnIdle: true;
  keepAlive: boolean;
} {
  return {
    max: resolvePoolMax(mode, env),
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: resolveIdleTimeoutMs(env),
    allowExitOnIdle: true,
    // TCP keepalive on a worker's minute-idle clients, so a dropped path shows up as an error, not a hang.
    keepAlive: env.VERCEL !== '1',
  };
}

/**
 * The name each process's connections carry in pg_stat_activity, so a busy database
 * shows which service holds them (perf/db/prod-diagnose.sql). Workers started with
 * `npm run <script>` are named after the script (social:worker -> helios-social-worker).
 */
export function applicationName(env: DbEnv = process.env, argv: string[] = process.argv): string {
  if (env.VERCEL) return 'helios-web';
  const joined = argv.join(' ');
  if (joined.includes('reels_worker')) return 'helios-reels';
  if (joined.includes('orchestration_worker')) return 'helios-worker';
  const script = env.npm_lifecycle_event;
  if (script && script !== 'worker') return `helios-${script.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`.slice(0, 63);
  if (script === 'worker') return 'helios-worker';
  const file = argv.map((a) => a.match(/([a-z0-9_-]+_worker)\.[cm]?[jt]s$/i)?.[1]).find(Boolean);
  if (file) return `helios-${file.replace(/_/g, '-').toLowerCase()}`;
  return 'helios-node';
}

/** node-pg: the checkout timer fired. This is a connect wait, not a failed query. */
export function isDbConnectTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout exceeded when trying to connect/i.test(message);
}

export function isRetryableDbConnectError(error: unknown): boolean {
  if (isDbConnectTimeout(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /EMAXCONNSESSION|max clients reached|remaining connection slots/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry a checkout. Leave syntax errors, constraint failures, and deadlocks alone. */
export async function withDbConnectRetries<T>(
  run: () => Promise<T>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DB_CONNECT_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isRetryableDbConnectError(error) || attempt === DB_CONNECT_ATTEMPTS) throw error;
      await wait(150 * attempt);
    }
  }
  throw lastError;
}

export type DbGate = {
  run<T>(fn: () => Promise<T>): Promise<T>;
  close(): void;
};

/**
 * At most `max` tasks call into the pool. The rest wait here, so their wait is
 * not the pool's checkout timer. A task that is still queued when the gate
 * closes fails instead of hanging.
 */
export function createDbGate(max: number): DbGate {
  let active = 0;
  let closed = false;
  const limit = Math.max(1, max);
  const waiting: Array<{ start: () => void; reject: (error: Error) => void }> = [];
  return {
    run(fn) {
      if (closed) return Promise.reject(new Error('Database gate is closed'));
      return new Promise((resolve, reject) => {
        const start = () => {
          if (closed) {
            reject(new Error('Database gate is closed'));
            return;
          }
          active += 1;
          Promise.resolve()
            .then(fn)
            .then(resolve, reject)
            .finally(() => {
              active -= 1;
              const next = waiting.shift();
              if (next) next.start();
            });
        };
        if (active < limit) start();
        else waiting.push({ start, reject });
      });
    },
    close() {
      closed = true;
      const pending = waiting.splice(0);
      for (const item of pending) item.reject(new Error('Database gate is closed'));
    },
  };
}

/** A nested call reuses the slot already held by this async context. */
export function runInDbSlot<T>(gate: DbGate, fn: () => Promise<T>): Promise<T> {
  if ((dbSlotDepth.getStore() ?? 0) > 0) return fn();
  return gate.run(() => dbSlotDepth.run(1, fn));
}

/**
 * After a checkout gives up, more queries in this process fail immediately for
 * a second. Otherwise a page that started dozens of queries would repeat the
 * full timeout on every one of them.
 */
let connectBlockedUntil = 0;

export function resetDbConnectCooldown(): void {
  connectBlockedUntil = 0;
}

export function dbConnectCooldownActive(now = Date.now()): boolean {
  return now < connectBlockedUntil;
}

export function markDbConnectGaveUp(error: unknown, now = Date.now()): void {
  if (!isDbConnectTimeout(error)) return;
  connectBlockedUntil = now + 1_000;
  logWarn({
    component: 'db-pool',
    event: 'connect_timeout',
    ...describeDbTarget(),
    pool: dbPoolSnapshot(),
  });
}

function rejectIfConnectCooling(): void {
  if (!dbConnectCooldownActive()) return;
  throw new Error('timeout exceeded when trying to connect');
}

function getPool(): Pool {
  if (!globalPool.__outreachHubPool) {
    const choice = chooseDbConnection();
    const settings = dbPoolSettings(choice.mode);
    markIsolateBoot('db-pool', {
      mode: choice.mode,
      hostPort: choice.hostPort,
      max: settings.max,
      application: applicationName(),
    });
    if (choice.mode === 'session') {
      logWarn({
        component: 'db-pool',
        event: 'session_pooler_selected',
        hostPort: choice.hostPort,
        max: settings.max,
        note: 'Session mode caps every client at pool_size. Prefer the transaction pooler on :6543.',
      });
    }
    const pool = new Pool({
      connectionString: runtimeConnectionString(choice),
      application_name: applicationName(),
      // A local Postgres (the localhost copy of the hub's data) has no TLS.
      ssl: process.platform === 'win32' || /@(127\.0\.0\.1|localhost)[:/]/.test(runtimeConnectionString(choice)) ? false : { rejectUnauthorized: false },
      ...settings,
    });
    // Idle clients can drop on network blips; without this handler Node treats it as fatal.
    pool.on('error', (error) => {
      logError({
        component: 'db-pool',
        event: 'idle_client_error',
        error: error instanceof Error ? error.message : String(error),
        pool: dbPoolSnapshot(),
      });
    });
    globalPool.__outreachHubPool = pool;
    globalPool.__outreachHubGate = createDbGate(settings.max);
  }
  return globalPool.__outreachHubPool;
}

function getGate(): DbGate {
  const pool = getPool();
  if (!globalPool.__outreachHubGate) {
    globalPool.__outreachHubGate = createDbGate(pool.options?.max ?? 1);
  }
  return globalPool.__outreachHubGate;
}

function withDbSlot<T>(fn: () => Promise<T>): Promise<T> {
  return runInDbSlot(getGate(), fn);
}

async function queryWithConnectPolicy<T>(run: () => Promise<T>): Promise<T> {
  rejectIfConnectCooling();
  try {
    return await withDbConnectRetries(run);
  } catch (error) {
    markDbConnectGaveUp(error);
    throw error;
  }
}

/** A statement slower than this (ms, from checkout to result) is logged as `db/slow_query`. 0 turns it off. */
export function slowQueryThresholdMs(env: DbEnv = process.env): number {
  const parsed = Number(env.DB_SLOW_QUERY_MS ?? 100);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 100;
}

/** The statement's shape for a log line: whitespace collapsed, cut short. Parameters are never logged. */
export function slowQueryLabel(text: string): string {
  return text.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const threshold = slowQueryThresholdMs();
  if (threshold === 0) return withDbSlot(() => queryWithConnectPolicy(() => getPool().query<T>(text, params)));
  const started = performance.now();
  const result = await withDbSlot(() => queryWithConnectPolicy(() => getPool().query<T>(text, params)));
  const durationMs = Math.round(performance.now() - started);
  if (durationMs >= threshold) {
    // Includes the wait for a pool slot, so pool pressure shows up here too (perf/README.md).
    logWarn({ component: 'db', event: 'slow_query', durationMs, rows: result.rowCount ?? null, sql: slowQueryLabel(text) });
  }
  return result;
}

/** Run related writes atomically. Roll back automatically when the callback throws. */
export async function dbTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  return withDbSlot(async () => {
    const client = await queryWithConnectPolicy(() => getPool().connect());
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

/** Drain the shared pool (tests / graceful worker shutdown). */
export async function closeDbPool(): Promise<void> {
  const gate = globalPool.__outreachHubGate;
  globalPool.__outreachHubGate = undefined;
  gate?.close();
  if (!globalPool.__outreachHubPool) return;
  const pool = globalPool.__outreachHubPool;
  globalPool.__outreachHubPool = undefined;
  await pool.end();
}

/** Low-cardinality pool pressure snapshot; never includes connection details. */
export function dbPoolSnapshot(): {
  configuredMax: number;
  total: number;
  idle: number;
  waiting: number;
} {
  const pool = globalPool.__outreachHubPool;
  return {
    configuredMax: resolvePoolMax(describeDbTarget().mode === 'transaction' ? 'transaction' : 'session'),
    total: pool?.totalCount ?? 0,
    idle: pool?.idleCount ?? 0,
    waiting: pool?.waitingCount ?? 0,
  };
}

/** Ops helper: which URL mode the pool will use (no secrets). */
export function describeDbTarget(): { mode: 'session' | 'transaction' | 'unknown'; hostPort: string } {
  try {
    const choice = chooseDbConnection();
    return { mode: choice.mode, hostPort: choice.hostPort };
  } catch {
    return { mode: 'unknown', hostPort: '' };
  }
}
