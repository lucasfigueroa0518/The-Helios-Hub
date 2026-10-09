import type { ReactNode } from 'react';

import '@/app/reels/reels.css';
import './explainers.css';

/** Styles only: the Explainers page is a hub content-type page; /explainers/reels (the tagged review) keeps its own bar. */
export default function ExplainersLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
