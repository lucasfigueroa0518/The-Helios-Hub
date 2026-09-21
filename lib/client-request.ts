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

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
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
