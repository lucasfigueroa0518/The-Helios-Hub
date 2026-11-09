import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { LiveToggle, PostingSettings, SettingsButton } from '@/components/content-type/TypeControls';
import { TYPE_PARTS } from '@/components/content-type/type-parts';
import { GenerationProgress } from '@/components/content-type/GenerationProgress';
import { RunProgressProvider } from '@/components/content-type/run-progress';
import { TypeHub } from '@/components/content-type/TypeHub';
import { LoadError } from '@/components/social-hub/LoadError';
import { readPosting } from '@/lib/content-type/posting';
import { TYPE_CONFIG, type PageVertical } from '@/lib/content-type/config';
import { typeHubModel } from '@/lib/content-type/model';
import { loadForPage } from '@/lib/social-hub/live';
import { getSession } from '@/lib/session';

import '@/app/reels/reels.css';
import '@/app/explainers/explainers.css';
import '@/app/social-hub.css';
import '@/app/social/(hub)/hub-content.css';
import './type-hub.css';

/**
 * A content type's page (Carousels, Stories, Explainers, Last Few Days, AI Events, Field Notes, AI Drama) in the Text on
 * Screen format: title and the Live switch up top, a row of days, that day's
 * posts, and the bench. The generate buttons, Live and settings write, so they
 * are built here, outside the read-only hub code.
 */
export async function ContentTypePage({ vertical, top, openSettings = false }: { vertical: PageVertical; top?: ReactNode; openSettings?: boolean }) {
  const session = await getSession();
  if (!session) redirect('/');
  const parts = TYPE_PARTS[vertical];
  const config = TYPE_CONFIG[vertical];
  // Independent reads: run them together rather than one after another.
  const [loaded, live, sectionData] = await Promise.all([
    loadForPage(session.email),
    readPosting(vertical).then((p) => p.live).catch(() => false),
    parts.load?.(),
  ]);
  if ('error' in loaded) return <div className="rh"><div className="rh__inner"><LoadError message={loaded.error} /></div></div>;

  const model = typeHubModel(loaded, vertical, new Date());

  const Hub = parts.hub ?? TypeHub;
  return (
    <RunProgressProvider type={vertical}>
      {top}
      <Hub
        model={model}
        title={config.title}
        headerActions={
          <>
            {parts.actions(loaded)}
            <SettingsButton defaultOpen={openSettings}>
              <PostingSettings type={vertical} />
              {parts.settingsSection?.(sectionData)}
            </SettingsButton>
            <LiveToggle type={vertical} initial={live} />
          </>
        }
        progress={<GenerationProgress />}
        benchNote={config.benchNote ?? undefined}
      />
    </RunProgressProvider>
  );
}
