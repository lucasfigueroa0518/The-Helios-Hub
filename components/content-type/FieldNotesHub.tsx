'use client';

import type { ComponentProps } from 'react';

import { fieldNotesMake } from '@/components/content-type/TypeControls';
import { TypeHub } from '@/components/content-type/TypeHub';

/**
 * The Field Notes page: the shared type page with Make it on each tip (POST /api/field-notes/tips/:id/make), the same
 * shape as Explainers' (pool UI contract §5). The make function is built on the client side.
 */
export function FieldNotesHub(props: Omit<ComponentProps<typeof TypeHub>, 'make' | 'generate'>) {
  return <TypeHub {...props} make={fieldNotesMake} generate={fieldNotesMake} />;
}
