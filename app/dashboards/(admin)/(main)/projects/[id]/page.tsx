import { notFound } from 'next/navigation';

import BackgroundHealth from '@/app/dashboards/(admin)/(main)/projects/[id]/BackgroundHealth';
import DeleteProjectButton from '@/app/dashboards/(admin)/(main)/projects/[id]/DeleteProjectButton';
import EditProjectForm from '@/app/dashboards/(admin)/(main)/projects/[id]/EditProjectForm';
import { getAdminProject, getAllClients } from '@/lib/dashboards/admin-data';
import { latestUpdateGeneratedAt } from '@/lib/dashboards/repository';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, clients] = await Promise.all([
    getAdminProject(id),
    getAllClients(),
  ]);

  if (!project) notFound();

  const lastUpdateAt = await latestUpdateGeneratedAt(project.id);

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-fg-1">
          {project.name}
        </h1>
        <p className="mt-1 text-sm font-light text-fg-3">{project.client.name}</p>
      </div>
      <div className="space-y-6">
        <details className="dashboards-mobile-acc" open>
          <summary>Background updates</summary>
          <div className="space-y-4">
            <BackgroundHealth
              githubRepo={project.githubRepo}
              githubLastSyncAt={project.githubLastSyncAt}
              lastSyncError={project.lastSyncError}
              cronEnabled={project.cronEnabled}
              cronStatus={project.cronStatus}
              lastUpdateAt={lastUpdateAt}
            />
            <DeleteProjectButton projectId={project.id} projectName={project.name} />
          </div>
        </details>
        <EditProjectForm project={project} clients={clients} />
      </div>
    </div>
  );
}
