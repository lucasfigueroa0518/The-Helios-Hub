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

export function dbPoolSettings(mode: 'session' | 'transaction', env: DbEnv = process.env): {
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  allowExitOnIdle: true;
} {
  return {
    max: resolvePoolMax(mode, env),
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  };
}

function applicationName(): string {
  if (process.env.VERCEL) return 'helios-web';
  const argv = process.argv.join(' ');
  if (argv.includes('reels_worker')) return 'helios-reels';
  if (argv.includes('orchestration_worker')) return 'helios-worker';
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
      ssl: process.platform === 'win32' ? false : { rejectUnauthorized: false },
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
    globalPool.__outreachHubGate = createDbGate(pool.options.max ?? 1);
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

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return withDbSlot(() => queryWithConnectPolicy(() => getPool().query<T>(text, params)));
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
