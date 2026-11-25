'use client';

import type { ComponentProps } from 'react';

import { dramaGenerate } from '@/components/content-type/TypeControls';
import { TypeHub } from '@/components/content-type/TypeHub';

/**
 * The AI Drama Reels page: the shared type page with Make it on each pitch (POST /api/reel-ai-drama/make), as
 * Explainers have it (ExplainersHub). The make function is built on the client side.
 */
export function ReelAiDramaHub(props: Omit<ComponentProps<typeof TypeHub>, 'make' | 'generate'>) {
  return <TypeHub {...props} make={dramaGenerate} generate={dramaGenerate} />;
}
