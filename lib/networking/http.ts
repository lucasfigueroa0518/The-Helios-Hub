import { createHash } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = 'HeliosNetworkingCalendar/1.0 (+https://www.heliosgroup.tech)';

export async function fetchText(
  url: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        ...options.headers,
      },
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(
  url: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<{ ok: boolean; status: number; json: T | null; text: string }> {
  const result = await fetchText(url, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers },
  });
  if (!result.ok) return { ok: false, status: result.status, json: null, text: result.text };
  try {
    return { ok: true, status: result.status, json: JSON.parse(result.text) as T, text: result.text };
  } catch {
    return { ok: false, status: result.status, json: null, text: result.text };
  }
}

export function shaShort(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
