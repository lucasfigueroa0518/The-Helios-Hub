'use client';

import { POOL_TARGET } from '@/components/field-notes/constants';
import { PoolGrid, type GridPhoto } from '@/components/field-notes/PoolGrid';
import { UploadBox } from '@/components/field-notes/UploadBox';

/**
 * The Photo Bank's Field Notes section (UI-REWORK-CONTRACT C3): our own iPhone photos for Field Notes posts.
 * One count line, the upload box, then the pool grid (rest, retire, restore, re-tag). `readOnly` (the development
 * preview) hides the upload box and every grid action. The page loads the pool; this only shows it.
 * Styles: components/social-hub/library/field-notes-photos.css, imported by the photo pages (the hub does not load
 * app/reels/reels.css, so the `rh-` classes UploadBox and PoolGrid use are styled there in the hub's look).
 */
export function FieldNotesPhotosSection({ pool, error, readOnly }: { pool: GridPhoto[] | null; error: string | null; readOnly: boolean }) {
  const count = (status: GridPhoto['status']) => (pool ?? []).filter((p) => p.status === status).length;
  return (
    <section className="sh-fnphotos" aria-labelledby="sh-fnphotos-title">
      <h2 id="sh-fnphotos-title" className="sh-visually-hidden">Field Notes photos</h2>
      {pool ? (
        <p className="sh-fnphotos__meta">
          {count('live')} of about {POOL_TARGET} live · {count('resting')} resting · {count('retired')} retired
        </p>
      ) : null}
      {readOnly ? null : (
        <div className="sh-panel sh-fnphotos__upload">
          <UploadBox />
        </div>
      )}
      {pool ? (
        <PoolGrid pool={pool} readOnly={readOnly} head={false} />
      ) : (
        <div className="sh-panel sh-empty">
          <strong>Could not load the Field Notes photos</strong>
          {error ? `${error.replace(/\.\s*$/, '')}. ` : ''}The Field Notes schema may not be applied yet.
        </div>
      )}
    </section>
  );
}
