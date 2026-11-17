import '@/app/reels/reels.css';

import { PoolSkeleton } from '@/components/content-type/pool/PoolSkeleton';

/** Shell for a content-type page (Carousels, Stories, and the rest) while its pool loads: the title, then the pool screen's skeleton. */
export function TypeHubLoading() {
  return (
    <div className="rh" role="status" aria-live="polite" aria-busy="true">
      <div className="rh__inner helios-loading">
        <span className="helios-skel helios-skel--title" />
        <PoolSkeleton />
        <span className="visually-hidden">Loading</span>
      </div>
    </div>
  );
}
