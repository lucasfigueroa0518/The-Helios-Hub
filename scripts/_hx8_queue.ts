import { explainersDb } from '@/lib/explainers/connection';
import { addTopics, requestRender } from '@/lib/explainers/repository';
import { loadSettings } from '@/lib/explainers/settings';
async function main() {
  const db = await explainersDb();
  const settings = { ...(await loadSettings(db)), per_reel_cap_usd: 22 };
  for (const title of ['Context Window', 'Embeddings']) {
    const [topic] = await addTopics(db, [{ title, origin: 'manual' }]);
    const r = await requestRender(db, { topicId: topic.id, trigger: 'click', settings, overrideCaps: true });
    console.log(JSON.stringify(r.ok ? { title, job: r.job.id, cap: r.job.spend_cap_usd } : { title, ...r }));
  }
  console.log('opener_voice', (settings as any).opener_voice, 'voice_id set', Boolean(settings.voice_id));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
