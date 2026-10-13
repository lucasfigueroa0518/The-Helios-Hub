/**
 * Safe client-side JSON request helper.
 * Handles non-JSON / HTML error pages (e.g. Next.js 500 internal error, <!DOCTYPE html>)
 * without throwing raw SyntaxError ("Unexpected token '<', <!DOCTYPE...").
 */

/**
 * Carries the status and parsed body alongside the message, so a caller can act
 * on a specific refusal — a 409 that needs the user to confirm, say — instead of
 * only being able to show the text.
 */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

/** Reads that hang (a stalled connection, a cold function) give up instead of spinning forever. */
const GET_TIMEOUT_MS = 30_000;

function withReadTimeout(init?: RequestInit): RequestInit | undefined {
  const method = (init?.method ?? 'GET').toUpperCase();
  // Only reads: a mutation that times out on the client may still land on the server.
  if ((method !== 'GET' && method !== 'HEAD') || typeof AbortSignal.timeout !== 'function') return init;
  const timeout = AbortSignal.timeout(GET_TIMEOUT_MS);
  if (!init?.signal) return { ...init, signal: timeout };
  if (typeof AbortSignal.any !== 'function') return init;
  return { ...init, signal: AbortSignal.any([init.signal, timeout]) };
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, withReadTimeout(init));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new RequestError('The server took too long to answer - please retry', 0);
    }
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      if (text.trim().toLowerCase().startsWith('<!doctype') || text.trim().startsWith('<')) {
        throw new RequestError(`Server error (HTTP ${response.status}) - please retry`, response.status);
      }
      throw new RequestError(
        text || `Request failed with status ${response.status}`,
        response.status,
      );
    }
    throw new RequestError('Server returned an unexpected non-JSON response', response.status);
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new RequestError('Invalid JSON payload returned from server', response.status);
  }

  if (!response.ok) {
    throw new RequestError(
      data?.error ?? `Request failed with status ${response.status}`,
      response.status,
      data ?? null,
    );
  }

  return data as T;
}
