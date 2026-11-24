'use client';

import type { CSSProperties, ReactNode } from 'react';

import { BackToHub } from '@/components/content-type/BackToHub';
import { SeedButton } from '@/components/content-type/SeedButton';
import type { PoolPageData } from '@/components/content-type/pool/pool-data';
import { PoolScreen } from '@/components/content-type/pool/PoolScreen';
import type { PoolTab } from '@/components/content-type/pool/PoolTabs';
import { TYPE_CONFIG } from '@/lib/content-type/config';
import type { TypeHubModel } from '@/lib/content-type/model';
import type { GenerateIdea } from '@/lib/content-type/queue-client';
import type { HubIdea, HubPost } from '@/lib/social-hub/types';
import { verticalInfo } from '@/lib/social-hub/verticals';

/**
 * A content type's page: the title with the type's dot and its header buttons (Run and the type's own), then the
 * standard pool screen (components/content-type/pool/PoolScreen.tsx): the next three days, Ideas | Made | Settings,
 * the list and the idea and post panels. Every type draws the same screen; TYPE_CONFIG[type].pool is all that differs.
 *
 * Pure display: the writes (Run now, Make it, the Settings tab) arrive from outside the read-only hub code, as
 * `headerActions`, `make` and `settings`.
 */
export function TypeHub({ model, title, headerActions, progress, nav, make, generate, pool, readOnly = false, postExtras, ideaExtras, settings, initialTab, fullPostBase = '/social' }: {
  model: TypeHubModel;
  title: string;
  headerActions?: ReactNode;
  /** The "it's working" strip: built outside the read-only hub code because it polls. */
  progress?: ReactNode;
  nav?: ReactNode;
  /** Make it on one idea (Explainers, AI Drama, Field Notes), handed in by the type's client wrapper. */
  make?: GenerateIdea;
  /** Asked about when an idea with nothing made is pinned or dragged into today's slots. Defaults to `make`. */
  generate?: GenerateIdea;
  /** The dataset's pieces for the pool screen (pool-data.ts); missing: the model alone. */
  pool?: PoolPageData | null;
  /** The preview: no buttons that write. */
  readOnly?: boolean;
  /** A type's own controls in the post panel (Text on Screen). */
  postExtras?: (post: HubPost) => ReactNode;
  /** A type's own controls in the idea panel (Text on Screen). */
  ideaExtras?: (idea: HubIdea) => ReactNode;
  /** The pool's Settings tab (SettingsTab), built by the type page because it writes (D8, D9). None: Ideas | Made. */
  settings?: ReactNode;
  /** The pool tab shown first (`?tab=settings`). */
  initialTab?: PoolTab;
  /** Where "Open the full post" goes: the hub (live) or its preview mirror. */
  fullPostBase?: string;
}) {
  const info = verticalInfo(model.vertical);
  const config = TYPE_CONFIG[model.vertical];
  const seed = config.seedable && !readOnly
    ? ({ disabled }: { disabled: boolean }) => <SeedButton vertical={model.vertical} label={`Seed ${/^[aeiou]/i.test(config.pool.noun.one) ? 'an' : 'a'} ${config.pool.noun.one}`} disabled={disabled} buttonClass="pl-btn" />
    : undefined;
  return (
    <div className="rh">
      <div className="rh__inner">
        {nav}
        <header className="rh__head">
          <div>
            <BackToHub href={fullPostBase} />
            <h1 className="rh__title pl-title">
              <span className="pl-title__dot" style={{ '--pl-dot': `var(${info.colorVar}, #737373)` } as CSSProperties} aria-hidden="true" />
              {title} <span className="rh-beta">Beta</span>
            </h1>
          </div>
          <div className="rh__head-actions">{headerActions}</div>
        </header>
        <PoolScreen
          model={model}
          data={pool}
          readOnly={readOnly}
          make={make}
          generate={generate}
          seed={seed}
          postExtras={postExtras}
          ideaExtras={ideaExtras}
          progress={progress}
          settings={readOnly ? undefined : settings}
          initialTab={initialTab}
          fullPostBase={fullPostBase}
          fromPath={info.href}
        />
      </div>
    </div>
  );
}
