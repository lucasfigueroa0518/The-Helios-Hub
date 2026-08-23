import { Suspense } from 'react';

import { loadWorkspace } from '@/app/trello/actions/loadWorkspace';
import { WorkspaceSkeleton } from '@/components/trello/shell/WorkspaceSkeleton';

import PageClient from './PageClient';

export const dynamic = 'force-dynamic';

export default function TrelloPage() {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <WorkspaceLoader />
    </Suspense>
  );
}

async function WorkspaceLoader() {
  const initial = await loadWorkspace();
  return <PageClient initial={initial} />;
}
