/**
 * Helios Social M1 — ingest preview. Fetches the real feeds (free, no AI)
 * and stops before Jev: prints feed health, window counts, code-filter
 * skips, neighbour pairs, and an ESTIMATE of the Jev calls and cost a real
 * selection run would make. Never calls Jev, Claude, or the database.
 *
 *   npx tsx scripts/social_ingest_preview.ts
 */
import { HELIOS_SOCIAL_FEEDS } from '@/lib/social/feeds';
import { JEV_INPUT_USD_PER_MTOK } from '@/lib/social/jev/client';
import * as DifferentStory from '@/lib/social/jev/questions/different-story.v1';
import * as SameEvent from '@/lib/social/jev/questions/same-event.v1';
import * as Scoring from '@/lib/social/jev/questions/story-scoring.v2';
import { applyCodeFilters } from '@/lib/social/ingest/select/code-filters';
import { THIN_BODY_CHARS } from '@/lib/social/ingest/select/enrich';
import { buildFeedHealth, fetchFeeds } from '@/lib/social/ingest/select/feed-health';
import { buildGroup, neighbourPairs } from '@/lib/social/ingest/select/group';
import { createFilePosted } from '@/lib/social/ingest/select/posted';
import { SHORTLIST_MAX } from '@/lib/social/ingest/select/rank';
import { inWindow, windowHours } from '@/lib/social/ingest/select/window';

/** ≈4 characters per token, the usual rough rule; real counts come from Jev usage. */
const tokensOf = (request: unknown) => Math.ceil(JSON.stringify(request).length / 4);

async function main() {
  const now = new Date();
  const articles = await fetchFeeds(HELIOS_SOCIAL_FEEDS);
  const hours = windowHours(now, false);
  const health = buildFeedHealth(HELIOS_SOCIAL_FEEDS, articles, now, hours);

  console.log(`\nFeed health (${health[0]?.day}, window ${hours}h):`);
  console.table(health.map(({ slug, fetched, inWindow: inW, flagged }) => ({ slug, fetched, inWindow: inW, flagged: flagged ? 'FLAG' : '' })));

  const fresh = articles.filter((a) => inWindow(a, now, hours));
  const { kept, skipped } = applyCodeFilters(fresh);
  console.log(`\nArticles: ${articles.length} fetched (48h), ${fresh.length} in ${hours}h window, ${skipped.length} code-filtered, ${kept.length} kept.`);
  for (const s of skipped) console.log(`  skip ${s.reason}: ${fresh.find((a) => a.sourceUrl === s.id)?.headline}`);

  // Same-event: one call per article that has neighbours.
  const pairs = neighbourPairs(kept);
  const askers = new Map<number, number[]>();
  for (const [i, j] of pairs) askers.set(i, [...(askers.get(i) ?? []), j]);
  let sameEventTokens = 0;
  for (const [i, js] of askers) {
    const neighbours = js.map((j) => kept[j]!);
    sameEventTokens += tokensOf({ state: SameEvent.buildState(kept[i]!, neighbours), questions: SameEvent.buildQuestions(neighbours.length) });
  }

  // Scoring: upper bound treats every kept article as its own group, and
  // assumes each thin body is replaced by a full page at the 6,000-char cap.
  const posted = await createFilePosted().recentHeadlines(now);
  const questions = Scoring.buildQuestions(posted);
  let scoringTokens = 0;
  for (const a of kept) {
    const g = buildGroup([a]);
    const body = a.body.length < THIN_BODY_CHARS ? 'x'.repeat(6000) : g.body;
    scoringTokens += tokensOf({ state: Scoring.buildState({ ...g, body }, posted), questions });
  }

  const sample = kept.slice(0, SHORTLIST_MAX).map((a) => buildGroup([a]));
  const differentTokens = sample.length > 1
    ? tokensOf({ state: DifferentStory.buildState(sample[0]!, sample.slice(1)), questions: DifferentStory.buildQuestions(sample.length - 1) })
    : 0;

  const thin = kept.filter((a) => a.body.length < THIN_BODY_CHARS).length;
  const calls = askers.size + kept.length + (sample.length > 1 ? 1 : 0);
  const tokens = sameEventTokens + scoringTokens + differentTokens;
  const usd = (tokens * JEV_INPUT_USD_PER_MTOK) / 1_000_000;

  console.log(`\nNeighbour pairs (code): ${pairs.length}, same-event calls: ${askers.size}`);
  console.log(`Scoring calls: ≤ ${kept.length} (fewer once duplicates merge); different-story: ${sample.length > 1 ? 1 : 0}`);
  console.log(`Thin bodies (< ${THIN_BODY_CHARS} chars) that would get a full-page fetch: ${thin} (free, no AI)`);
  console.log(`Posted headlines in lookback: ${posted.length}`);
  console.log(`\nESTIMATE (no Jev called): ≤ ${calls} Jev calls, ~${tokens.toLocaleString()} input tokens, ≈ $${usd.toFixed(4)}`);
  console.log('Upper bound: no merges, every thin body at the 6,000-char cap. A 48h widen would at most roughly double it.');
}

// Exit explicitly: a feed that hit the fetcher's hard timeout can leave its
// socket open and keep the process alive.
main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
