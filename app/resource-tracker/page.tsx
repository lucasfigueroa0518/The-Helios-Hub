import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { HubLoadingSpinner } from '@/app/hub/hub-loading';
import { ResourceTracker } from '@/app/resource-tracker/resource-tracker';
import { getSession } from '@/lib/session';

export default async function ResourceTrackerPage() {
  const session = await getSession();
  if (!session) redirect('/');
  return (
    <Suspense fallback={<HubLoadingSpinner />}>
      <ResourceTracker />
    </Suspense>
  );
}
