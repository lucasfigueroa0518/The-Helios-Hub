import NewProjectForm from '@/app/dashboards/(admin)/(main)/projects/new/NewProjectForm';
import { getAllClients } from '@/lib/dashboards/admin-data';

export const maxDuration = 60;

export default async function NewProjectPage() {
  const clients = await getAllClients();
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-fg-1">
          New project
        </h1>
        <p className="mt-1 text-sm font-light text-fg-3">
          The client dashboard stays current from GitHub on its own. Write the
          project description they should see under About this project. Linking a
          repo pulls activity and writes the first AI summary before you leave
          this page.
        </p>
      </div>
      <NewProjectForm clients={clients} />
    </div>
  );
}
