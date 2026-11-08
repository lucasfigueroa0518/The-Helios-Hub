'use client';

import type { ComponentProps } from 'react';

import { DramaMakeIt, dramaGenerate } from '@/components/content-type/TypeControls';
import { TypeHub } from '@/components/content-type/TypeHub';

/**
 * The AI Drama Reels page: the shared type page (TypeHub) with a Make it button on each bench pitch, as
 * Explainers have Generate (ExplainersHub). The button is a function, so it is built on the client side.
 */
export function ReelAiDramaHub(props: Omit<ComponentProps<typeof TypeHub>, 'benchAction' | 'generate'>) {
  return <TypeHub {...props} generate={dramaGenerate} benchAction={(item) => <DramaMakeIt ideaId={item.idea.id} title={item.idea.title} />} />;
}
