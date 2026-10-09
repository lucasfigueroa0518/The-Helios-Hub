import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SettingsForm } from '@/app/explainers/settings/settings-form';
import {
  AddTopicsButton,
  CarouselRunButton,
  LiveToggle,
  PostingSettings,
  SettingsButton,
  StoriesGenerate,
} from '@/components/content-type/TypeControls';
import { ExplainersHub } from '@/components/content-type/ExplainersHub';
import { GenerationProgress } from '@/components/content-type/GenerationProgress';
import { TypeHub } from '@/components/content-type/TypeHub';
import { LoadError } from '@/components/social-hub/LoadError';
import { readPosting } from '@/lib/content-type/posting';
import { typeHubModel } from '@/lib/content-type/model';
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

const TITLE: Record<Exclude<Vertical, 'reels'>, string> = { carousels: 'Carousels', stories: 'Stories', explainers: 'Explainers' };
const BENCH_NOTE: Record<Exclude<Vertical, 'reels'>, string> = {
  carousels: 'Stories the 3:00 AM run shortlisted, best first. The top two become carousels.',
  stories: 'Ideas drawn from the other pools. A set is built for each series that is due.',
  explainers: 'Topics waiting to be rendered, best score first. Generate renders one reel.',
};

/**
 * A content type's page (Carousels, Stories, Explainers) in the Text on
 * Screen format: title and the Live switch up top, a row of days, that day's
 * posts, and the bench. The generate buttons, Live and settings write, so they
 * are built here, outside the read-only hub code.
 */
export async function ContentTypePage({ vertical }: { vertical: Exclude<Vertical, 'reels'> }) {
  const session = await getSession();
  if (!session) redirect('/');
  const loaded = await loadForPage(session.email);
  if ('error' in loaded) return <div className="rh"><div className="rh__inner"><LoadError message={loaded.error} /></div></div>;

  const model = typeHubModel(loaded, vertical, new Date());
  const live = await readPosting(vertical).then((p) => p.live).catch(() => false);

  let generate: ReactNode;
  let settings: ReactNode;
  if (vertical === 'carousels') {
    generate = <CarouselRunButton />;
    settings = <PostingSettings type="carousels" />;
  } else if (vertical === 'stories') {
    generate = <StoriesGenerate />;
    settings = <PostingSettings type="stories" />;
  } else {
    generate = <AddTopicsButton />;
    const view = await explainersDb().then(loadSettingsView).catch((error) => ({ error: message(error) }));
    settings = (
      <>
        <PostingSettings type="explainers" />
        {'error' in view ? <p className="rh-empty">Could not load settings: {view.error}</p> : <><h3 className="rh-rest__title">Rendering</h3><SettingsForm initial={view.settings} hide={['auto_render', 'daily_render_cap']} /></>}
      </>
    );
  }

  const Hub = vertical === 'explainers' ? ExplainersHub : TypeHub;
  return (
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
      progress={<GenerationProgress type={vertical} />}
      benchNote={BENCH_NOTE[vertical]}
    />
  );
}
