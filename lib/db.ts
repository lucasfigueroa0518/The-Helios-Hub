import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

const globalPool = globalThis as typeof globalThis & {
  __outreachHubPool?: Pool;
};

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

/** Session mode is clamped to 2 clients per process so several processes fit under pool_size 15. */
export function resolvePoolMax(mode: 'session' | 'transaction', env: DbEnv = process.env): number {
  const fallback = 2;
  const parsed = Number(env.PG_POOL_MAX ?? fallback);
  const requested = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  const cap = mode === 'session' ? 2 : 8;
  return Math.max(1, Math.min(cap, requested));
}

function applicationName(): string {
  if (process.env.VERCEL) return 'helios-web';
  const argv = process.argv.join(' ');
  if (argv.includes('reels_worker')) return 'helios-reels';
  if (argv.includes('orchestration_worker')) return 'helios-worker';
  return 'helios-node';
}

function isPoolExhaustedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /EMAXCONNSESSION|max clients reached|remaining connection slots/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPool(): Pool {
  if (!globalPool.__outreachHubPool) {
    const choice = chooseDbConnection();
    const max = resolvePoolMax(choice.mode);
    if (choice.mode === 'session') {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'warn',
        component: 'db-pool',
        message: 'session_pooler_selected',
        hostPort: choice.hostPort,
        max,
        note: 'Session mode caps every client at pool_size. Prefer the transaction pooler on :6543.',
      }));
    }
    const pool = new Pool({
      connectionString: runtimeConnectionString(choice),
      application_name: applicationName(),
      ssl: process.platform === 'win32' ? false : { rejectUnauthorized: false },
      max,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      allowExitOnIdle: true,
    });
    // Idle clients can drop on network blips; without this handler Node treats it as fatal.
    pool.on('error', (error) => {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        component: 'db-pool',
        message: 'idle_client_error',
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    globalPool.__outreachHubPool = pool;
  }
  return globalPool.__outreachHubPool;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await getPool().query<T>(text, params);
    } catch (error) {
      lastError = error;
      if (!isPoolExhaustedError(error) || attempt === maxAttempts) throw error;
      // Brief backoff so idle clients can return to the Supabase session pool.
      await sleep(150 * attempt);
    }
  }
  throw lastError;
}

/** Run related writes atomically. Roll back automatically when the callback throws. */
export async function dbTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const client = await getPool().connect();
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
    } catch (error) {
      lastError = error;
      if (!isPoolExhaustedError(error) || attempt === maxAttempts) throw error;
      await sleep(150 * attempt);
    }
  }
  throw lastError;
}

/** Drain the shared pool (tests / graceful worker shutdown). */
export async function closeDbPool(): Promise<void> {
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
