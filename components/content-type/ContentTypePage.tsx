import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { LiveToggle, PostingSettings, SettingsButton } from '@/components/content-type/TypeControls';
import { TYPE_PARTS } from '@/components/content-type/type-parts';
import { GenerationProgress } from '@/components/content-type/GenerationProgress';
import { RunProgressProvider } from '@/components/content-type/run-progress';
import { TypeHub } from '@/components/content-type/TypeHub';
import { LoadError } from '@/components/social-hub/LoadError';
import { poolPageData } from '@/components/content-type/pool/pool-data';
import { costPerPost, readPosting } from '@/lib/content-type/posting';
import { TYPE_CONFIG, type PageVertical } from '@/lib/content-type/config';
import { typeHubModel } from '@/lib/content-type/model';
import { loadForPage } from '@/lib/social-hub/live';
import { getSession } from '@/lib/session';

import '@/app/reels/reels.css';
import '@/app/explainers/explainers.css';
import '@/app/social-hub.css';
import '@/app/social/(hub)/hub-content.css';
import './type-hub.css';
import './pool/pool.css';

/**
 * A content type's page (Carousels, Stories, Explainers, Last Few Days, AI Events, Field Notes, AI Drama): title and
 * the header controls (Run, Settings, Live) up top, then the standard pool screen (next three days, Ideas | Made,
 * the panels). The generate buttons, Live and settings write, so they are built here, outside the read-only hub code.
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

  // One `now` for the model and the pool screen, so the board and Up next agree.
  const now = new Date();
  const model = typeHubModel(loaded, vertical, now);
  const pool = poolPageData(loaded, vertical, now, costPerPost(loaded.posts, vertical, now));

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
        pool={pool}
      />
    </RunProgressProvider>
  );
}
