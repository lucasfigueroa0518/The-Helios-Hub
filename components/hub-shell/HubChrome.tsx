'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { HubShell } from '@/components/hub-shell/HubShell';

function isPublicClientDashboard(pathname: string) {
  return pathname.startsWith('/d/') || pathname.startsWith('/dashboards/d/');
}

export function HubChrome({ children, email }: { children: ReactNode; email: string }) {
  const pathname = usePathname() || '/';
  if (isPublicClientDashboard(pathname)) {
    return children;
  }
  return <HubShell email={email}>{children}</HubShell>;
}
