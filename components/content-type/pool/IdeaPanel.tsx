'use client';

import type { ReactNode } from 'react';
import { Archive, ExternalLink, Pin, Sparkles } from 'lucide-react';

import { Badge, ScoreSection, SidePanel } from '@/components/content-type/pool/bits';
import type { PoolRowState } from '@/lib/content-type/pool-rules';
import { runStatusText, type RunSnapshot } from '@/lib/content-type/run-status';
import type { HubIdea } from '@/lib/social-hub/types';
import { shortDate } from '@/lib/social-hub/views/format';

/**
 * An idea's side panel (DESIGN.md Pool screen, Idea panel): full title and text, details, where the score comes from,
 * the source, and Make it, Pin and Archive. A failed try's full error shows here, and only here, under "The last try
 * stopped."
 */
export function IdeaPanel({ idea, state, run, now, details, pinned, moves, readOnly, extras, onClose, onMake, onPin, onArchive }: {
  idea: HubIdea;
  state: PoolRowState;
  /** The idea's render (live poll first), for the status line and the error. */
  run: RunSnapshot | null;
  now: number;
  /** The details list: label and value, in order. */
  details: Array<[string, string]>;
  pinned: boolean;
  moves: { pin: boolean; archive: boolean; make: boolean };
  readOnly: boolean;
  /** A type's own controls for the idea (Text on Screen: Generate Reel). */
  extras?: ReactNode;
  onClose: () => void;
  onMake: () => void;
  onPin: () => void;
  onArchive: () => void;
}) {
  const canMake = moves.make && (state === 'idea' || state === 'failed');
  const status = run && run.state !== 'failed' ? runStatusText(run, now) : null;
  const foot = readOnly ? null : (
    <>
      {canMake ? <button type="button" className="pl-btn pl-btn--primary" onClick={onMake}><Sparkles className="pl-i" aria-hidden="true" />Make it</button> : null}
      {moves.pin ? <button type="button" className="pl-btn" onClick={onPin} disabled={state === 'making'}><Pin className="pl-i" aria-hidden="true" />{pinned ? 'Unpin' : 'Pin'}</button> : null}
      {moves.archive ? <button type="button" className="pl-btn" onClick={onArchive} disabled={state === 'making'}><Archive className="pl-i" aria-hidden="true" />Archive</button> : null}
    </>
  );
  return (
    <SidePanel title={idea.title} label="Idea details" onClose={onClose} foot={foot}>
      <p className="pl-status"><Badge state={state} />{status ? <span>{status}</span> : null}</p>
      {idea.detail ? <p style={{ margin: '12px 0 0' }}>{idea.detail}</p> : null}
      <dl className="pl-dl">
        {details.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
        {idea.createdAt ? <div style={{ display: 'contents' }}><dt>Added on</dt><dd>{shortDate(idea.createdAt)}</dd></div> : null}
      </dl>
      {idea.link ? <p><a className="pl-btn" href={idea.link} target="_blank" rel="noreferrer">Open the source <ExternalLink className="pl-i" aria-hidden="true" /></a></p> : null}
      <ScoreSection idea={idea} />
      {state === 'failed' ? (
        <div className="pl-err">
          <b>The last try stopped.</b> {moves.make ? 'Make it starts a fresh one.' : 'The next run tries again.'}
          {run?.error ? <code>{run.error}</code> : null}
        </div>
      ) : null}
      {extras ? <div className="pl-extras">{extras}</div> : null}
    </SidePanel>
  );
}
