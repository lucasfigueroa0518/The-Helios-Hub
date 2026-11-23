'use client';

import type { ComponentProps } from 'react';

import { TypeHub } from '@/components/content-type/TypeHub';
import { TipNotes } from '@/components/field-notes/TipNotes';
import type { HubPost } from '@/lib/social-hub/types';

/** A Field Notes post's tips under its slides, through the standard `postExtras` slot (UI-REWORK-CONTRACT C5). */
export const fieldNotesPostExtras = (post: HubPost) => (post.tipNotes?.length ? <TipNotes notes={post.tipNotes} /> : null);

/** The Field Notes page with its tip notes and nothing that writes: the fixture preview's mirror (no Make it). */
export function FieldNotesReadOnlyHub(props: Omit<ComponentProps<typeof TypeHub>, 'postExtras'>) {
  return <TypeHub {...props} postExtras={fieldNotesPostExtras} />;
}
