import type { ReactNode } from 'react';

import { SettingsForm } from '@/app/explainers/settings/settings-form';
import { RebuildPostButton } from '@/components/content-type/AiEventsPoolButtons';
import { SeedButton } from '@/components/content-type/SeedButton';
import { AiEventsRunButton, CarouselRunButton, LfdRunButton, StoriesGenerate } from '@/components/content-type/TypeControls';
import { FieldNotesRunButton } from '@/components/field-notes/FieldNotesRunButton';
import type { PageVertical } from '@/lib/content-type/config';
import { aiEventsRebuildRefusal } from '@/lib/content-type/model';
import { explainersDb } from '@/lib/explainers/connection';
import { loadSettingsView } from '@/lib/explainers/overview';
import type { LoadedPage } from '@/lib/social-hub/live';

/**
 * The parts of a content type's page that are components, not data: the buttons in the header and the one extra
 * section in the settings drawer (the data half is lib/content-type/config.ts). Every type gets the same page; this
 * is the only place a type adds to it. A type can add buttons and one settings section, and a panel above the bench
 * (the page's `top` slot); nothing else.
 */

export type TypeParts<D = undefined> = {
  /** Read once, alongside the page data, for the settings section. */
  load?: () => Promise<D>;
  /** The header buttons that make or seed content. */
  actions: (page: LoadedPage) => ReactNode;
  /** The one extra section under the common settings. */
  settingsSection?: (data: D) => ReactNode;
};

/** A registry entry with its data type erased; `defineParts` is the only way in, so a section always gets what its own loader returned. */
export type AnyParts = TypeParts<unknown>;

function defineParts<D>(parts: TypeParts<D>): AnyParts {
  return parts as unknown as AnyParts;
}

type RenderingView = { error: string } | Awaited<ReturnType<typeof loadSettingsView>>;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const TYPE_PARTS: Record<PageVertical, AnyParts> = {
  carousels: defineParts({ actions: () => <><CarouselRunButton /><SeedButton vertical="carousels" /></> }),
  stories: defineParts({ actions: () => <><StoriesGenerate /><SeedButton vertical="stories" /></> }),
  last_few_days: defineParts({ actions: () => <><LfdRunButton /><SeedButton vertical="last_few_days" /></> }),
  ai_events: defineParts({
    // Rebuild post re-renders the coming week's post from the pool; with none waiting there is nothing to rebuild.
    actions: (page) => (
      <>
        <AiEventsRunButton />
        <RebuildPostButton disabled={aiEventsRebuildRefusal(page)} />
      </>
    ),
  }),
  // Generate picks one tip and renders its carousel on the pool's photos; the click approves that run's capped spend.
  field_notes: defineParts({ actions: () => <><FieldNotesRunButton /><SeedButton vertical="field_notes" /></> }),
  explainers: defineParts<RenderingView>({
    load: () => explainersDb().then(loadSettingsView).catch((error: unknown) => ({ error: message(error) })),
    actions: () => <SeedButton vertical="explainers" />,
    settingsSection: (view) =>
      'error' in view ? (
        <p className="rh-empty">Could not load settings: {view.error}</p>
      ) : (
        <>
          <h3 className="rh-rest__title">Rendering</h3>
          <SettingsForm initial={view.settings} hide={['auto_render', 'daily_render_cap']} />
        </>
      ),
  }),
};
