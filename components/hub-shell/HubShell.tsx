'use client';

import { Suspense, type ReactNode } from 'react';

import { HubSidebar } from '@/components/hub-shell/HubSidebar';

export function HubShell({ children, email }: { children: ReactNode; email: string }) {
  return (
    <div className="hub-app">
      <Suspense fallback={<aside className="hub-sidebar" aria-hidden="true" />}>
        <HubSidebar email={email} />
      </Suspense>
      <div className="hub-app__main">{children}</div>
    </div>
  );
}
