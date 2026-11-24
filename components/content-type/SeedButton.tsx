'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';

import { Drawer } from '@/app/reels/ui';
import { OneBoxSeedForm } from '@/components/content-type/OneBoxSeedForm';
import { SeedRequestCards, useOneBox } from '@/components/content-type/SeedRequestCards';
import { refreshHubPage } from '@/lib/content-type/refresh-client';
import { SEED_BUTTON, isSeedable, type SeedVertical } from '@/lib/content-type/seed-verticals';
import type { Vertical } from '@/lib/social-hub/types';

/** What a seed form tells the button when it is finished: close the drawer, show the note (if any), refresh the page. */
export type SeedFormProps = { done: (note?: string) => void };

/**
 * "Seed an idea": the one button every idea pool shows, with the same label, drawer, title and result note everywhere.
 * The form inside the drawer is the one box for every pool. Nothing is made by a seed.
 * Renders nothing for a pool with no seed path (AI Events).
 */
export function SeedButton({ vertical, label = SEED_BUTTON.label, disabled = false, buttonClass = 'rh-btn' }: {
  vertical: Vertical;
  /** The button's words where the pool names its items ("Seed a topic"); the drawer keeps its own title. */
  label?: string;
  /** Off, with the reason shown beside it by the page (the pool is at its cap). */
  disabled?: boolean;
  /** The page's own button class (the pool screen uses `pl-btn`). */
  buttonClass?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const oneBox = useOneBox(vertical, !isSeedable(vertical));
  if (!isSeedable(vertical)) return null;
  const done = (text?: string) => {
    setOpen(false);
    if (text) {
      setNote(text);
      oneBox.reload();
      void refreshHubPage(router);
    }
  };
  return (
    <>
      <SeedRequestCards cards={oneBox.cards} reload={oneBox.reload} />
      <span className="rh rh--scope">
        <button type="button" className={buttonClass} disabled={disabled} onClick={() => setOpen(true)}>
          <Plus size={15} /> {label}
        </button>
      </span>
      {mounted && (open || note)
        ? createPortal(
            <div className="rh rh--scope">
              {open ? (
                <Drawer label={SEED_BUTTON.title} onClose={() => setOpen(false)}>
                  <OneBoxSeedForm vertical={vertical} done={done} />
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
