'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, ExternalLink, Info } from 'lucide-react';


import { LEAF_LABEL, TIER_LABEL, WANT_LABEL } from './constants';
import type { ReviewPost, ReviewTip } from './load';

/** The tip's leaf, want and know-how tier as small plain labels; an untagged one says so. */
function TipTags({ tip }: { tip: ReviewTip }) {
  return (
    <span className="fn-review__tags">
      <span className="rh-chip">{tip.leaf ? LEAF_LABEL[tip.leaf] : 'Kind not tagged'}</span>
      <span className="rh-chip">{tip.want ? WANT_LABEL[tip.want] : 'Want not tagged'}</span>
      <span className="rh-chip">{tip.tier ? TIER_LABEL[tip.tier] : 'Know-how not tagged'}</span>
    </span>
  );
}

/** A tip slide's figure: the slide, then its name and how-to-try line in small text, no wider than the slide. */
const FIGURE_STYLE = { margin: 0, flex: 'none', display: 'grid', gap: 4, width: 224, alignContent: 'start' } as const;

/** The tool's real name and how to try it (both go to the caption, not the slide), small, under the slide. */
function TryItNote({ name, tryIt }: { name: string | null; tryIt: string | null }) {
  return (
    <figcaption className="rh-muted" style={{ fontSize: 12, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
      {name ? <strong>{name}</strong> : null}
      {name && tryIt ? ': ' : null}
      {tryIt ? <span>{tryIt}</span> : null}
    </figcaption>
  );
}

type Verb = 'approve' | 'reject';
const ENDPOINT: Record<Verb, string> = {
  approve: '/api/social-hub/actions/approve-content',
  reject: '/api/social-hub/actions/reject',
};
const CONFIRM: Partial<Record<Verb, string>> = {
  reject: 'Reject this Field Notes post? It will not post.',
};

function ReviewActions({ postId }: { postId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Verb | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function act(verb: Verb) {
    const ask = CONFIRM[verb];
    if (ask && !confirm(ask)) return;
    setBusy(verb);
    try {
      const res = await fetch(ENDPOINT[verb], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vertical: 'field_notes', refs: { fieldNotesPostId: postId } }) });
      const json = (await res.json().catch(() => ({}))) as { note?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? json.note ?? `Request failed (${res.status})`);
      setNote(json.note ?? 'Done.');
      router.refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="fn-review__actions">
      <button type="button" className="rh-btn rh-btn--primary" disabled={busy !== null} onClick={() => void act('approve')}>Approve</button>
      <button type="button" className="rh-btn" disabled={busy !== null} onClick={() => void act('reject')}>Reject</button>
      {note ? <span className="rh-muted" role="status">{note}</span> : null}
    </div>
  );
}

function NoteList({ items, icon, title }: { items: string[]; icon: 'warn' | 'info'; title: string }) {
  if (items.length === 0) return null;
  const Icon = icon === 'warn' ? AlertTriangle : Info;
  return (
    <div>
      <h4 className="rh-card__sub">{title}</h4>
      <ul className="rh-notes">
        {items.map((n, i) => (
          <li key={i} className={`rh-note${icon === 'warn' ? ' rh-note--warn' : ''}`}><Icon size={14} aria-hidden="true" /> {n}</li>
        ))}
      </ul>
    </div>
  );
}

/** Posts waiting for review: slides, caption, the tip and its source, soft notes and fit problems, then Approve and Reject (to change a post, reject it and generate a new one). */
export function FieldNotesReviewPanel({ posts }: { posts: ReviewPost[] }) {
  if (posts.length === 0) return null;
  return (
    <section className="fn-review" aria-label="Field Notes posts to review">
      <h3 className="rh-card__title rh-card__title--flush">Waiting for review</h3>
      {posts.map((p) => (
        <article key={p.id} className="rh-card fn-review__post">
          <div className="fn-slides" role="list" aria-label="Slides">
            {p.hasSlides
              ? Array.from({ length: p.slideCount }, (_, i) => {
                  // Slide 0 is the cover; tip slides follow in tip order, then the Follow slide.
                  const tip = i > 0 ? p.tips[i - 1] : undefined;
                  return (
                    <figure key={i} role="listitem" style={FIGURE_STYLE}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="fn-slide" src={`/api/field-notes/slides/${p.id}/${i}?v=${p.renderVersion}`} alt={p.slideHeadlines[i] ? `Slide ${i + 1}: ${p.slideHeadlines[i]}` : `Slide ${i + 1}`} loading="lazy" />
                      {tip?.name || tip?.tryIt ? <TryItNote name={tip.name} tryIt={tip.tryIt} /> : null}
                    </figure>
                  );
                })
              : <p className="rh-empty">The slides have not been rendered yet.</p>}
          </div>
          <div className="fn-review__body">
            {p.tips.length ? (
              <div>
                <h4 className="rh-card__sub">{p.tips.length === 1 ? 'The tip' : `The ${p.tips.length} tips`}</h4>
                <ol className="fn-review__tips">
                  {p.tips.map((t) => (
                    <li key={t.id}>
                      <p className="fn-review__tip"><strong>{t.subject}</strong> <TipTags tip={t} /></p>
                      {t.useWithResult ? <p>{t.useWithResult}</p> : null}
                      {t.sourceUrl ? (
                        <a className="fn-review__source" href={t.sourceUrl} target="_blank" rel="noreferrer noopener">
                          {t.sourceLabel ?? t.sourceUrl} <ExternalLink size={13} aria-hidden="true" />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            <div>
              <h4 className="rh-card__sub">Caption</h4>
              <p className="fn-review__caption">{p.caption}</p>
            </div>
            <NoteList items={p.fitProblems} icon="warn" title="Fit problems" />
            <NoteList items={p.renderProblems} icon="warn" title="Render problems" />
            <NoteList items={p.softNotes} icon="info" title="Notes" />
            <ReviewActions postId={p.id} />
          </div>
        </article>
      ))}
    </section>
  );
}
