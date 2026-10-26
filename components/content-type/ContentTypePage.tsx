import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SettingsForm } from '@/app/explainers/settings/settings-form';
import { RebuildPostButton } from '@/components/content-type/AiEventsPoolButtons';
import {
  AddTopicsButton,
  AiEventsRunButton,
  CarouselRunButton,
  CarouselSeedButton,
  LfdRunButton,
  LiveToggle,
  PostingSettings,
  SettingsButton,
  StoriesGenerate,
  StorySeedButton,
} from '@/components/content-type/TypeControls';
import { ExplainersHub } from '@/components/content-type/ExplainersHub';
import { LfdSeedButton } from '@/components/content-type/LfdSeedButton';
import { GenerationProgress } from '@/components/content-type/GenerationProgress';
import { RunProgressProvider } from '@/components/content-type/run-progress';
import { TypeHub } from '@/components/content-type/TypeHub';
import { LoadError } from '@/components/social-hub/LoadError';
import { readPosting } from '@/lib/content-type/posting';
import { aiEventsRebuildRefusal, typeHubModel } from '@/lib/content-type/model';
import { explainersDb } from '@/lib/explainers/connection';
import { loadSettingsView } from '@/lib/explainers/overview';
import { loadForPage } from '@/lib/social-hub/live';
import type { Vertical } from '@/lib/social-hub/types';
import { verticalInfo } from '@/lib/social-hub/verticals';
import { getSession } from '@/lib/session';

import '@/app/reels/reels.css';
import '@/app/explainers/explainers.css';
import '@/app/social-hub.css';
import '@/app/social/(hub)/hub-content.css';
import './type-hub.css';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The types this page draws (Text on Screen has its own app page). */
type PageVertical = Exclude<Vertical, 'reels'>;

const TITLE: Record<PageVertical, string> = { carousels: 'Carousels', stories: 'Stories', explainers: 'Explainers', last_few_days: 'Last Few Days', ai_events: 'AI Events This Week' };
const BENCH_NOTE: Record<PageVertical, string> = {
  last_few_days: 'The latest run’s queue: the stories in its post, the ones it dropped and why, and what was next in line. Major headlines lead; Text on Screen ideas fill the rest.',
  carousels: 'Stories the 3:00 AM run shortlisted, best first. The top two become carousels. Hold and drag any story to move it.',
  stories: 'Ideas drawn from the other pools. A set is built for each series that is due. Pick a series, then hold and drag an idea to move it.',
  explainers: 'Topics waiting to be rendered, best score first. Generate renders one reel. Hold and drag any topic to move it.',
  ai_events: 'The week’s ranked events, city by city: the top 3 per city go into the carousel. Gated and excluded events stay listed with the reason. Open a row to see where its score comes from.',
};

/**
 * A content type's page (Carousels, Stories, Explainers, Last Few Days, AI Events) in the Text on
 * Screen format: title and the Live switch up top, a row of days, that day's
 * posts, and the bench. The generate buttons, Live and settings write, so they
 * are built here, outside the read-only hub code.
 */
export async function ContentTypePage({ vertical }: { vertical: PageVertical }) {
  const session = await getSession();
  if (!session) redirect('/');
  // Independent reads: run them together rather than one after another.
  const [loaded, live, explainersView] = await Promise.all([
    loadForPage(session.email),
    readPosting(vertical).then((p) => p.live).catch(() => false),
    vertical === 'explainers'
      ? explainersDb().then(loadSettingsView).catch((error) => ({ error: message(error) }))
      : null,
  ]);
  if ('error' in loaded) return <div className="rh"><div className="rh__inner"><LoadError message={loaded.error} /></div></div>;

  const model = typeHubModel(loaded, vertical, new Date());

  let generate: ReactNode;
  let settings: ReactNode;
  if (vertical === 'carousels') {
    generate = <><CarouselRunButton /><CarouselSeedButton /></>;
    settings = <PostingSettings type="carousels" />;
  } else if (vertical === 'stories') {
    generate = <><StoriesGenerate /><StorySeedButton /></>;
    settings = <PostingSettings type="stories" />;
  } else if (vertical === 'last_few_days') {
    generate = <><LfdRunButton /><LfdSeedButton /></>;
    settings = <PostingSettings type="last_few_days" />;
  } else if (vertical === 'ai_events') {
    // Rebuild post re-renders the coming week's post from the pool; with none waiting there is nothing to rebuild.
    generate = (
      <>
        <AiEventsRunButton />
        <RebuildPostButton disabled={aiEventsRebuildRefusal(loaded)} />
      </>
    );
    settings = <PostingSettings type="ai_events" />;
  } else {
    generate = <AddTopicsButton />;
    const view = explainersView!;
    settings = (
      <>
        <PostingSettings type="explainers" />
        {'error' in view ? <p className="rh-empty">Could not load settings: {view.error}</p> : <><h3 className="rh-rest__title">Rendering</h3><SettingsForm initial={view.settings} hide={['auto_render', 'daily_render_cap']} /></>}
      </>
    );
  }

  const Hub = vertical === 'explainers' ? ExplainersHub : TypeHub;
  return (
    <RunProgressProvider type={vertical}>
      <Hub
        model={model}
        title={TITLE[vertical]}
        headerActions={
          <>
            {generate}
            <SettingsButton>{settings}</SettingsButton>
            <LiveToggle type={vertical} initial={live} />
          </>
        }
        progress={<GenerationProgress />}
        benchNote={BENCH_NOTE[vertical]}
      />
    </RunProgressProvider>
  );
}
