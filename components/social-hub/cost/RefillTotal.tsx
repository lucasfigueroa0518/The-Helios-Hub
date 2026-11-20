'use client';

import { useEffect, useState } from 'react';

const URL = '/api/social-hub/refill-total';

/**
 * The nightly total of all idea-pool refills (settings standard D19): every type's refill shares it, on top of its
 * own refill cap (set in the type's Settings tab). When tonight's refills reach it, the rest wait for the next night.
 * Making posts (drafting, renders) is not counted.
 */
export function RefillTotal() {
  const [data, setData] = useState<{ totalUsd: number; spentUsd: number | null } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(URL, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => (typeof j?.totalUsd === 'number' ? setData({ totalUsd: j.totalUsd, spentUsd: typeof j.spentUsd === 'number' ? j.spentUsd : null }) : setError(j?.error ?? 'Could not read the nightly refill total.')))
      .catch(() => setError('Could not read the nightly refill total.'));
  }, []);

  const parsed = draft === null ? null : Number(draft.replace(/^\$/, '').trim());
  const valid = parsed !== null && Number.isFinite(parsed) && parsed > 0 && parsed <= 50;

  async function save() {
    if (!valid || parsed === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ totalUsd: parsed }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? 'Saving failed.');
      setData((d) => ({ totalUsd: j.totalUsd, spentUsd: d?.spentUsd ?? null }));
      setDraft(null);
      setNote(`Saved: $${Number(j.totalUsd).toFixed(2)} a night.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sh-cost-refill">
      <label htmlFor="sh-refill-total">Nightly refill total</label>{' '}
      <span>
        $
        <input
          id="sh-refill-total"
          type="text"
          inputMode="decimal"
          size={6}
          value={draft ?? (data ? data.totalUsd.toFixed(2) : '')}
          disabled={busy || !data}
          aria-invalid={draft !== null && !valid}
          onChange={(e) => { setDraft(e.target.value); setNote(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setDraft(null); }}
        />
      </span>{' '}
      {draft !== null ? (
        <>
          <button type="button" disabled={busy || !valid} onClick={() => void save()}>Save</button>{' '}
          <button type="button" onClick={() => setDraft(null)}>Cancel</button>
        </>
      ) : null}
      {data?.spentUsd != null ? <span className="sh-ops-sub"> · tonight so far ${data.spentUsd.toFixed(2)}</span> : null}
      <p className="sh-ops-sub">
        All types&apos; idea-pool refills share this each night, on top of each type&apos;s own refill cap. Once it is reached, the
        rest of the night&apos;s refills wait for the next night. Making posts isn&apos;t counted.
      </p>
      {draft !== null && !valid ? <p role="alert">A dollar amount above $0 and at most $50.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {note ? <p role="status">{note}</p> : null}
    </div>
  );
}
