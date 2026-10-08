import { isVertical } from '@/lib/social-hub/verticals';
import type { Vertical } from '@/lib/social-hub/types';

/**
 * Durable post ids (spec §3, D46). A post's id is its CONTENT's id, stable
 * from content ready through published: `vertical:<content id>` (carousel
 * post, explainer render, reel video, story set), or `reels:idea:<idea id>`
 * for a Trial Reels slot booked before its video exists (lib/social-hub/lifecycle.ts).
 * The older kinds (`vertical:<attempt id>`, `vertical:schedule:<id>`,
 * `carousels:post:<id>`, `explainers:job:<id>`, DECISIONS_LOG D7) are still
 * made for the candidates the lifecycle view folds, and kept as aliases.
 */
export type HubIdKind = 'content' | 'idea' | 'attempt' | 'schedule' | 'set' | 'post' | 'job';

export type ParsedHubId = { vertical: Vertical; kind: HubIdKind; ref: string };

const REF = /^[0-9A-Za-z-]{1,64}$/;

/** Which id kinds each vertical uses (D7). Stories posts are always sets. */
const KINDS: Record<Vertical, readonly HubIdKind[]> = {
  reels: ['content', 'idea', 'attempt', 'schedule'],
  explainers: ['content', 'attempt', 'schedule', 'job'],
  carousels: ['content', 'attempt', 'schedule', 'post'],
  stories: ['content', 'set'],
};

export function hubId(vertical: Vertical, kind: HubIdKind, ref: string): string {
  if (!REF.test(ref)) throw new Error(`invalid ${vertical} ref: ${ref}`);
  if (!KINDS[vertical].includes(kind)) throw new Error(`${vertical} has no ${kind} ids`);
  if (vertical === 'stories') return `stories:${ref}`;
  if (kind === 'attempt' || kind === 'content') return `${vertical}:${ref}`;
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
    // A content id (D46); an older link may hold an attempt id in the same shape (resolved by alias).
    return { vertical, kind: 'content', ref: second! };
  }
  if (parts.length === 3 && REF.test(third ?? '') && (KINDS[vertical] as readonly string[]).includes(second ?? '') && second !== 'attempt' && second !== 'set' && second !== 'content') {
    return { vertical, kind: second as HubIdKind, ref: third! };
  }
  return null;
}

export function postHref(base: string, id: string): string {
  return `${base}/post/${encodeURIComponent(id)}`;
}
