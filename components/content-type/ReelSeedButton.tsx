'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';

import { Drawer } from '@/app/reels/ui';
import { refreshHubPage } from '@/lib/content-type/refresh-client';

/**
 * Text on Screen: type an idea into the queue (design 2026-10-26-text-on-screen-seeding). A headline, optionally your own
 * text and a link. The idea is scored once (well under a cent) and waits a week; nothing is made.
 */

const MAX_TEXT = 10_000;

type SeedOut = { title: string; scored: boolean; net: number | null; flags: string[] };

export function ReelSeedButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [headline, setHeadline] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/reels/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ headline, text, url }) });
      const out = (await res.json().catch(() => ({}))) as SeedOut & { error?: string };
      if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
      const scored = out.scored && out.net != null ? `scored ${out.net.toFixed(2)}` : out.scored ? 'scored, but no bucket cleared its bar' : 'not scored yet';
      setNote(`“${out.title}” is in the queue, ${scored}. Nothing was made.${out.flags.length ? ` ${out.flags.join(' ')}` : ''}`);
      setOpen(false);
      setHeadline('');
      setText('');
      setUrl('');
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
        <Drawer label="Seed an idea" onClose={() => setOpen(false)}>
          <form className="ex-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <h2 className="rh-detail__archetype">Seed an idea</h2>
            <input className="helios-field-input" placeholder="Headline" maxLength={200} value={headline} onChange={(e) => setHeadline(e.target.value)} aria-label="Headline" />
            <textarea className="helios-field-input" placeholder="Your text (optional): the story, in your words" rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Your text" />
            <p className="rh-muted">{text.length.toLocaleString('en-US')} of {MAX_TEXT.toLocaleString('en-US')} characters. A one-line idea gives thin copy; a few lines give the writer facts.</p>
            <input className="helios-field-input" placeholder="Link (optional)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Link" />
            <div className="ex-actions">
              <button type="submit" className="rh-btn rh-btn--primary" disabled={busy || !headline.trim() || text.length > MAX_TEXT}>{busy ? 'Scoring…' : 'Add and score'}</button>
            </div>
            <p className="rh-muted">Scores the idea once, well under a cent. Nothing is made.</p>
            {error ? <p className="rh-note rh-note--bad">{error}</p> : null}
          </form>
        </Drawer>
      ) : null}
      {note ? <p className="rh-toast" role="status">{note}</p> : null}
    </>
  );
}
