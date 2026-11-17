/**
 * A redirect target with the incoming query kept (SS-1: /stories → /morning-download). Pure, so a test can pin
 * it. Repeated keys stay repeated; empty values are dropped.
 */
export function withQuery(path: string, searchParams: Record<string, string | string[] | undefined> | null | undefined): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    for (const v of Array.isArray(value) ? value : [value]) if (typeof v === 'string') q.append(key, v);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
