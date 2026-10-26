/**
 * Real Case Reels: list seed topics, or search ONE topic for stories (live Sonnet + web search + Jev).
 *
 *   npx tsx scripts/real_case_scout.ts --list
 *   npx tsx scripts/real_case_scout.ts --topic <explainers topic id> --yes
 *   npx tsx scripts/real_case_scout.ts --recheck <story id,…>   (re-run the evaluation; Jev only)
 *   npx tsx scripts/real_case_scout.ts --make <story id>        (queue a render for the worker)
 *
 * `--list` spends nothing. A search spends real money (an estimate of $0.30–0.70 a topic: up to 8 searches at
 * $0.01, up to 10 fetched pages re-read by Sonnet 5.5 as the turn goes on, and a few Jev calls), so it runs only with `--yes`, and
 * only when Lucas has said go (CLAUDE.md, the ~$1.50 rule). Uses the Explainer Reels database
 * connection (`explainersDb()`), reading explainers.topics and writing only real_case.*.
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { ensureRealCaseSchema } = await import('@/lib/real-case/schema');
  const { pickSeedTopics } = await import('@/lib/real-case/repository');
  const { loadRealCaseSettings } = await import('@/lib/real-case/settings');

  const db = await explainersDb();
  await ensureRealCaseSchema(db);

  if (args.includes('--list')) {
    const settings = await loadRealCaseSettings(db);
    const seeds = await pickSeedTopics(db, { limit: 50, cooldownDays: settings.scout_cooldown_days });
    for (const s of seeds) console.log(`${s.id}  ${s.weighted_score ?? '—'}  [${s.status}]  ${s.title}`);
    console.log(`${seeds.length} topics can be searched.`);
    return;
  }

  const mk = args.indexOf('--make');
  if (mk >= 0) {
    // Queue one render of a pooled story for the Real Case worker (the lab's Make reel, from the shell).
    const { requestStoryRender } = await import('@/lib/real-case/jobs');
    const { loadRealCaseSettings } = await import('@/lib/real-case/settings');
    console.log(JSON.stringify(await requestStoryRender(db, { storyId: args[mk + 1], trigger: 'click', settings: await loadRealCaseSettings(db) })));
    return;
  }

  const re = args.indexOf('--recheck');
  if (re >= 0) {
    // Re-run the evaluation of stories already found (comma-separated ids): Jev's calls only, no search.
    const { recheckStories } = await import('@/lib/real-case/cycle');
    const { liveJevTransport } = await import('@/lib/reels/jev/client');
    console.log(JSON.stringify(await recheckStories({ db, jevTransport: liveJevTransport }, args[re + 1].split(',')), null, 2));
    return;
  }

  const at = args.indexOf('--topic');
  const topicId = at >= 0 ? args[at + 1] : undefined;
  if (!topicId) throw new Error('Pass --list, or --topic <id> --yes.');
  if (!args.includes('--yes')) throw new Error('A search spends real money. Add --yes once Lucas has approved it.');

  const { findStoriesForTopic } = await import('@/lib/real-case/cycle');
  const { anthropicStoryScout } = await import('@/lib/real-case/scout');
  const { anthropic } = await import('@/lib/anthropic');
  const { liveJevTransport } = await import('@/lib/reels/jev/client');

  const result = await findStoriesForTopic({ db, scout: anthropicStoryScout(anthropic), jevTransport: liveJevTransport }, topicId);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
