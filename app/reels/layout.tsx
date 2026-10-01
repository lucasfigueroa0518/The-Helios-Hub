import type { ReactNode } from 'react';

import { ReelsNav } from '@/app/reels/reels-nav';

import './reels.css';

export default function ReelsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="rh-shell">
      <ReelsNav />
      {children}
    </div>
  );
}
