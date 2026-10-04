import GoogleNewsDecoder from 'google-news-decoder';

/**
 * Resolves a Google News RSS wrapper URL to the underlying publisher URL.
 *
 * Google News RSS items include URLs of the form
 *   https://news.google.com/rss/articles/CBM...?oc=5
 * whose payload encodes the real publisher URL (Bloomberg, The Verge, etc.)
 * in a base64-URL-safe protobuf blob. Fetching the wrapper directly returns
 * Google's app-shell HTML, not the article — so before Readability can
 * extract body text, the wrapper has to be unwound.
 *
 * The `google-news-decoder` npm package reverses the encoding via Google's
 * own internal batchexecute endpoint (same call Google News itself uses).
 * ~500ms per URL. Fails gracefully to null when Google changes the format
 * or the network call errors.
 */

const decoderInstance = new (GoogleNewsDecoder as unknown as new () => {
  decodeGoogleNewsUrl(url: string): Promise<unknown>;
})();

/**
 * True when `url` looks like a Google News wrapper URL. Cheap prefix check,
 * used by callers to avoid the decoder call on native URLs.
 */
export function isGoogleNewsUrl(url: string): boolean {
  return url.includes('news.google.com/rss/articles/');
}

export type ResolvedGoogleNewsUrl = {
  originalUrl: string;
  resolvedUrl: string;
};

/**
 * Attempts to resolve a Google News wrapper URL. Returns the underlying
 * publisher URL or null on failure. Non-wrapper URLs are returned as-is.
 */
export async function resolveGoogleNewsUrl(url: string): Promise<ResolvedGoogleNewsUrl | null> {
  if (!isGoogleNewsUrl(url)) {
    return { originalUrl: url, resolvedUrl: url };
  }
  try {
    const raw = await decoderInstance.decodeGoogleNewsUrl(url);
    // Decoder returns `{ status: true, decodedUrl: string }` on success,
    // `{ status: false, message: string }` on failure.
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as { status?: unknown; decodedUrl?: unknown };
    if (r.status === true && typeof r.decodedUrl === 'string' && r.decodedUrl.length > 0) {
      return { originalUrl: url, resolvedUrl: r.decodedUrl };
    }
    return null;
  } catch {
    return null;
  }
}
