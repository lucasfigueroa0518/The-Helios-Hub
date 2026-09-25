/**
 * Dry-run every source adapter. No Jev, no Claude, no database writes.
 *
 *   npm run reels:probe            # what each source returns tonight
 *   npm run reels:probe -- --full  # also follow one pointer per source
 *
 * This is the cheap validation pass: it proves the feed URLs, the parsers, and
 * the full-text rule before a paid run touches anything. A source that returns
 * zero items here will return zero items at 1 AM.
 */
import fs from 'node:fs';
import path from 'node:path';

function loadLocalEnvironment(): void {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
loadLocalEnvironment();

const FOLLOW = process.argv.includes('--full');
const LOOKBACK_HOURS = 24;

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width);
}

async function main(): Promise<void> {
  const { ADAPTERS } = await import('@/lib/reels/adapters');
  const { A4_LISTS, A4_LIST_OF_LISTS, extractSection, parseListEntries } = await import(
    '@/lib/reels/adapters/awesome-lists'
  );
  const { FULL_TEXT_MIN_CHARS, COMPLETE_TEXT_MIN_CHARS } = await import('@/lib/reels/config');
  const { parsePage } = await import('@/lib/reels/net/html');
  const { fetchText } = await import('@/lib/reels/net/http');
  const { closeDbPool } = await import('@/lib/db');

  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3600_000);

  console.log(`Trial Reels adapter probe — ${LOOKBACK_HOURS}h window, no paid calls\n`);
  console.log(`${pad('SOURCE', 30)} ${pad('TYPE', 5)} ${pad('ITEMS', 6)} NOTES`);
  console.log('-'.repeat(96));

  let totalItems = 0;
  const failures: string[] = [];

  for (const adapter of ADAPTERS) {
    // A4 needs tonight's pool and the Jev editor; B6 is a paid Claude call.
    // Both are covered separately below rather than skipped silently.
    if (adapter.phase === 'derived') continue;

    try {
      const items = await adapter.fetchItems({
        since,
        now,
        runId: 'probe',
        jev: {
          callCount: 0,
          ask: async () => {
            throw new Error('probe must not call Jev');
          },
        },
      });

      totalItems += items.length;
      const pointers = items.filter((item) => !item.textIsComplete).length;
      const thin = items.filter(
        (item) => item.textIsComplete && item.body.trim().length < COMPLETE_TEXT_MIN_CHARS,
      ).length;

      const notes = [
        pointers > 0 ? `${pointers} need a fetch` : 'full text inline',
        thin > 0 ? `${thin} below the complete-text floor` : null,
      ].filter(Boolean);

      console.log(
        `${pad(adapter.name, 30)} ${pad(adapter.type, 5)} ${pad(String(items.length), 6)} ${notes.join(', ')}`,
      );

      for (const item of items.slice(0, 2)) {
        console.log(`${' '.repeat(43)}· ${item.headline.slice(0, 74)}`);
      }

      if (FOLLOW && pointers > 0) {
        const pointer = items.find((item) => !item.textIsComplete);
        const target = pointer?.destinationUrl ?? pointer?.canonicalUrl;
        if (target) {
          try {
            const page = parsePage(await fetchText(target));
            const verdict = page.paywalled
              ? 'PAYWALLED — would be skipped'
              : page.text.length < FULL_TEXT_MIN_CHARS
                ? `${page.text.length} chars — under the floor, would be skipped`
                : `${page.text.length} chars — keeps`;
            console.log(`${' '.repeat(43)}  follow: ${verdict}`);
          } catch (error) {
            console.log(
              `${' '.repeat(43)}  follow: FETCH FAILED — ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${adapter.name}: ${message}`);
      console.log(`${pad(adapter.name, 30)} ${pad(adapter.type, 5)} ${pad('—', 6)} FAILED: ${message}`);
    }
  }

  // A4: parse the lists without the editor, so a broken list URL still shows.
  console.log('-'.repeat(96));
  for (const list of A4_LISTS) {
    try {
      const entries = parseListEntries(await fetchText(list.url, { accept: 'text/plain, */*' }));
      const repos = entries.filter((entry) => entry.repoFullName).length;
      console.log(
        `${pad(list.listId, 30)} ${pad('A4', 5)} ${pad(String(entries.length), 6)} ${repos} GitHub repos for the catalog`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${list.listId}: ${message}`);
      console.log(`${pad(list.listId, 30)} ${pad('A4', 5)} ${pad('—', 6)} FAILED: ${message}`);
    }
  }

  try {
    const markdown = await fetchText(A4_LIST_OF_LISTS.url, { accept: 'text/plain, */*' });
    const discovered = parseListEntries(
      extractSection(markdown, A4_LIST_OF_LISTS.section),
    ).filter((entry) => entry.repoFullName);
    console.log(
      `${pad('list-of-lists (AI section)', 30)} ${pad('A4', 5)} ${pad(String(discovered.length), 6)} more lists to expand, a few per night`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`list-of-lists: ${message}`);
    console.log(`${pad('list-of-lists (AI section)', 30)} ${pad('A4', 5)} ${pad('—', 6)} FAILED: ${message}`);
  }

  console.log('-'.repeat(96));
  console.log(`${totalItems} items across the primary sources.`);
  console.log('A4 picks its entries with Jev at run time; B6 is a Claude call. Neither ran here.');

  if (failures.length > 0) {
    console.log(`\n${failures.length} source(s) failed:`);
    for (const failure of failures) console.log(`  - ${failure}`);
    console.log('\nA failing source does not stop a run: the night continues and the page reports it.');
  }

  await closeDbPool().catch(() => undefined);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
