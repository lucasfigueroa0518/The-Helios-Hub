/**
 * A destination that is not an article. D-036 skips anything we cannot read as
 * full text. A PDF, an image, or an archive is that case, and parsing one as
 * HTML produces null bytes that Postgres will not store.
 */

const BINARY_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/gzip',
  'application/x-gzip',
  'application/wasm',
  'application/octet-stream',
  'application/epub+zip',
]);

const BINARY_EXTENSION =
  /\.(?:pdf|zip|gz|tgz|png|jpe?g|gif|webp|mp4|mp3|wav|wasm|epub|mobi)$/i;

function mediaType(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

function pathOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).pathname;
  } catch {
    return url.split(/[?#]/)[0] ?? '';
  }
}

function hasBinaryMagic(body: string | null | undefined): boolean {
  const head = body ?? '';
  if (head.startsWith('%PDF')) return true;
  if (head.startsWith('PK\u0003\u0004')) return true;
  if (head.charCodeAt(0) === 0x89 && head.startsWith('PNG', 1)) return true;
  if (head.charCodeAt(0) === 0x1f && head.charCodeAt(1) === 0x8b) return true;
  return false;
}

export function isNonArticle(input: {
  contentType?: string | null;
  url?: string | null;
  body?: string | null;
}): boolean {
  const type = mediaType(input.contentType);
  if (
    type.startsWith('image/') ||
    type.startsWith('audio/') ||
    type.startsWith('video/') ||
    type.startsWith('font/') ||
    BINARY_TYPES.has(type)
  ) {
    // octet-stream is a guess. Magic bytes or a file extension confirm it;
    // a mislabeled HTML page still gets read.
    if (type === 'application/octet-stream') {
      return hasBinaryMagic(input.body) || BINARY_EXTENSION.test(pathOf(input.url));
    }
    return true;
  }
  if (BINARY_EXTENSION.test(pathOf(input.url))) return true;
  return hasBinaryMagic(input.body);
}
