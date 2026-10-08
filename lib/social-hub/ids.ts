import { isVertical } from '@/lib/social-hub/verticals';
import type { Vertical } from '@/lib/social-hub/types';

/**
 * Durable post ids (spec §3). Published or attempted: `vertical:<attempt id>`.
 * Scheduled, not yet attempted: `vertical:schedule:<schedule id>`. Stories:
 * `stories:<set id>`. Content with no slot (DECISIONS_LOG D7):
 * `carousels:post:<post id>`, `explainers:job:<job id>`.
 */
export type HubIdKind = 'attempt' | 'schedule' | 'set' | 'post' | 'job';

export type ParsedHubId = { vertical: Vertical; kind: HubIdKind; ref: string };

const REF = /^[0-9A-Za-z-]{1,64}$/;

/** Which id kinds each vertical uses (D7). Stories posts are always sets. */
const KINDS: Record<Vertical, readonly HubIdKind[]> = {
  reels: ['attempt', 'schedule'],
  explainers: ['attempt', 'schedule', 'job'],
  carousels: ['attempt', 'schedule', 'post'],
  stories: ['set'],
};

export function hubId(vertical: Vertical, kind: HubIdKind, ref: string): string {
  if (!REF.test(ref)) throw new Error(`invalid ${vertical} ref: ${ref}`);
  if (!KINDS[vertical].includes(kind)) throw new Error(`${vertical} has no ${kind} ids`);
  if (vertical === 'stories') return `stories:${ref}`;
  if (kind === 'attempt') return `${vertical}:${ref}`;
  return `${vertical}:${kind}:${ref}`;
}

export function parseHubId(raw: string): ParsedHubId | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const parts = decoded.split(':');
  const [vertical, second, third] = parts;
  if (!isVertical(vertical)) return null;
  if (parts.length === 2 && REF.test(second ?? '')) {
    const kind: HubIdKind = vertical === 'stories' ? 'set' : 'attempt';
    return { vertical, kind, ref: second! };
  }
  if (parts.length === 3 && REF.test(third ?? '') && (KINDS[vertical] as readonly string[]).includes(second ?? '') && second !== 'attempt' && second !== 'set') {
    return { vertical, kind: second as HubIdKind, ref: third! };
  }
  return null;
}

export function postHref(base: string, id: string): string {
  return `${base}/post/${encodeURIComponent(id)}`;
}
