'use client';

import type { ComponentProps } from 'react';

import { ExplainerGenerate } from '@/components/content-type/TypeControls';
import { TypeHub } from '@/components/content-type/TypeHub';

/**
 * The Explainers page: the shared type page with a Generate button on each
 * bench idea. The button is a function, so it is built on the client side
 * (a server page can't pass a function into a client component).
 */
export function ExplainersHub(props: Omit<ComponentProps<typeof TypeHub>, 'benchAction'>) {
  return <TypeHub {...props} benchAction={(item) => <ExplainerGenerate ideaId={item.idea.id} title={item.idea.title} />} />;
}
