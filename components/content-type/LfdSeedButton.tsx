'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';

import { Drawer } from '@/app/reels/ui';
import { refreshHubPage } from '@/lib/content-type/refresh-client';

/**
 * "Seed an idea" on the Last Few Days pool (design 2026-10-26-last-few-days-queue-and-seeding): a link, and a headline if the
 * page's own is not wanted. Posts only to /api/last-few-days/seed. Adds the story to the next run; nothing is made or spent.
 */
export function LfdSeedButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [headline, setHeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/last-few-days/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, headline }) });
      const json = (await res.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setNote(`“${json.title ?? 'The story'}” will be in the next run. Nothing was made.`);
      setOpen(false);
      setUrl('');
      setHeadline('');
      void refreshHubPage(router);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="rh-btn" onClick={() => setOpen(true)}>
        <Plus size={15} /> Seed an idea
      </button>
      {open ? (
        <Drawer label="Seed a story" onClose={() => setOpen(false)}>
          <form className="ex-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <h2 className="rh-detail__archetype">Seed a story</h2>
            <input className="helios-field-input" placeholder="Link to the story" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Link to the story" />
            <input className="helios-field-input" placeholder="Headline (optional)" value={headline} onChange={(e) => setHeadline(e.target.value)} aria-label="Headline" />
            <div className="ex-actions">
              <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || !url.trim()}>{busy ? 'Reading the page…' : 'Add to the next run'}</button>
            </div>
            <p className="rh-muted">Adds the story to the next run. Nothing is made and nothing is spent.</p>
            {error ? <p className="rh-note rh-note--bad">{error}</p> : null}
          </form>
        </Drawer>
      ) : null}
      {note ? <p className="rh-toast" role="status">{note}</p> : null}
    </>
  );
}
