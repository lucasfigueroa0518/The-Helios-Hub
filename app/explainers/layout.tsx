import type { ReactNode } from 'react';

import { ExplainersNav } from '@/app/explainers/explainers-nav';

import '@/app/reels/reels.css';
import './explainers.css';

export default function ExplainersLayout({ children }: { children: ReactNode }) {
  return (
    <div className="rh-shell">
      <ExplainersNav />
      {children}
    </div>
  );
}
