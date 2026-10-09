import Link from 'next/link';
import { ArrowRight, ImageIcon, Loader2, Music2, TriangleAlert } from 'lucide-react';

import { RunsRefresh } from '@/components/social-hub/content/RunsRefresh';
import { HubSettingsButton, RunTodayButton } from '@/components/social-hub/content/HubControls';
import { TodayStrip } from '@/components/social-hub/content/TodayStrip';
import { DataNotes } from '@/components/social-hub/DataNotes';
import { PageHead } from '@/components/social-hub/ui/PageHead';
import { TypeMark } from '@/components/social-hub/ui/marks';
import type { AllProgress } from '@/lib/content-type/progress';
import type { HubDataset } from '@/lib/social-hub/dataset';
import type { HubPost } from '@/lib/social-hub/types';
import { plural, relative, when } from '@/lib/social-hub/views/format';
import type { LibrariesModel } from '@/lib/social-hub/views/libraries';
import { offerer } from '@/lib/social-hub/views/offer';
import { poolStale, poolSummaries, type PoolSummary } from '@/lib/social-hub/views/pools';
import { allQuotaCandidates } from '@/lib/social-hub/views/day-rank';
import { contentModel } from '@/lib/social-hub/views/today';
import { typeHref, verticalInfo } from '@/lib/social-hub/verticals';

/**
 * Content (BRIEFS.md §1): the morning check. What needs a person, what's
 * going out today, then how full the tank is.
 */
export function ContentScreen({ dataset, base, now, libraries, progress, controls = true }: { dataset: HubDataset; base: string; now: Date; libraries: LibrariesModel; progress?: AllProgress; controls?: boolean }) {
  const runs: AllProgress = progress ?? { carousels: [], stories: [], explainers: [] };
  const inFlight = Object.values(runs).some((items) => items.length > 0);
  const m = contentModel(dataset, now);
  const o = offerer(dataset, now);
  // Every type's quota candidates: what holds today's slots, then the top of today's ranking (Promote / Demote applied).
  const today = allQuotaCandidates(dataset, now);
  // Rows nothing here can act on don't count as waiting on the person (critique 2026-10-08).
  const off = (p: HubPost) => o.offer(p).state.id === 'approval_off';
  const needs = m.needs.map((g) => ({ ...g, posts: g.posts.filter((p) => !off(p)) })).filter((g) => g.posts.length);
  const parked = m.needs.flatMap((g) => g.posts.filter(off));
  // The orange count is today's job: due today or tomorrow, or made and waiting. Later is said quietly.
  const countOf = (ids: string[]) => needs.filter((g) => ids.includes(g.id)).reduce((n, g) => n + g.posts.length, 0);
  const actNow = countOf(['today', 'tomorrow', 'unplaced']);
  const later = countOf(['later']);
  const todayLabel = new Date(`${m.today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '');

  return (
    <>
      <PageHead
        title="Today"
        aside={todayLabel}
        actions={controls ? <><HubSettingsButton /><RunTodayButton /></> : undefined}
        meta={
          <>
            <strong>{m.plan.filled}</strong> of {m.plan.slots} slots filled
            {' · '}
            {actNow ? <strong className="sh-needs-count">{actNow} {actNow === 1 ? 'needs' : 'need'} you</strong> : 'nothing needs you today'}
            {later ? <> · {later} later</> : null}
            {parked.length ? <> · {parked.length} can’t be approved here yet</> : null}
            {m.quota.left != null ? <> · {m.quota.left} of {m.quota.total} Instagram posts left today</> : null}
          </>
        }
      />
      <DataNotes dataset={dataset} />
      <RunsRefresh active={inFlight} />

      <section className="sh-section" aria-labelledby="today-strip">
        <div className="sh-section__head">
          <h2 className="sh-title" id="today-strip">Today’s Content<span className="sh-count">{today.length}</span></h2>
          <Link className="sh-out" href={`${base}/calendar`}>Calendar <ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
        {today.length === 0 ? (
          <div className="sh-panel sh-empty">
            <strong>No candidates for today yet</strong>
            {m.next ? <>Next post: {when(m.next.publishAt, now)}. </> : null}
            {controls ? 'Run now makes what today’s quotas still need.' : null}
          </div>
        ) : (
          <TodayStrip candidates={today} o={o} runs={runs} />
        )}
      </section>

      <section className="sh-section" aria-labelledby="pools">
        <div className="sh-section__head">
          <h2 className="sh-title" id="pools">Idea pools</h2>
        </div>
        <div className="sh-pools">
          {poolSummaries(dataset.ideas).map((p) => <PoolPanel key={p.vertical} pool={p} base={base} now={now} running={runs[p.vertical as keyof AllProgress] ?? []} />)}
        </div>
      </section>

      <section className="sh-section" aria-labelledby="libraries">
        <div className="sh-section__head">
          <h2 className="sh-title" id="libraries">Libraries</h2>
        </div>
        <div className="sh-panel">
          <ul className="sh-list">
            <LibraryRow
              href={`${base}/content/library/music`}
              icon={<Music2 size={18} aria-hidden="true" />}
              title="Music pool"
              line={libraries.music.present
                ? `${plural(libraries.music.songs.length, 'trending sound')} for Text on Screen${libraries.music.lastIngest?.finishedAt ? ` · refreshed ${relative(libraries.music.lastIngest.finishedAt, now)}` : ''}`
                : 'Not set up on this database yet.'}
            />
            <LibraryRow
              href={`${base}/content/library/photos`}
              icon={<ImageIcon size={18} aria-hidden="true" />}
              title="Photo bank"
              line={libraries.photos.present
                ? `${plural(libraries.photos.stored, 'photo')} · ${libraries.photos.reusable.toLocaleString('en-US')} reusable · +${libraries.photos.addedLast7d} this week`
                : 'Starts filling once photo capture is switched on.'}
            />
          </ul>
        </div>
      </section>
    </>
  );
}

function PoolPanel({ pool, base, now, running }: { pool: PoolSummary; base: string; now: Date; running: AllProgress[keyof AllProgress] }) {
  const info = verticalInfo(pool.vertical);
  return (
    <Link href={typeHref(pool.vertical, base)} className="sh-panel sh-pool">
      <span className="sh-pool__head">
        <TypeMark vertical={pool.vertical} />
        {running.length ? (
          <span className="sh-run-chip" role="status"><Loader2 size={13} className="sh-spin" aria-hidden="true" />{running.some((r) => r.state === 'running') ? 'Running' : 'Queued'}{running.length > 1 ? ` · ${running.length}` : ''}</span>
        ) : null}
        <ArrowRight size={14} aria-hidden="true" />
      </span>
      <span className="sh-pool__depth">
        <strong>{pool.open}</strong> {pool.open === 1 ? 'idea' : 'ideas'}
        {pool.ready ? <span className="sh-muted"> · {pool.ready} with content ready</span> : null}
      </span>
      {pool.next.length ? (
        <ol className="sh-pool__next" aria-label={`Next up for ${info.label}`}>
          {pool.next.map((idea) => <li key={idea.id} title={idea.title}>{idea.title}</li>)}
        </ol>
      ) : (
        <span className="sh-muted">The pool is empty.</span>
      )}
      {/* A pool that stopped refilling is a pipeline problem: say so in the failed tone, not quiet gray (critique 2026-10-08). */}
      {poolStale(pool.lastRefill, now) ? (
        <span className="sh-pool__stale"><TriangleAlert size={13} aria-hidden="true" />No refill in {relative(pool.lastRefill, now).replace(/ ago$/, '')}</span>
      ) : (
        <span className="sh-subtle">{pool.lastRefill ? `Refilled ${relative(pool.lastRefill, now)}` : 'No refill recorded'}</span>
      )}
    </Link>
  );
}

function LibraryRow({ href, icon, title, line }: { href: string; icon: React.ReactNode; title: string; line: string }) {
  return (
    <li className="sh-libitem">
      <Link href={href} className="sh-libitem__link">
        <span className="sh-libitem__icon">{icon}</span>
        <span className="sh-libitem__text">
          <span className="sh-libitem__title">{title}</span>
          <span className="sh-muted">{line}</span>
        </span>
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </li>
  );
}
