'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Copy, Loader2, UploadCloud } from 'lucide-react';

import { FACES_NOTICE, PHOTO_KIND_LABEL, POSTING_NOTICE, UPLOAD_KINDS, type UploadKind } from '@/app/api/field-notes/photos/rules';

import { THUMB } from './constants';
import { ACCEPT_ATTR, sendFile, uploadFiles, type FileOutcome, type FileStage, type SendFile, type UploadItem } from './upload-client';

type Row = { name: string; stage: FileStage; outcome: FileOutcome | null };

const STAGE_TEXT: Record<FileStage, string> = { queued: 'Queued.', uploading: 'Uploading…', processing: 'Processing (converting, checking for duplicates)…' };
type Staged = { file: File; kind: UploadKind | null };

/** Working, Scenery or Event. Faces is not a choice: the server tags it when a face is clear. */
function KindChips({ value, onPick, label }: { value: UploadKind | null; onPick: (k: UploadKind) => void; label: string }) {
  return (
    <div className="fn-kinds" role="group" aria-label={label}>
      {UPLOAD_KINDS.map((k) => (
        <button key={k} type="button" className={`rh-chip fn-kind${value === k ? ' is-on' : ''}`} aria-pressed={value === k} onClick={() => onPick(k)}>{PHOTO_KIND_LABEL[k]}</button>
      ))}
    </div>
  );
}

/**
 * The Field Notes upload box: drop photos or choose them, one file at a time. Each file shows queued, uploading,
 * processing, then done (faces are checked shortly after, on the worker), a duplicate (with the photo it matched and why) or failed (with
 * the reason). The person picks working, scenery or event; faces are detected by the worker after upload. Nothing here calls a model.
 * `send` is injectable for tests.
 */
export function UploadBox({ send: sendOne = sendFile }: { send?: SendFile }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [batchKind, setBatchKind] = useState<UploadKind | null>(null);

  /** Files wait here until each has a kind: one chip row for the batch, then a change per file if it differs. */
  function stage(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length === 0 || busy) return;
    setRows([]);
    setStaged(files.map((file) => ({ file, kind: batchKind })));
  }
  function pickBatch(kind: UploadKind) {
    setBatchKind(kind);
    setStaged((prev) => prev.map((s) => ({ ...s, kind })));
  }
  const patch = (i: number, change: Partial<Staged>) => setStaged((prev) => prev.map((s, j) => (j === i ? { ...s, ...change } : s)));

  async function send() {
    if (busy || staged.length === 0 || staged.some((s) => !s.kind)) return;
    const items: UploadItem[] = staged.map((s) => ({ file: s.file, kind: s.kind! }));
    setBusy(true);
    setRows(items.map((it) => ({ name: it.file.name, stage: 'queued', outcome: null })));
    setStaged([]);
    await uploadFiles(
      items,
      sendOne,
      (i, outcome) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, outcome } : r))),
      (i, stage) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, stage } : r))),
    );
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="fn-upload">
      <div
        className={`fn-drop${over ? ' is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); stage(e.dataTransfer.files); }}
      >
        <UploadCloud size={20} aria-hidden="true" />
        <div className="fn-drop__text">
          <strong>Add photos</strong>
          <span className="rh-muted">Drop HEIC, HEIF, JPEG, PNG or WebP files here. Up to 25 MB each; iPhone photos are converted for you. Say what the photos show; faces are found for you shortly after upload.</span>
        </div>
        <button type="button" className="rh-btn rh-btn--primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Adding…' : 'Choose photos'}
        </button>
        <input ref={input} type="file" multiple hidden accept={ACCEPT_ATTR} aria-label="Choose photos to add" onChange={(e) => { stage(e.target.files ?? []); e.target.value = ''; }} />
      </div>
      <p className="rh-muted fn-notice" role="note">{POSTING_NOTICE}</p>
      <p className="rh-muted fn-notice" role="note">{FACES_NOTICE}</p>
      <div className="fn-tagrow">
        <span className="rh-muted">What do these photos show?</span>
        <KindChips value={batchKind} onPick={pickBatch} label="Kind for this batch" />
      </div>
      {staged.length ? (
        <>
          <ul className="fn-results" aria-label="Photos waiting to be added">
            {staged.map((st, i) => (
              <li key={`${st.file.name}-${i}`} className="fn-result fn-result--pending">
                <span className="fn-result__name">{st.file.name}</span>
                <KindChips value={st.kind} onPick={(k) => patch(i, { kind: k })} label={`Kind for ${st.file.name}`} />
              </li>
            ))}
          </ul>
          <div className="fn-tagrow">
            <button type="button" className="rh-btn rh-btn--primary" disabled={busy || staged.some((st) => !st.kind)} onClick={() => void send()}>
              Add {staged.length} {staged.length === 1 ? 'photo' : 'photos'}
            </button>
            {staged.some((st) => !st.kind) ? <span className="rh-muted">Pick what each photo shows first.</span> : null}
          </div>
        </>
      ) : null}
      {rows.length ? (
        <ul className="fn-results" aria-live="polite">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className={`fn-result fn-result--${r.outcome ? (r.outcome.state === 'done' ? 'stored' : r.outcome.state === 'failed' ? 'refused' : r.outcome.state) : 'pending'}`}>
              {r.outcome === null ? (r.stage === 'queued' ? <Clock size={15} aria-hidden="true" /> : <Loader2 size={15} className="rh-spin" aria-hidden="true" />)
                : r.outcome.state === 'done' ? <CheckCircle2 size={15} aria-hidden="true" />
                : r.outcome.state === 'duplicate' ? <Copy size={15} aria-hidden="true" />
                : <AlertTriangle size={15} aria-hidden="true" />}
              <span className="fn-result__name">{r.name}</span>
              <span className="fn-result__what">
                {r.outcome === null ? STAGE_TEXT[r.stage]
                  : r.outcome.state === 'done' ? r.outcome.note
                  : r.outcome.state === 'duplicate' ? r.outcome.reason
                  : r.outcome.reason}
              </span>
              {r.outcome?.state === 'duplicate' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="fn-result__match" src={THUMB(r.outcome.matchId)} alt={`The photo ${r.name} matched`} width={40} height={40} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
