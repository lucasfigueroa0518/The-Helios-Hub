import type { TipNote } from '@/lib/social-hub/types';

/**
 * A Field Notes post's tips under its slides in the post panel (UI-REWORK-CONTRACT C5): per tip, the tool's name in
 * bold and how to try it (both go to the caption, not the slide), then its kind, want and know-how as small chips; an
 * untagged one says so. Nothing for a post with no tips. Styled in components/content-type/pool/pool.css (`.pl-tips`).
 */
export function TipNotes({ notes }: { notes: TipNote[] }) {
  if (!notes.length) return null;
  return (
    <section className="pl-tips" aria-label="Tips on this post">
      <h4 className="pl-tips__title">Tips</h4>
      <ol className="pl-tips__list">
        {notes.map((note, i) => (
          <li key={i} className="pl-tips__item">
            <p className="pl-tips__try">
              {note.name ? <strong>{note.name}</strong> : <strong>{note.subject || `Tip ${i + 1}`}</strong>}
              {note.tryIt ? <>: <span>{note.tryIt}</span></> : null}
            </p>
            <span className="pl-tips__tags">
              <span className="pl-tips__chip">{note.kind ?? 'Kind not tagged'}</span>
              <span className="pl-tips__chip">{note.want ?? 'Want not tagged'}</span>
              <span className="pl-tips__chip">{note.knowHow ?? 'Know-how not tagged'}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
