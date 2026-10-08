/**
 * Hub URLs. Pages render under `/social` (SH-57); the development-only fixture
 * preview mirrors them under `/social/preview` (DECISIONS_LOG D10), so every
 * link is built from a base.
 */
export const HUB_BASE = '/social';
export const PREVIEW_BASE = '/social/preview';

export function hubBaseOf(pathname: string): string {
  return pathname === PREVIEW_BASE || pathname.startsWith(`${PREVIEW_BASE}/`) ? PREVIEW_BASE : HUB_BASE;
}

export type HubParams = Record<string, string | undefined>;

/** Build a hub href, dropping empty params so links stay short. */
export function hubHref(base: string, path: string, params: HubParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') search.set(key, value);
  }
  const query = search.toString();
  return `${base}${path}${query ? `?${query}` : ''}`;
}

/** Same page, some params changed (null removes one). */
export function withParams(base: string, path: string, current: HubParams, changes: Record<string, string | null>): string {
  const next: HubParams = { ...current };
  for (const [key, value] of Object.entries(changes)) {
    if (value == null) delete next[key];
    else next[key] = value;
  }
  return hubHref(base, path, next);
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Next's searchParams → flat string params (first value wins). */
export function toParams(raw: RawSearchParams): HubParams {
  const out: HubParams = {};
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string' && first.length <= 200) out[key] = first;
  }
  return out;
}

/** Compare picks arrive as repeated `cmp` (form checkboxes) or one comma list (links). */
export function compareIds(raw: RawSearchParams): string[] {
  const value = raw.cmp;
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
}
