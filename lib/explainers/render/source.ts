/**
 * Topic source material (E-09). The worker fetches a source URL itself,
 * outside the agent (which has no network tools), with a timeout and a size
 * limit, and keeps only readable text. The result is untrusted data.
 */

export const SOURCE_MAX_BYTES = 2_000_000;
export const SOURCE_MAX_CHARS = 40_000;
export const SOURCE_TIMEOUT_MS = 15_000;

export type FetchLike = (url: string, init: { signal: AbortSignal; redirect: 'follow'; headers: Record<string, string> }) => Promise<Response>;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Readable text from HTML: scripts, styles, nav chrome, and tags removed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\r]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
}

function clip(text: string): string {
  return text.length > SOURCE_MAX_CHARS ? `${text.slice(0, SOURCE_MAX_CHARS)}\n\n[source truncated]` : text;
}

export async function fetchSourceText(url: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`source URL is not valid: ${url}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('source URL must be http or https');
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/.test(parsed.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(parsed.hostname)) {
    throw new Error('source URL points at a private address');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'HeliosExplainerBot/1.0 (+https://heliosmarketing.org)', accept: 'text/html,text/plain;q=0.9' },
    });
    if (!res.ok) throw new Error(`source fetch failed: HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new Error(`source is not text or HTML (${type || 'no content type'})`);
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > SOURCE_MAX_BYTES) throw new Error(`source is larger than ${SOURCE_MAX_BYTES} bytes`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error('source has no body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SOURCE_MAX_BYTES) {
        await reader.cancel();
        throw new Error(`source is larger than ${SOURCE_MAX_BYTES} bytes`);
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const text = /text\/plain/.test(type) ? body.trim() : htmlToText(body);
    if (!text) throw new Error('source had no readable text');
    return clip(text);
  } finally {
    clearTimeout(timer);
  }
}

/** A topic's source: pasted notes win, else the fetched URL, else none. */
export async function resolveSource(
  topic: { source_text: string | null; source_url: string | null },
  fetchImpl?: FetchLike,
): Promise<string | null> {
  if (topic.source_text?.trim()) return clip(topic.source_text.trim());
  if (topic.source_url?.trim()) return fetchSourceText(topic.source_url.trim(), fetchImpl);
  return null;
}
