/**
 * Retries and outage waits for everything that leaves the machine (MD-65: a reel never fails on a blip; ITERATION-12 §1: an
 * outage pauses a job, it doesn't fail it). Every live `create` goes through `withRetry` (development/producer.ts
 * `anthropicCreate`), so each call site stays plain. Also the one place a failure is classified and put in words.
 */

/** The connection went away, or never came: wait for the network and try again. A subprocess's own timeout isn't one. */
const CONNECTION_LOSS = /Connection error|Request timed out|Connection terminated|terminating connection|terminated|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN|EPIPE|socket hang up|fetch failed|other side closed|UND_ERR|getaddrinfo|Could not resolve host/i;

function errorWords(error: unknown): string {
  const e = error as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } } | string | null | undefined;
  if (typeof e === 'string') return e;
  return `${e?.name ?? ''} ${e?.message ?? ''} ${e?.code ?? ''} ${e?.cause?.code ?? ''} ${e?.cause?.message ?? ''}`;
}

export function isConnectionLoss(error: unknown): boolean {
  const text = errorWords(error);
  if (/spawnSync \S+ ETIMEDOUT/.test(text)) return false;
  return /APIConnection/.test(text) || CONNECTION_LOSS.test(text);
}

/** A dropped connection, an overloaded or failing API: worth another try. */
export function isTransient(error: unknown): boolean {
  const status = (error as { status?: number } | null | undefined)?.status;
  if (status && [408, 409, 429, 500, 502, 503, 504, 529].includes(status)) return true;
  return isConnectionLoss(error) || /overloaded|HTTP (408|429|5\d\d)\b/i.test(errorWords(error));
}

/** A vendor saying no (out of money, a bad key, a plan limit): trying again changes nothing. */
export function isRefusal(error: unknown): boolean {
  return /HTTP 40[123]\b|insufficient|out of credits?|credit balance|quota|plan_upgrade|wallet|authentication_error|invalid x-api-key/i.test(errorWords(error));
}

export type FailureClass = 'network' | 'environment' | 'story';

/** What failed outside the story: the vendors, the machine, the harness itself. None of these says anything about the pitch. */
const ENVIRONMENT = /Preflight:|Worker restarted|\bvoice: |hyperframes render|The render failed|The render produced no video|ffmpeg|ffprobe|ENOENT|ENOSPC|EMFILE|ENOMEM|ENOBUFS|EACCES|No HeyGen voice id|Cannot read propert|is not a function|is not defined|overloaded|HTTP 5\d\d/i;

/** Whose failure this was. Only a `story` failure counts against a pitch (production/jobs.ts). Takes an error or its stored text. */
export function failureClass(error: unknown): FailureClass {
  if (isConnectionLoss(error)) return 'network';
  if (isRefusal(error) || isTransient(error) || ENVIRONMENT.test(errorWords(error))) return 'environment';
  return 'story';
}

/** An error in one line a person can act on: its message, status and cause chain, and where in the code a harness bug threw. */
export function errorReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  let out = error.message;
  const status = (error as { status?: number }).status;
  if (status && !out.includes(String(status))) out += ` (status ${status})`;
  let cause = (error as { cause?: unknown }).cause;
  for (let depth = 0; cause && depth < 3; depth++) {
    const c = cause as { message?: string; code?: string; cause?: unknown };
    const words = [c.message ?? String(cause), c.code].filter(Boolean).join(' ');
    if (words && !out.includes(words)) out += ` (cause: ${words})`;
    cause = c.cause;
  }
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError) {
    const at = error.stack?.split('\n').find((l) => l.trim().startsWith('at ') && !l.includes('node_modules') && !l.includes('node:'));
    if (at) out += ` [${at.trim()}]`;
  }
  return out;
}

/** Everything an error knows, for the job's stored record: stack and causes. */
export function errorFull(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.stack ?? error.message];
  let cause = (error as { cause?: unknown }).cause;
  for (let depth = 0; cause && depth < 3; depth++) {
    parts.push(`caused by: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`);
    cause = (cause as { cause?: unknown }).cause;
  }
  return parts.join('\n');
}

export type NetworkWatch = {
  /** True when the network answers. Live: any HTTP reply from the API host (no key, no model, no spend). */
  probe: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
  /** Polls before giving up. Counted in polls, not by the clock: a machine waking after a night's sleep hasn't "waited". */
  maxPolls: number;
  onWait: (event: 'waiting' | 'back' | 'gave_up', polls: number) => void;
};

const PROBE_URL = 'https://api.anthropic.com/';
const POLL_MS = 15_000;
/** Twelve awake hours of no network. */
const MAX_POLLS = (12 * 60 * 60 * 1000) / POLL_MS;
/** Outages one call may wait through before it stops trying. */
const MAX_OUTAGES = 100;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const LIVE_WATCH: NetworkWatch = {
  probe: async () => {
    // Tests never touch the network: a stubbed failure doesn't mean it's down.
    if (process.env.NODE_TEST_CONTEXT) return true;
    try {
      await fetch(PROBE_URL, { method: 'HEAD', signal: AbortSignal.timeout(8_000) });
      return true;
    } catch {
      return false;
    }
  },
  sleep,
  pollMs: POLL_MS,
  maxPolls: MAX_POLLS,
  onWait: (event, polls) => console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'reel-ai-drama-network', message: `outage_${event}`, polls })),
};

/** Waits while the network is down. `waited` is how many polls it took: 0 means it never was down. */
export async function waitForNetwork(options: Partial<NetworkWatch> = {}): Promise<{ online: boolean; waited: number }> {
  const w = { ...LIVE_WATCH, ...options };
  for (let polls = 0; ; polls++) {
    if (await w.probe()) {
      if (polls) w.onWait('back', polls);
      return { online: true, waited: polls };
    }
    if (polls >= w.maxPolls) {
      w.onWait('gave_up', polls);
      return { online: false, waited: polls };
    }
    if (!polls) w.onWait('waiting', polls);
    await w.sleep(w.pollMs);
  }
}

/** Retries a request after a transient failure: TRANSIENT_RETRIES more tries, backing off. An outage waited through costs no try. */
export const TRANSIENT_RETRIES = 3;
export type RetryOptions = { waitMs?: number; network?: Partial<NetworkWatch> };

export async function withRetry<P, R>(send: (p: P) => Promise<R>, params: P, { waitMs = 5000, network = {} }: RetryOptions = {}): Promise<R> {
  let attempt = 0;
  let outages = 0;
  for (;;) {
    try {
      return await send(params);
    } catch (error) {
      if (isConnectionLoss(error)) {
        const { online, waited } = await waitForNetwork(network);
        if (!online) throw error;
        if (waited > 0 && ++outages <= MAX_OUTAGES) continue;
      }
      if (attempt >= TRANSIENT_RETRIES || !isTransient(error)) throw error;
      await sleep(waitMs * 2 ** attempt);
      attempt += 1;
    }
  }
}

/** The same database, whose queries wait out an outage: a job must not die because the machine slept through a query. */
export function resilientDb<D extends { query: (...args: never[]) => Promise<unknown> }>(db: D, options: RetryOptions = { waitMs: 1000 }): D {
  return new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== 'function') return value;
      const bound = (value as (...args: unknown[]) => unknown).bind(target);
      if (key !== 'query') return bound;
      return (...args: unknown[]) => withRetry(() => bound(...args) as Promise<unknown>, undefined, options);
    },
  });
}
