import type { Query } from '@/lib/social/store/pg';

import { Ledger } from './budget';
import { fileIdea, type FileDeps } from './file';
import { doneRequest, failRequest, setStage } from './requests';
import { runSearch, type Client, type CostRecorder } from './search';
import type { OneBoxInput } from './types';
import { verifyFinding } from './verify';

const LIMIT = 'Stopped at the 35-cent limit; nothing was added.';

/**
 * One one-box seed from start to finish (design sections 3 to 7). Runs after the click has returned, so it never throws: every
 * ending writes `done` or `failed` on the request, with what was spent. Order: search (with the pool's headlines), the model's
 * own duplicate call, the free duplicate check on the found URL, the independent verifier, then filing through the type's
 * existing add function. The stage is `filing` just before the add function runs, so a crash there is told apart from the rest.
 */
export async function runOneBox(i: {
  q: Query;
  id: string;
  input: OneBoxInput;
  client: Client;
  fileDeps: FileDeps;
  readPage?: (url: string) => Promise<string | null>;
  recordCost?: CostRecorder;
  now?: Date;
}): Promise<void> {
  const ledger = new Ledger(i.input.vertical);
  const at = () => i.now ?? new Date();
  const fail = (message: string) => failRequest(i.q, i.id, message, ledger.spent);
  try {
    await setStage(i.q, i.id, 'searching', 0, at());
    const poolHeadlines = await i.fileDeps.headlines(i.input.vertical, i.input.series).catch(() => []);
    const searched = await runSearch({ client: i.client, ledger, input: i.input, poolHeadlines, readPage: i.readPage, recordCost: i.recordCost });
    if ('stopped' in searched) return await fail(LIMIT);
    const { finding } = searched;
    if (finding.duplicateOf) return await fail(`That idea is already in the pool: “${finding.duplicateOf}”. Nothing was added.`);
    if (!finding.found) return await fail(finding.reason || 'I couldn’t find a solid source for that idea. Nothing was added.');

    const primary = finding.articles[0];
    if (primary) {
      const existing = await i.fileDeps.existing(i.input.vertical, primary.url, primary.headline).catch(() => null);
      if (existing) return await fail(`That story is already in the queue: “${existing}”. Nothing was added.`);
    }

    await setStage(i.q, i.id, 'checking', ledger.spent, at());
    const verdict = await verifyFinding({ client: i.client, ledger, input: i.input, finding, readPage: i.readPage, recordCost: i.recordCost });
    if (!verdict.ok) return await fail(verdict.reason === 'Stopped at the 35-cent limit.' ? LIMIT : `${verdict.reason} Nothing was added.`);

    await setStage(i.q, i.id, 'filing', ledger.spent, at());
    const filed = await fileIdea({ input: i.input, verified: verdict.verified, deps: i.fileDeps });
    if (filed.status === 'added') return await doneRequest(i.q, i.id, filed.ideaId, ledger.spent);
    if (filed.status === 'duplicate') return await fail(`That story is already in the queue: “${filed.existing}”. Nothing was added.`);
    return await fail(`${filed.reason} Nothing was added.`);
  } catch (error) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), component: 'one-box-seed', message: 'run_failed', id: i.id, error: error instanceof Error ? error.message : String(error) }));
    await fail('Something went wrong; nothing was added.').catch(() => undefined);
  }
}
