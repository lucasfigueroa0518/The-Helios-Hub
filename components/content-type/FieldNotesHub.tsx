'use client';

import type { ComponentProps } from 'react';

import { fieldNotesPostExtras } from '@/components/content-type/FieldNotesReadOnlyHub';
import { fieldNotesMake } from '@/components/content-type/TypeControls';
import { TypeHub } from '@/components/content-type/TypeHub';

/**
 * The Field Notes page: the shared type page with Make it on each tip (POST /api/field-notes/tips/:id/make), the same
 * shape as Explainers' (pool UI contract §5). The make function is built on the client side. A post's tips (tool name,
 * how to try it, tags) show under its slides through the standard `postExtras` slot (UI-REWORK-CONTRACT C5).
 */
export function FieldNotesHub(props: Omit<ComponentProps<typeof TypeHub>, 'make' | 'generate' | 'postExtras'>) {
  return (
    <TypeHub
      {...props}
      make={fieldNotesMake}
      generate={fieldNotesMake}
      postExtras={fieldNotesPostExtras}
    />
  );
}
