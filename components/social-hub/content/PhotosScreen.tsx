import type { GridPhoto } from '@/components/field-notes/PoolGrid';
import { FieldNotesPhotosSection } from '@/components/social-hub/library/FieldNotesPhotosSection';
import { laneLabel, PhotoGrid } from '@/components/social-hub/library/PhotoGrid';
import { Breadcrumbs } from '@/components/social-hub/nav/Breadcrumbs';
import { HubLink } from '@/components/social-hub/nav/HubNav';
import { Menu } from '@/components/social-hub/ui/Menu';
import { PageHead } from '@/components/social-hub/ui/PageHead';
import type { LibraryPage, LibrarySummary } from '@/lib/media-library/read';
import { withParams, type HubParams } from '@/lib/social-hub/links';
import { plural, relative } from '@/lib/social-hub/views/format';
import { crumbsFor } from '@/lib/social-hub/views/nav';

const USED = [
  { id: 'all', label: 'All' },
  { id: 'unused', label: 'Not used yet' },
  { id: 'used', label: 'Used in a post' },
] as const;

/** The Photo Bank's two sections (UI-REWORK-CONTRACT C1): absent or unknown `section` is today's screen. */
export type PhotoBankSection = 'online' | 'field-notes';
export const photoBankSection = (params: HubParams): PhotoBankSection => (params.section === 'field-notes' ? 'field-notes' : 'online');

const SECTIONS: ReadonlyArray<{ id: PhotoBankSection; label: string }> = [
  { id: 'online', label: 'Found online' },
  { id: 'field-notes', label: 'Field Notes' },
];

/** What the Field Notes section shows; the page loads it only when that section is open. */
export type FieldNotesPhotos = { pool: GridPhoto[] | null; error: string | null; readOnly: boolean };

/**
 * Our own photo bank (D49): every vetted photo the carousel and Stories photo
 * finders turn up, kept with its credit and tags so the finder can draw on it
 * before searching online. A second section (`?section=field-notes`) holds the
 * Field Notes photos we upload ourselves: upload box and pool grid.
 */
export function PhotosScreen({ page, summary, fieldNotes, base, params, now }: { page?: LibraryPage; summary?: LibrarySummary; fieldNotes?: FieldNotesPhotos; base: string; params: HubParams; now: Date }) {
  const path = `${base}/content/library/photos`;
  const href = (changes: Record<string, string | null>) => withParams(path, '', params, { ...changes, page: 'page' in changes ? changes.page : null });
  const crumbs = <Breadcrumbs crumbs={crumbsFor(base, path)} />;
  const section = photoBankSection(params);
  // Switching section drops the online filters and paging (C1).
  const sections = (
    <div className="sh-toolbar">
      <div className="sh-pills" role="group" aria-label="Section">
        {SECTIONS.map((s) => (
          <HubLink key={s.id} className="sh-pill" href={s.id === section ? withParams(path, '', params, {}) : withParams(path, '', params, { section: s.id === 'online' ? null : s.id, used: null, lane: null, tag: null, page: null })} history="replace" aria-current={section === s.id ? 'page' : undefined}>{s.label}</HubLink>
        ))}
      </div>
    </div>
  );
  if (section === 'field-notes') {
    const pool = fieldNotes?.pool ?? null;
    const lastAdded = pool?.reduce<string | null>((max, p) => (max === null || p.uploadedAt > max ? p.uploadedAt : max), null) ?? null;
    return (
      <>
        {crumbs}
        <PageHead title="Photo bank" meta={pool ? `${plural(pool.length, 'photo')}${lastAdded ? ` · last added ${relative(lastAdded, now)}` : ''}` : undefined} />
        {sections}
        <p className="sh-note">Photos we take ourselves for Field Notes posts. A run picks from the live ones; a photo rests for a few posts after one uses it, and a rejected photo stays retired until it is restored.</p>
        <FieldNotesPhotosSection pool={pool} error={fieldNotes?.error ?? null} readOnly={fieldNotes?.readOnly ?? true} />
      </>
    );
  }
  if (!page || !summary || page.absent || summary.absent) {
    return (
      <>
        {crumbs}
        <PageHead title="Photo bank" />
        {sections}
        <div className="sh-panel sh-empty">
          <strong>The photo bank isn’t set up yet</strong>
          Once its tables exist and capture is switched on, every photo the finders vet is kept here with its credit and tags.
        </div>
      </>
    );
  }
  const used = USED.some((u) => u.id === params.used) ? params.used! : 'all';
  const pageCount = Math.max(1, Math.ceil(page.total / page.pageSize));
  return (
    <>
      {crumbs}
      <PageHead
        title="Photo bank"
        meta={`${plural(summary.stored, 'photo')} · ${summary.reusable.toLocaleString('en-US')} reusable · +${summary.addedLast7d} this week${summary.lastAddedAt ? ` · last added ${relative(summary.lastAddedAt, now)}` : ''}`}
      />
      {sections}
      <p className="sh-note">Photos the carousel and Stories finders vetted, with their credit. Reusable ones (open licence) can be picked again before the finders search online; library-only ones are company or article photos kept for reference.</p>
      <div className="sh-toolbar">
        <div className="sh-pills" role="group" aria-label="Show">
          {USED.map((u) => (
            <HubLink key={u.id} className="sh-pill" href={href({ used: u.id === 'all' ? null : u.id })} history="replace" aria-current={used === u.id ? 'page' : undefined}>{u.label}</HubLink>
          ))}
        </div>
        <div className="sh-toolbar__group">
          {page.facets.lanes.length ? (
            <Menu label="Kind" value={params.lane ?? 'all'} options={[{ value: 'all', label: 'Any', href: href({ lane: null }) }, ...page.facets.lanes.map((f) => ({ value: f.value, label: `${laneLabel(f.value)} (${f.count})`, href: href({ lane: f.value }) }))]} />
          ) : null}
          {page.facets.tags.length ? (
            <Menu label="Tag" value={params.tag ?? 'all'} options={[{ value: 'all', label: 'Any', href: href({ tag: null }) }, ...page.facets.tags.map((f) => ({ value: f.value, label: `${f.value} (${f.count})`, href: href({ tag: f.value }) }))]} />
          ) : null}
        </div>
      </div>
      {page.items.length === 0 ? (
        <div className="sh-panel sh-empty"><strong>No photos match</strong>Try another filter.</div>
      ) : (
        <PhotoGrid items={page.items} />
      )}
      {pageCount > 1 ? (
        <div className="sh-pager sh-pager--bare">
          <span className="sh-subtle">Page {page.page} of {pageCount} · {plural(page.total, 'photo')}</span>
          <span className="sh-pills">
            {page.page > 1 ? <HubLink className="sh-pill" href={href({ page: page.page === 2 ? null : String(page.page - 1) })} history="replace">Previous</HubLink> : null}
            {page.page < pageCount ? <HubLink className="sh-pill" href={href({ page: String(page.page + 1) })} history="replace">Next</HubLink> : null}
          </span>
        </div>
      ) : null}
    </>
  );
}
