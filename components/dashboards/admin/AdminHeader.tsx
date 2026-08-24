'use client';

import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import type { ReactNode } from 'react';

import { SegmentedNav } from '@/components/hub-shell/SegmentedNav';

const TABS = [
  { id: 'projects', label: 'Projects', href: '/dashboards' },
  { id: 'tokens', label: 'Tokens', href: '/dashboards/tokens' },
] as const;

function tabIdFromPath(pathname: string) {
  if (pathname.startsWith('/dashboards/tokens')) return 'tokens';
  return 'projects';
}

export default function AdminHeader({
  email,
  children,
}: {
  email: string;
  children: ReactNode;
}) {
  const pathname = usePathname() || '/dashboards';

  return (
    <div className="hub-shell">
      <nav className="hub-nav-row" aria-label="Dashboards sections">
        <SegmentedNav
          tabs={TABS}
          activeId={tabIdFromPath(pathname)}
          ariaLabel="Dashboards sections"
        />
      </nav>
      <main className="app-shell">
        <section className="card dashboards-admin">
          <div className="card__header">
            <div>
              <div className="card__title">Client Dashboards</div>
              <div className="card__subtitle">{email}</div>
            </div>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void signOut({ callbackUrl: '/' })}
            >
              Sign out
            </button>
          </div>
          <div className="card__body">{children}</div>
        </section>
      </main>
    </div>
  );
}
