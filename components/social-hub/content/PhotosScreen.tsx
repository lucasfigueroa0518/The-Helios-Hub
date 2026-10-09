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

/**
 * Our own photo bank (D49): every vetted photo the carousel and Stories photo
 * finders turn up, kept with its credit and tags so the finder can draw on it
 * before searching online.
 */
export function PhotosScreen({ page, summary, base, params, now }: { page: LibraryPage; summary: LibrarySummary; base: string; params: HubParams; now: Date }) {
  const path = `${base}/content/library/photos`;
  const href = (changes: Record<string, string | null>) => withParams(path, '', params, { ...changes, page: 'page' in changes ? changes.page : null });
  const crumbs = <Breadcrumbs crumbs={crumbsFor(base, path)} />;
  if (page.absent || summary.absent) {
    return (
      <>
        {crumbs}
        <PageHead title="Photo bank" />
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
