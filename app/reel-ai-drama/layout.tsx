import type { ReactNode } from 'react';

import '@/app/reels/reels.css';

/** Styles only (the Explainers layout pattern): the page is a hub content-type page; /reel-ai-drama/lab keeps its own styles. */
export default function ReelAiDramaLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
