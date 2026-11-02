'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';

import '@/app/reels/reels.css';
import '@/components/content-type/type-hub.css';

import { Drawer } from '@/app/reels/ui';
import { LfdSeedForm } from '@/components/content-type/LfdSeedForm';
import { ReelSeedForm } from '@/components/content-type/ReelSeedForm';
import { CarouselSeedForm, ExplainerSeedForm, StorySeedForm } from '@/components/content-type/TypeControls';
import { refreshHubPage } from '@/lib/content-type/refresh-client';
import { SEED_BUTTON, isSeedable, type SeedVertical } from '@/lib/content-type/seed-verticals';
import type { Vertical } from '@/lib/social-hub/types';

/** What a seed form tells the button when it is finished: close the drawer, show the note (if any), refresh the page. */
export type SeedFormProps = { done: (note?: string) => void };

/** Each pool's form. The record is exhaustive over SeedVertical, so a pool added to the seed list without a form will not compile. */
const FORMS: Record<SeedVertical, ComponentType<SeedFormProps>> = {
  reels: ReelSeedForm,
  carousels: CarouselSeedForm,
  last_few_days: LfdSeedForm,
  stories: StorySeedForm,
  explainers: ExplainerSeedForm,
};

/**
 * "Seed an idea": the one button every idea pool shows, with the same label, drawer, title and result note everywhere.
 * Only the form inside the drawer differs by type (what that type needs and what it costs). Nothing is made by a seed.
 * Renders nothing for a pool with no seed path (AI Events).
 */
export function SeedButton({ vertical }: { vertical: Vertical }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!isSeedable(vertical)) return null;
  const Form = FORMS[vertical];
  const done = (text?: string) => {
    setOpen(false);
    if (text) {
      setNote(text);
      void refreshHubPage(router);
    }
  };
  return (
    <>
      <span className="rh rh--scope">
        <button type="button" className="rh-btn" onClick={() => setOpen(true)}>
          <Plus size={15} /> {SEED_BUTTON.label}
        </button>
      </span>
      {mounted && (open || note)
        ? createPortal(
            <div className="rh rh--scope">
              {open ? (
                <Drawer label={SEED_BUTTON.title} onClose={() => setOpen(false)}>
                  <Form done={done} />
                </Drawer>
              ) : null}
              {note ? <p className="rh-toast" role="status">{note}</p> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
