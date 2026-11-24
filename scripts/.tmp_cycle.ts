import { newAnthropic } from '@/lib/anthropic-client';
import { explainersDb } from '@/lib/explainers/connection';
import { anthropicIdeaModel } from '@/lib/explainers/ideas/generator';
import { runIdeaCycle } from '@/lib/explainers/ideas/cycle';
import { liveJevTransport } from '@/lib/reels/jev/client';
(async () => {
  const db = await explainersDb();
  const r = await runIdeaCycle({ db, ideaModel: anthropicIdeaModel(newAnthropic()), jevTransport: liveJevTransport, log: () => {} } as never);
  console.log('RESULT', JSON.stringify(r).slice(0, 600));
  process.exit(0);
})().catch((e) => { console.error('ERR', String(e?.message ?? e).slice(0, 300)); process.exit(1); });
