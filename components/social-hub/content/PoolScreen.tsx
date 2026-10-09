import { Breadcrumbs } from '@/components/social-hub/nav/Breadcrumbs';
import { DataNotes } from '@/components/social-hub/DataNotes';
import { HubLink } from '@/components/social-hub/nav/HubNav';
import { PageHead } from '@/components/social-hub/ui/PageHead';
import { TypeMark } from '@/components/social-hub/ui/marks';
import type { HubDataset } from '@/lib/social-hub/dataset';
import { withParams, type HubParams } from '@/lib/social-hub/links';
import { verticalInfo } from '@/lib/social-hub/verticals';
import { relative, shortDate, when } from '@/lib/social-hub/views/format';
import { crumbsFor } from '@/lib/social-hub/views/nav';
import { IDEA_STATE_LABEL, poolList, poolStale, poolSummary, type PoolFilter } from '@/lib/social-hub/views/pools';
import type { IdeaState, Vertical } from '@/lib/social-hub/types';

const FILTERS: Array<{ id: PoolFilter; label: string }> = [
  { id: 'open', label: 'Waiting' },
  { id: 'ready', label: 'Content ready' },
  { id: 'all', label: 'Everything' },
];

/** Where each type's ideas come from and get picked (planning/Social Hub/REDESIGN/BRIEFS.md §1). */
const HOW: Record<Vertical, string> = {
  reels: 'Scored each night at 1:00 AM; the top three get videos and slots.',
  explainers: 'Refilled at 2:00 AM; the two best topics are rendered when auto-render is on.',
  carousels: 'The 3:00 AM run shortlists stories; the top two become posts. A finished post keeps its rank and is reused.',
  stories: 'Built at 4:00 AM from the other pools, one set per series that is due.',
};

const ALL_ARE: Record<IdeaState, string> = {
  idea_only: 'ideas with nothing made yet',
  content_ready: 'made and ready',
  on_deck: 'scheduled',
  published: 'posted',
  retired: 'retired',
  skipped: 'skipped',
};

/** One type's idea pool, ranked on its own scale (REVISIONS C6). */
export function PoolScreen({ dataset, base, vertical, params, now, embeddedIn }: { dataset: HubDataset; base: string; vertical: Vertical; params: HubParams; now: Date; embeddedIn?: string }) {
  // Embedded in a type page's Pool tab: no crumbs or title of its own, and its filters stay on that page.
  const path = embeddedIn ?? `${base}/content/pools/${vertical}`;
  const filter: PoolFilter = params.show === 'ready' || params.show === 'all' ? params.show : 'open';
  const summary = poolSummary(dataset.ideas, vertical);
  const ideas = poolList(dataset.ideas, vertical, filter);
  const top = Math.max(...ideas.map((i) => i.score ?? 0), 0) || 1;
  // A detail every row shares says nothing about any one idea; dates read as dates, not ISO.
  const parts = (d: string | null | undefined) => (d ? d.split(' · ') : []);
  const everywhere = ideas.length > 1 ? new Set(parts(ideas[0]!.detail).filter((x) => ideas.every((i) => parts(i.detail).includes(x)))) : new Set<string>();
  const detailOf = (d: string | null | undefined) =>
    parts(d).filter((x) => !everywhere.has(x)).map((x) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? shortDate(x) : x)).join(' · ') || null;
  const addedOf = (idea: (typeof ideas)[number]) => (idea.createdAt ?? idea.generatedAt ? when(idea.createdAt ?? idea.generatedAt, now) : '—');
  // A column that says the same thing on every row is noise; say it once above the table instead.
  const stateVaries = new Set(ideas.map((i) => `${i.state}:${i.versionCount > 1}`)).size > 1;
  const addedVaries = new Set(ideas.map(addedOf)).size > 1;
  const info = verticalInfo(vertical);
  const stale = poolStale(summary.lastRefill, now);

  return (
    <>
      {embeddedIn ? null : (
        <>
          <Breadcrumbs crumbs={crumbsFor(base, path)} />
          <PageHead
            title={`${info.label} pool`}
            meta={`${summary.open} waiting · ${summary.ready} with content ready${summary.lastRefill && !stale ? ` · refilled ${relative(summary.lastRefill, now)}` : ''}`}
          />
        </>
      )}
      {stale ? (
        <p className="sh-note sh-note--failed">
          This pool hasn’t refilled in {relative(summary.lastRefill, now).replace(/ ago$/, '')}; it normally refills every night. Check the nightly idea run in {info.label}.
        </p>
      ) : null}
      <DataNotes dataset={dataset} />
      <p className="sh-note">
        {HOW[vertical]}
        {ideas.length > 1 && !stateVaries ? ` All ${ideas.length} are ${ALL_ARE[ideas[0]!.state]}.` : ''}
        {ideas.length > 1 && !addedVaries && addedOf(ideas[0]!) !== '—' ? ` All added ${addedOf(ideas[0]!).replace(/^(Today|Tomorrow|Yesterday)/, (w) => w.toLowerCase())}.` : ''}
      </p>
      <div className="sh-filters">
        <div className="sh-pills" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <HubLink key={f.id} className="sh-pill" href={withParams(path, '', params, { show: f.id === 'open' ? null : f.id })} history="replace" aria-current={filter === f.id ? 'page' : undefined}>
              {f.label}
            </HubLink>
          ))}
        </div>
      </div>
      {ideas.length === 0 ? (
        <div className="sh-panel sh-empty"><strong>Nothing here</strong>{filter === 'open' ? 'The pool is empty until its next refill.' : 'No ideas match.'}</div>
      ) : (
        <div className="sh-panel">
          <div className="sh-table-wrap">
            <table className="sh-table sh-table--stack">
              <thead>
                <tr>
                  <th scope="col">Idea</th>
                  <th scope="col">{summary.scoreLabel ?? 'Score'}</th>
                  {stateVaries ? <th scope="col">State</th> : null}
                  {addedVaries ? <th scope="col">Added</th> : null}
                </tr>
              </thead>
              <tbody>
                {ideas.map((idea) => (
                  <tr key={idea.id}>
                    <td className="sh-stack-lead">
                      <span className="sh-cell-post__text">
                        <span className="sh-cell-post__name">{idea.title}</span>
                        {detailOf(idea.detail) ? <span className="sh-subtle">{detailOf(idea.detail)}</span> : null}
                      </span>
                    </td>
                    <td data-label={(summary.scoreLabel ?? 'Score').toLowerCase()}>
                      <span className="sh-vs">
                        <span className="sh-score">{idea.score == null ? '—' : idea.score.toFixed(idea.score >= 10 ? 0 : 2)}</span>
                        {idea.score != null ? <span className="sh-bar" aria-hidden="true"><span style={{ width: `${Math.max(4, (idea.score / top) * 100)}%` }} /></span> : null}
                      </span>
                    </td>
                    {stateVaries ? (
                      <td>
                        <span className="sh-chip">{IDEA_STATE_LABEL[idea.state]}</span>
                        {idea.hasContent && idea.versionCount > 1 ? <span className="sh-subtle"> · {idea.versionCount} versions</span> : null}
                      </td>
                    ) : null}
                    {addedVaries ? <td className="sh-nowrap sh-muted" data-prefix="Added">{addedOf(idea)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
