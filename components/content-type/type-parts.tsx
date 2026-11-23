import Link from 'next/link';
import type { ReactNode } from 'react';

import { SettingsForm } from '@/app/explainers/settings/settings-form';
import { RebuildPostButton } from '@/components/content-type/AiEventsPoolButtons';
import { AiEventsRunButton, CarouselRunButton, DramaDevelopButton, IdeaCycleButton, LfdRunButton, StoriesGenerate } from '@/components/content-type/TypeControls';
import { ExplainersHub } from '@/components/content-type/ExplainersHub';
import { FieldNotesHub } from '@/components/content-type/FieldNotesHub';
import { ReelAiDramaHub } from '@/components/content-type/ReelAiDramaHub';
import { ReelAiDramaSettingsForm } from '@/components/content-type/ReelAiDramaSettingsForm';
import type { TypeHub } from '@/components/content-type/TypeHub';
import { FieldNotesRunButton } from '@/components/field-notes/FieldNotesRunButton';
import type { PageVertical } from '@/lib/content-type/config';
import { aiEventsRebuildRefusal } from '@/lib/content-type/model';
import { explainersDb } from '@/lib/explainers/connection';
import { loadSettingsView } from '@/lib/explainers/overview';
import { FIELD_NOTES_PHOTOS_HREF } from '@/lib/social-hub/links';
import type { LoadedPage } from '@/lib/social-hub/live';

/**
 * The parts of a content type's page that are components, not data: the buttons in the header and the one extra
 * section in the pool's Settings tab, its "This type only" block (settings standard D8; the data half is
 * lib/content-type/config.ts). Every type gets the same page; this is the only place a type adds to it. A type can add
 * buttons and one settings section; nothing else (no type has a panel above the pool any more: Field Notes' photos moved
 * to the Photo Bank, UI-REWORK-PLAN D1/D2). A type's own bits on a post or idea go through TypeHub's `postExtras` /
 * `ideaExtras`, in the type's `hub` wrapper.
 */

export type TypeParts<D = undefined> = {
  /** Read once, alongside the page data, for the settings section. */
  load?: () => Promise<D>;
  /** The header buttons that make content (Seed sits beside the pool's tabs, drawn by TypeHub). */
  actions: (page: LoadedPage) => ReactNode;
  /** The Settings tab's "This type only" block, only where a type truly can't share (the Explainers and AI Drama forms). */
  settingsSection?: (data: D) => ReactNode;
  /** A thin client wrapper of TypeHub that hands in the type's Make it (functions can't cross to the client). Default: TypeHub. */
  hub?: typeof TypeHub;
};

/** A registry entry with its data type erased; `defineParts` is the only way in, so a section always gets what its own loader returned. */
export type AnyParts = TypeParts<unknown>;

function defineParts<D>(parts: TypeParts<D>): AnyParts {
  return parts as unknown as AnyParts;
}

type RenderingView = { error: string } | Awaited<ReturnType<typeof loadSettingsView>>;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const TYPE_PARTS: Record<PageVertical, AnyParts> = {
  carousels: defineParts({ actions: () => <CarouselRunButton /> }),
  stories: defineParts({ actions: () => <StoriesGenerate /> }),
  last_few_days: defineParts({ actions: () => <LfdRunButton /> }),
  // SS-1: Trivia and Real or AI? generate on their own days; Real or AI? keeps its lab.
  ai_trivia: defineParts({ actions: () => <StoriesGenerate type="ai_trivia" /> }),
  real_or_ai: defineParts({ actions: () => <><StoriesGenerate type="real_or_ai" /><Link className="rh-btn" href="/real-or-ai/lab">Lab</Link></> }),
  ai_events: defineParts({
    // Rebuild post re-renders the coming week's post from the pool; with none waiting there is nothing to rebuild.
    actions: (page) => (
      <>
        <AiEventsRunButton />
        <RebuildPostButton disabled={aiEventsRebuildRefusal(page)} />
      </>
    ),
  }),
  // Generate picks the next tip and renders its carousel on the pool's photos; Make it on a row makes that tip. Each click approves that run's capped spend.
  // Photos opens the Photo Bank's Field Notes section, where the photos are uploaded and kept (UI-REWORK-PLAN D6).
  field_notes: defineParts({ actions: () => <><FieldNotesRunButton /><Link className="rh-btn" href={FIELD_NOTES_PHOTOS_HREF}>Photos</Link></>, hub: FieldNotesHub }),
  explainers: defineParts<RenderingView>({
    load: () => explainersDb().then(loadSettingsView).catch((error: unknown) => ({ error: message(error) })),
    actions: () => <IdeaCycleButton />,
    hub: ExplainersHub,
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
  // Develop queues one development session for the drama worker; the lab keeps the advanced view. Pitches have no seed path.
  reel_ai_drama: defineParts({
    actions: () => <><DramaDevelopButton /><Link className="rh-btn" href="/reel-ai-drama/lab">Lab</Link></>,
    settingsSection: () => (
      <>
        <h3 className="rh-rest__title">Rendering</h3>
        <ReelAiDramaSettingsForm />
      </>
    ),
    hub: ReelAiDramaHub,
  }),
};
