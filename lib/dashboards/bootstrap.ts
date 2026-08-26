import { generateUpdate } from '@/lib/dashboards/ai';
import { syncProject } from '@/lib/dashboards/github-sync';
import { setProjectCronStatus } from '@/lib/dashboards/repository';

/**
 * First-fill (or repo-change fill): sync GitHub then write a client summary
 * from the last 14 days of activity. Used at create time so the dashboard
 * is not empty when the admin lands on it.
 */
export async function bootstrapProjectFromGithub(projectId: string): Promise<void> {
  await setProjectCronStatus(projectId, 'RUNNING');
  try {
    await syncProject(projectId);
    await generateUpdate(projectId, { manual: true, generatedBy: 'WORKER' });
  } finally {
    await setProjectCronStatus(projectId, 'IDLE');
  }
}
