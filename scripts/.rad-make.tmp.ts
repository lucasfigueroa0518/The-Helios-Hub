// Temporary: queue one Reel AI Drama job for a pitch (a lab "Make" click). Delete after the test run.
import { requestJob } from '@/lib/reel-ai-drama/production/jobs';
import { loadSettings } from '@/lib/reel-ai-drama/settings';

void (async () => {
  const { explainersDb } = await import('@/lib/explainers/connection');
  const db = await explainersDb();
  const settings = await loadSettings(db);
  console.log(JSON.stringify(await requestJob(db, { pitchId: process.argv[2], trigger: 'click', settings })));
  process.exit(0);
})();
