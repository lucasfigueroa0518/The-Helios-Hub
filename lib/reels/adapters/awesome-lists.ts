import { GithubRateLimitError, buildRepoItem } from '@/lib/reels/adapters/github';
import {
  A4_LISTS_EXPANDED_PER_NIGHT,
  A4_MIN_SCORE,
  A4_NIGHTLY_CEILING,
  A4_NIGHTLY_FLOOR,
  A4_SHORTLIST_SIZE,
  RANKED_REPEAT_DAYS,
} from '@/lib/reels/config';
import { A4_EDITOR } from '@/lib/reels/jev/questions/a4-editor';
import { excerpt } from '@/lib/reels/jev/state';
import { fetchText } from '@/lib/reels/net/http';
import {
  catalogMatchingHeadlines,
  catalogRotation,
  discoveredListsDue,
  listRunSources,
  markCatalogConsidered,
  markCatalogIngested,
  upsertCatalogEntries,
  type CatalogEntry,
} from '@/lib/reels/repository';
import type { Adapter, AdapterItem } from '@/lib/reels/types';

/** The three named lists (D-004, D-050). */
export const A4_LISTS = [
  { listId: 'awesome-llm', url: 'https://raw.githubusercontent.com/Hannibal046/Awesome-LLM/main/README.md' },
  { listId: 'awesome-mcp-servers', url: 'https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md' },
  { listId: 'awesome-selfhosted', url: 'https://raw.githubusercontent.com/awesome-selfhosted/awesome-selfhosted/master/README.md' },
] as const;

/**
 * The fourth A4 entry is a list *of* lists (D-004). Its rows are other awesome
 * lists, not tools, so ingesting them directly would put list READMEs in the
 * pool. Instead its AI section is expanded one level: each list it names gets
 * read and its own entries join the catalog. Delegated reading of D-004 —
 * confirm at the first review gate.
 */
export const A4_LIST_OF_LISTS = {
  url: 'https://raw.githubusercontent.com/brandonhimpfen/awesome-lists/main/README.md',
  section: /artificial intelligence/i,
};

/** Reserved catalog partition holding discovered lists rather than tools. */
export const DISCOVERED_LISTS_ID = '_lists';

export type ParsedEntry = {
  name: string;
  url: string;
  repoFullName: string | null;
  description: string | null;
};

/**
 * A list row, allowing for the emphasis these READMEs wrap links in and for
 * either a dash or a colon before the description:
 *   - [Name](url) - Description
 *   * **[Name](url):** Description
 */
const LIST_ROW =
  /^\s*[-*+]\s+[*_]{0,2}\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)[*_]{0,2}\s*(?:[-–—:]+[*_]{0,2}\s*(.*))?$/;

/** The slice of a README under one `##` heading. */
export function extractSection(markdown: string, heading: RegExp): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{2,3}\s/.test(line) && heading.test(line));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,3}\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

export function parseListEntries(markdown: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const seen = new Set<string>();
  let inCodeFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const match = line.match(LIST_ROW);
    if (!match) continue;

    const [, rawName, url, rawDescription] = match;
    const name = rawName.replace(/[*_`]/g, '').trim();
    // Table-of-contents rows point back into the same document.
    if (!name || url.startsWith('#') || seen.has(url)) continue;
    seen.add(url);

    const repo = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/#?]+)/i)?.[1] ?? null;

    entries.push({
      name,
      url,
      repoFullName: repo ? repo.replace(/\.git$/, '') : null,
      description: rawDescription?.replace(/[*_`]/g, '').trim() || null,
    });
  }

  return entries;
}

type Scored = { entry: CatalogEntry; score: number; newsPeg: boolean };

/**
 * A4 (SRC-A4 / D-066).
 *
 * The named lists change slowly, so waiting for new rows would keep this whole
 * source type out of the pool for weeks. Instead the lists are a standing
 * catalog, and each night Jev acts as the editor over a shortlist that code
 * builds: entries tonight's other headlines name, plus a rotation of entries we
 * have not looked at lately. A floor guarantees the type is always in the mix.
 */
export const awesomeLists: Adapter = {
  id: 'awesome-lists',
  name: 'Awesome lists',
  type: 'A4',
  bucket: 'A',
  kind: 'catalog',
  phase: 'derived',

  async fetchItems({ runId, signal, jev }) {
    await refreshCatalog(signal);

    const pegged = await catalogMatchingHeadlines(runId, Math.floor(A4_SHORTLIST_SIZE / 2));
    const peggedIds = new Set(pegged.map((entry) => entry.id));
    const rotation = (await catalogRotation(A4_SHORTLIST_SIZE, RANKED_REPEAT_DAYS)).filter(
      (entry) => !peggedIds.has(entry.id),
    );

    const shortlist = [...pegged, ...rotation].slice(0, A4_SHORTLIST_SIZE);
    if (shortlist.length === 0) return [];

    const tonight = (await listRunSources(runId))
      .filter((source) => source.drop_reason === null && source.source_type !== 'A4')
      .slice(0, 40)
      .map((source) => source.headline);

    const scored: Scored[] = [];
    for (const entry of shortlist) {
      const result = await jev.ask({
        component: 'a4-editor',
        state: {
          tonights_headlines: tonight,
          candidate: {
            name: entry.entry_name,
            untrusted_description: excerpt(entry.description ?? '', 400),
            from_list: entry.list_id,
          },
        },
        sets: [A4_EDITOR],
        questions: A4_EDITOR.questions,
        runId,
      });
      scored.push({
        entry,
        score: result.answers.worthTonight.score,
        newsPeg: peggedIds.has(entry.id),
      });
    }

    await markCatalogConsidered(shortlist.map((entry) => entry.id));

    scored.sort((a, b) => b.score - a.score);
    const passing = scored.filter((candidate) => candidate.score >= A4_MIN_SCORE);
    // The floor is what keeps A4 in consideration on a quiet night (D-066);
    // the ceiling keeps a busy night from spending the run on GitHub calls.
    const chosen = (passing.length >= A4_NIGHTLY_FLOOR
      ? passing
      : scored.slice(0, A4_NIGHTLY_FLOOR)
    ).slice(0, A4_NIGHTLY_CEILING);

    const items: AdapterItem[] = [];
    const ingested: string[] = [];
    const unbuildable: string[] = [];

    for (const candidate of chosen) {
      const item = await buildCatalogItem(candidate, signal);
      if (!item) {
        unbuildable.push(candidate.entry.entry_name);
        continue;
      }
      items.push(item);
      ingested.push(candidate.entry.id);
    }

    await markCatalogIngested(ingested);

    // A floor that can be missed without anyone noticing is not a floor. The
    // editor can legitimately find nothing worth raising, but picks that fail
    // to build are a fault and have to reach the run page (D-066).
    if (items.length < A4_NIGHTLY_FLOOR && unbuildable.length > 0) {
      throw new Error(
        `A4 floor of ${A4_NIGHTLY_FLOOR} not met: produced ${items.length} of ${chosen.length} picks. ` +
          `Could not build: ${unbuildable.join(', ')}.`,
      );
    }

    return items;
  },
};

async function refreshCatalog(signal?: AbortSignal): Promise<void> {
  for (const list of A4_LISTS) {
    await readListInto(list.listId, list.url, signal);
  }
  await refreshDiscoveredLists(signal);
}

async function readListInto(
  listId: string,
  url: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const markdown = await fetchText(url, { accept: 'text/plain, text/markdown, */*', signal });
    await upsertCatalogEntries(
      parseListEntries(markdown).map((entry) => ({
        listId,
        name: entry.name,
        url: entry.url,
        repoFullName: entry.repoFullName,
        description: entry.description,
      })),
    );
  } catch {
    // One unreachable list should not stop the editor from working with the
    // catalog it already has. The run page still reports what A4 produced.
  }
}

function rawReadmeUrl(repoFullName: string): string {
  // Default branch is unknown from the list alone; raw.githubusercontent
  // serves HEAD under either name, so try main and fall back to master.
  return `https://raw.githubusercontent.com/${repoFullName}/HEAD/README.md`;
}

/**
 * Read the list of lists, then expand a few of the lists it names. Expanding
 * all of them nightly would be dozens of extra requests for a catalog that
 * barely moves, so they rotate and the catalog fills in over a week.
 */
async function refreshDiscoveredLists(signal?: AbortSignal): Promise<void> {
  try {
    const markdown = await fetchText(A4_LIST_OF_LISTS.url, {
      accept: 'text/plain, text/markdown, */*',
      signal,
    });
    const section = extractSection(markdown, A4_LIST_OF_LISTS.section);
    await upsertCatalogEntries(
      parseListEntries(section)
        .filter((entry) => entry.repoFullName)
        .map((entry) => ({
          listId: DISCOVERED_LISTS_ID,
          name: entry.name,
          url: entry.url,
          repoFullName: entry.repoFullName,
          description: entry.description,
        })),
    );
  } catch {
    // Fall through to whatever lists were already discovered.
  }

  const due = await discoveredListsDue(A4_LISTS_EXPANDED_PER_NIGHT);
  for (const list of due) {
    if (!list.repo_full_name) continue;
    await readListInto(list.repo_full_name, rawReadmeUrl(list.repo_full_name), signal);
  }
  await markCatalogConsidered(due.map((list) => list.id));
}

async function buildCatalogItem(
  candidate: Scored,
  signal?: AbortSignal,
): Promise<AdapterItem | null> {
  const { entry } = candidate;
  if (!entry.repo_full_name) return null;

  const item = await buildRepoItem(
    { fullName: entry.repo_full_name, description: entry.description ?? '', starsToday: 0, rank: 0 },
    signal,
  ).catch((error) => {
    if (error instanceof GithubRateLimitError) throw error;
    return null;
  });
  if (!item) return null;

  return {
    ...item,
    // A news peg is the one case where a repo may return inside the
    // fingerprint window (D-066).
    allowRepeat: candidate.newsPeg,
    rawPayload: {
      listId: entry.list_id,
      editorScore: candidate.score,
      newsPeg: candidate.newsPeg,
    },
  };
}
