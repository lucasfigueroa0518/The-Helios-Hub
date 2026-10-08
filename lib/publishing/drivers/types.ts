import type { SpineVertical } from '@/lib/social-hub/spine';

/**
 * What the single publisher needs from each content type (unification Move 6,
 * D40). The publisher owns the shared steps (release order, one post at a time
 * across the account, the quota gate, insights cadence); the driver owns the
 * type's own rules (who may post, what the Instagram container looks like).
 * Each method calls the type's existing code, so the rules live in one place.
 */
export interface PublishDriver {
  vertical: SpineVertical;
  /** The type's own `publishing_live` switch. */
  live(): Promise<boolean>;
  /** The type's `require_approval` switch (on unless set to false). */
  requireApproval(): Promise<boolean>;
  /** What happens to a due slot whose content may not post: Carousels cancel it, Explainers fail it at queueing. */
  refusesAtRelease: 'cancel' | 'fail';
  /** Fail this type's attempts a dead process left mid-publish. */
  failStale(): Promise<void>;
  /** Due slots become attempts (or are cancelled/failed) under the type's rules. */
  releaseDue(): Promise<number>;
  /** Carry one claimed attempt (status `creating`) to Instagram. */
  carry(attemptId: string): Promise<{ id: string; status: 'published' | 'failed' }>;
  /** Read due insights for this type's published posts. */
  pollInsights(): Promise<{ considered: number; written: number; blocked: string | null; detail: string | null }>;
}
