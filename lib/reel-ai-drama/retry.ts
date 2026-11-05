/**
 * Retries for live model calls (MD-65: a reel never fails on a blip). Every live `create` goes through
 * `withRetry` (development/producer.ts `anthropicCreate`), so each call site stays plain.
 */
/** A dropped connection, an overloaded or failing API: worth another try. */
export function isTransient(error: unknown): boolean {
  const e = error as { status?: number; message?: string; code?: string; cause?: { code?: string } };
  if (e?.status && [408, 409, 429, 500, 502, 503, 504, 529].includes(e.status)) return true;
  const text = `${e?.message ?? ''} ${e?.code ?? ''} ${e?.cause?.code ?? ''}`;
  return /terminated|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|fetch failed|other side closed|overloaded|UND_ERR/i.test(text);
}

/** Retries a request after a transient failure: TRANSIENT_RETRIES more tries, backing off. */
export const TRANSIENT_RETRIES = 3;
export async function withRetry<P, R>(send: (p: P) => Promise<R>, params: P, { waitMs = 5000 }: { waitMs?: number } = {}): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send(params);
    } catch (error) {
      if (attempt >= TRANSIENT_RETRIES || !isTransient(error)) throw error;
      await new Promise((r) => setTimeout(r, waitMs * 2 ** attempt));
    }
  }
}

