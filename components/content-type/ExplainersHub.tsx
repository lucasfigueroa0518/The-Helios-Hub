'use client';

import type { ComponentProps } from 'react';

import { explainerGenerate } from '@/components/content-type/TypeControls';
import { TypeHub } from '@/components/content-type/TypeHub';

/**
 * The Explainers page: the shared type page with Make it on each topic (POST /api/explainers/topics/:id/generate).
 * The make function is built on the client side (a server page can't pass a function into a client component).
 */
export function ExplainersHub(props: Omit<ComponentProps<typeof TypeHub>, 'make' | 'generate'>) {
  return <TypeHub {...props} make={explainerGenerate} generate={explainerGenerate} />;
}
