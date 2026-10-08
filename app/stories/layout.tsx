import type { ReactNode } from 'react';

import { StoriesNav } from '@/app/stories/stories-nav';

import './stories.css';

export default function StoriesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="sh-shell">
      <StoriesNav />
      {children}
    </div>
  );
}
