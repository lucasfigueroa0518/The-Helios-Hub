/**
 * Live dry run of ingestion for chosen adapters (D-263). Fetches each feed,
 * applies the nightly cap, follows every article, and runs the ingest screen
 * through Jev, as the nightly run does; items already on file are counted
 * and skipped, as a repeat would be. Nothing is written: no
 * sources, no fingerprints, no watermarks. It reads reels.sources to report
 * how many items another source already brought in.
 *
 *   npx tsx scripts/reels/probe-sources.ts futurism guardian-ai
 *   npx tsx scripts/reels/probe-sources.ts --no-jev --hours 48 bbc-tech
 *
 * Jev costs about $0.0001 an item. No Claude calls.
 */
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { dbQuery } from '@/lib/db';
import { adapterById } from '@/lib/reels/adapters';
import { liveJevTransport } from '@/lib/reels/jev/client';
import { jevUsd, type JevRequest, type JevRunner } from '@/lib/reels/jev/runner';
import { canonicalizeUrl } from '@/lib/reels/net/http';
import { applyCap, capNewItems, resolveBody, screen } from '@/lib/reels/pipeline/ingest';
import { findFingerprints } from '@/lib/reels/repository';

class ProbeJev implements JevRunner {
  calls = 0;
  usd = 0;
  get callCount() {
    return this.calls;
  }
  async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
    const result = await liveJevTransport.systemOne(request.state, request.questions);
    this.calls += 1;
    this.usd += jevUsd(result.usage.input_tokens);
    return result;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useJev = !args.includes('--no-jev');
  const hoursAt = args.indexOf('--hours');
  const hours = hoursAt >= 0 ? Number(args[hoursAt + 1]) : 24;
  const ids = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--hours');
  const jev = new ProbeJev();
  const now = new Date();
  const since = new Date(now.getTime() - hours * 3600_000);
  let failures = 0;

  for (const id of ids) {
    const adapter = adapterById(id);
    if (!adapter) {
      console.log(JSON.stringify({ id, error: 'no such adapter' }));
      failures += 1;
      continue;
    }
    const started = Date.now();
    try {
      const items = await adapter.fetchItems({ since, now, runId: 'probe', jev });
      const capped = applyCap(adapter, items);
      // Same order as the nightly run: the article cap, then the new-item cap
      // for ranked lists (D-262), judged against what is already on file.
      const fingerprints = await findFingerprints(capped.kept.map((item) => canonicalizeUrl(item.canonicalUrl)));
      const onFile = (item: (typeof items)[number]) => fingerprints.has(canonicalizeUrl(item.canonicalUrl));
      const newCapped = capNewItems(adapter, capped.kept, onFile);
      const kept = newCapped.kept.filter((item) => !onFile(item));
      const overflow = capped.overflow + newCapped.overflow;
      const repeats = newCapped.kept.length - kept.length;
      const urls = kept.map((item) => canonicalizeUrl(item.canonicalUrl));
      const { rows } = await dbQuery<{ canonical_url: string; adapter_id: string }>(
        'SELECT canonical_url, adapter_id FROM reels.sources WHERE canonical_url = ANY($1)',
        [urls],
      );
      const known = new Map(rows.map((row) => [row.canonical_url, row.adapter_id]));
      const drops: Record<string, number> = {};
      const keptHeadlines: string[] = [];
      let bodyChars = 0;
      for (const item of kept) {
        const resolved = await resolveBody(item, { jev });
        const reason =
          resolved.dropReason ??
          (useJev
            ? await screen(item, resolved.body, { jev }, { runId: 'probe', runStartedAt: now, now })
            : null);
        if (reason) {
          drops[reason] = (drops[reason] ?? 0) + 1;
          continue;
        }
        bodyChars += resolved.body.length;
        keptHeadlines.push(item.headline.slice(0, 90));
      }
      const alreadyFrom = [...known.values()];
      console.log(
        JSON.stringify({
          id,
          hours,
          fetched: items.length,
          overCap: overflow,
          alreadyOnFile: repeats,
          kept: keptHeadlines.length,
          drops,
          meanBodyChars: keptHeadlines.length ? Math.round(bodyChars / keptHeadlines.length) : 0,
          alreadyIngestedBy: alreadyFrom,
          ms: Date.now() - started,
          headlines: keptHeadlines,
        }),
      );
      if (items.length > 0 && keptHeadlines.length === 0 && Object.keys(drops).every((r) => !['off_topic', 'junk'].includes(r))) {
        failures += 1;
      }
    } catch (error) {
      failures += 1;
      console.log(JSON.stringify({ id, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started }));
    }
  }
  console.log(JSON.stringify({ done: true, jevCalls: jev.calls, jevUsd: Number(jev.usd.toFixed(4)), failures }));
  process.exit(failures > 0 ? 1 : 0);
}

void main();
