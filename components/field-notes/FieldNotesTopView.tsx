import type { PoolPhoto } from '@/lib/field-notes/types';

import { FieldNotesReviewPanel } from './FieldNotesReviewPanel';
import { PoolGrid } from './PoolGrid';
import { UploadBox } from './UploadBox';
import type { PanelData } from './load';

/** The panels, from data already loaded: upload box first, then the pool, then posts to review. Pure display, so it renders offline. */
export function FieldNotesTopView({ data, error = null, restPosts = null }: { data: PanelData | null; error?: string | null; restPosts?: number | null }) {
  return (
    <div className="rh rh--scope">
      <div className="fn-top">
        <UploadBox />
        {error || !data ? (
          <p className="rh-empty">Could not load the photo pool{error ? `: ${error}` : ''}. The Field Notes schema may not be applied yet.</p>
        ) : (
          <>
            <FieldNotesReviewPanel posts={data.posts} />
            <PoolGrid pool={data.pool as PoolPhoto[]} restPosts={restPosts} />
          </>
        )}
      </div>
    </div>
  );
}
