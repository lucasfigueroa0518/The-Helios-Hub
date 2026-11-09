'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { poolVariety } from '@/lib/field-notes/photos/pool';
import type { FaceCheckState } from '@/lib/field-notes/photos/store';
import { PHOTO_KINDS, type PoolPhoto } from '@/lib/field-notes/types';

import { FACES_AUTO_LABEL, FACES_CHECKING_LABEL, PHOTO_KIND_LABEL, UPLOAD_KINDS } from '@/app/api/field-notes/photos/rules';

/** A pool photo with its face check when the loader read it (lib/field-notes/photos/store.ts listPool). */
type GridPhoto = PoolPhoto & { facesCheck?: FaceCheckState };

import { POOL_TARGET, THUMB, nameOf } from './constants';

const STATUS_LABEL: Record<PoolPhoto['status'], string> = { live: 'Live', resting: 'Resting', retired: 'Retired' };

async function post(body: Record<string, unknown>): Promise<string> {
  const res = await fetch('/api/field-notes/pool', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { note?: string; error?: string };
  if (!res.ok) throw new Error(json.error ?? json.note ?? `Request failed (${res.status})`);
  return json.note ?? 'Saved.';
}

function PhotoCard({ photo, restPosts }: { photo: GridPhoto; restPosts: number | null }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    try {
      setNote(await post({ photoId: photo.photoId, ...body }));
      setAsking(false);
      setReason('');
      router.refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={`fn-photo fn-photo--${photo.status}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="fn-photo__img" src={THUMB(photo.photoId)} alt={`Pool photo uploaded by ${nameOf(photo.uploadedBy)}`} loading="lazy" />
      <div className="fn-photo__meta">
        <span className={`rh-chip fn-chip--${photo.status}`}>{STATUS_LABEL[photo.status]}</span>
        <span className="rh-muted">{nameOf(photo.uploadedBy)}</span>
      </div>
      <div className="fn-photo__tags">
        {photo.kind === 'people' ? (
          <>
            <span className="rh-chip fn-kind is-on" title="Tagged automatically: a clear face was found, so this photo can be the first slide">{FACES_AUTO_LABEL}</span>
            {/* One click undoes a wrong Faces tag: back to Working, off the cover list. */}
            <button type="button" className="rh-btn rh-btn--xs" disabled={busy} title="Not a clear face photo: stop using it for the first slide" onClick={() => void act({ action: 'tag', kind: 'working', opener: false })}>Not faces</button>
          </>
        ) : (
          <>
            <label className="fn-visually-hidden" htmlFor={`kind-${photo.photoId}`}>Kind</label>
            <select id={`kind-${photo.photoId}`} className="rh-chip fn-kind-select" value={photo.kind} disabled={busy} onChange={(e) => void act({ action: 'tag', kind: e.target.value })}>
              {UPLOAD_KINDS.map((k) => <option key={k} value={k}>{PHOTO_KIND_LABEL[k]}</option>)}
            </select>
            {/* Queued at upload; the worker's face check tags a clear face Faces (auto) shortly after. */}
            {photo.facesCheck === 'pending' ? <span className="rh-chip rh-muted fn-kind fn-kind--checking" title="The face check runs shortly after upload; a clear face is tagged Faces (auto)">{FACES_CHECKING_LABEL}</span> : null}
            {photo.facesCheck === 'unavailable' ? <span className="rh-muted fn-kind--unavailable" title="The face check could not run on this photo, so it keeps the kind it was given">Face check could not run</span> : null}
          </>
        )}
      </div>
      {photo.status === 'resting' && restPosts !== null && photo.lastUsedPostSeq !== null ? <p className="rh-muted fn-photo__line">Used in post {photo.lastUsedPostSeq}; rests for {restPosts} posts.</p> : null}
      {photo.status === 'retired' && photo.rejectReason ? <p className="rh-muted fn-photo__line">Rejected: {photo.rejectReason}</p> : null}
      {photo.status === 'retired' ? (
        <button type="button" className="rh-btn rh-btn--xs" disabled={busy} onClick={() => void act({ action: 'restore' })}>Restore</button>
      ) : asking ? (
        <form className="fn-reject" onSubmit={(e) => { e.preventDefault(); void act({ action: 'reject', reason }); }}>
          <label className="rh-muted" htmlFor={`why-${photo.photoId}`}>Why? A readable private screen, a recognizable stranger, or a prominent third-party logo.</label>
          <input id={`why-${photo.photoId}`} className="helios-field-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
          <div className="fn-reject__actions">
            <button type="submit" className="rh-btn rh-btn--xs rh-btn--primary" disabled={busy || !reason.trim()}>Reject photo</button>
            <button type="button" className="rh-btn rh-btn--xs" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="rh-btn rh-btn--xs" onClick={() => setAsking(true)}>Reject</button>
      )}
      {note ? <p className="rh-muted" role="status">{note}</p> : null}
    </li>
  );
}

/**
 * The pool as thumbnails: status, who added it, its kind, the count against the target, and a manual Reject (with a
 * reason) and Restore. Faces are tagged automatically shortly after upload (the worker's face check): a photo not
 * checked yet shows "Checking for faces…", a tagged one "Faces (auto)"; one click ("Not faces") removes a wrong tag.
 * Other photos can switch between working, scenery and event.
 */
export function PoolGrid({ pool, restPosts = null }: { pool: GridPhoto[]; restPosts?: number | null }) {
  const live = pool.filter((p) => p.status === 'live').length;
  const resting = pool.filter((p) => p.status === 'resting').length;
  const retired = pool.filter((p) => p.status === 'retired').length;
  const variety = poolVariety(pool);
  return (
    <section className="fn-pool" aria-label="Photo pool">
      <div className="fn-pool__head">
        <h3 className="rh-card__title rh-card__title--flush">Photo pool</h3>
        <span className="rh-chip rh-chip--quota">{live} of about {POOL_TARGET} live</span>
        <span className="rh-muted fn-pool__counts">{resting} resting, {retired} retired</span>
      </div>
      {pool.length > 0 ? (
        <p className="rh-muted fn-pool__variety">
          Live by kind: {PHOTO_KINDS.map((k) => `${k === 'people' ? FACES_AUTO_LABEL : PHOTO_KIND_LABEL[k]} ${variety.counts[k]}`).join(', ')}.
        </p>
      ) : null}
      {variety.warnings.map((w) => <p key={w} className="rh-empty fn-pool__warn" role="status">{w}</p>)}
      {pool.length === 0 ? (
        <p className="rh-empty">No photos yet. Add some above; a post needs real photos to be made.</p>
      ) : (
        <ul className="fn-grid">
          {pool.map((p) => <PhotoCard key={p.photoId} photo={p} restPosts={restPosts} />)}
        </ul>
      )}
    </section>
  );
}
