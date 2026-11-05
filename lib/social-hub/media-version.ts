/**
 * A short, URL-safe version of a stored file's path (FNV-1a, base 36). Preview routes that redirect
 * to a signed URL let the browser keep that redirect for minutes (stories frames 540 s, reels videos
 * ~55 min) under the same URL. A revision stores its new file under a NEW path (and an undo puts the
 * old path back), so adding `?v=<pathVersion(path)>` to the preview URL makes the hub fetch the file
 * the post now uses instead of the cached old one. Pure; no crypto needed.
 */
/** `url?v=<pathVersion(path)>`, or the bare URL when the stored path is not known. */
export function versionedSrc(url: string, path: unknown): string {
  return typeof path === 'string' && path ? `${url}?v=${pathVersion(path)}` : url;
}

export function pathVersion(path: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
