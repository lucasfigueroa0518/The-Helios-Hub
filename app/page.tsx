import { Suspense } from 'react';

import { HubHome } from '@/components/hub-home/HubHome';
import { LoginForm } from '@/app/login-form';
import { loadHome } from '@/lib/home/loadHome';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await getSession();

  if (session) {
    const data = await loadHome(session.userId, session.email);
    return <HubHome data={data} />;
  }

  return (
    <Suspense
      fallback={(
        <div className="login-page">
          <div className="login-page__atmosphere" aria-hidden="true" />
          <p className="login-page__loading">Loading…</p>
        </div>
      )}
    >
      <LoginForm />
    </Suspense>
  );
}
