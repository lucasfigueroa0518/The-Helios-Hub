import type { Query } from '@/lib/social/store/pg';

import { classifyLeafWant, NOT_A_KIND } from './classify';
import { Ledger, limitReason, limitText } from './budget';
import { fileFieldNote, fileIdea, type FileDeps, type FileResult } from './file';
import { entryTitle, entryUrl, missingFields, shapeOf } from './shape';
import { doneRequest, failRequest, setStage } from './requests';
import { runSearch, type Client, type CostRecorder } from './search';
import type { OneBoxInput } from './types';
import { verifyFinding } from './verify';

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
  const finish = async (filed: FileResult) => {
    if (filed.status === 'added') return await doneRequest(i.q, i.id, filed.ideaId, ledger.spent);
    if (filed.status === 'duplicate') return await fail(`That story is already in the queue: “${filed.existing}”. Nothing was added.`);
    return await fail(/nothing was added/i.test(filed.reason) ? filed.reason : `${filed.reason} Nothing was added.`);
  };
  try {
    if (i.input.vertical === 'field_notes' && i.input.link) {
      // Free with a link (design: Field Notes): no search, no page read, no verifier; one small call sorts the person's words.
      await setStage(i.q, i.id, 'checking', 0, at());
      const kind = await classifyLeafWant({ client: i.client, ledger, blurb: i.input.blurb, recordCost: i.recordCost });
      if ('error' in kind) return await fail(kind.error === 'budget' ? limitText('field_notes') : kind.error);
      await setStage(i.q, i.id, 'filing', ledger.spent, at());
      const filed = await fileFieldNote({ deps: i.fileDeps, sourceUrl: i.input.link, leaf: kind.leaf, want: kind.want, note: i.input.blurb });
      return await finish(filed);
    }
    await setStage(i.q, i.id, 'searching', 0, at());
    const poolHeadlines = await i.fileDeps.headlines(i.input.vertical).catch(() => []);
    const searched = await runSearch({ client: i.client, ledger, input: i.input, poolHeadlines, readPage: i.readPage, recordCost: i.recordCost });
    if ('stopped' in searched) return await fail(limitText(i.input.vertical));
    const { finding } = searched;
    if (finding.duplicateOf) return await fail(`That idea is already in the pool: “${finding.duplicateOf}”. Nothing was added.`);
    if (!finding.found) return await fail(finding.reason || 'I couldn’t find a solid source for that idea. Nothing was added.');

    const shape = shapeOf(i.input);
    const primary = finding.entries.find((e) => missingFields(shape, e).length === 0);
    // Field Notes: an official page with no valid kind (leaf and want) cannot be filed, so it is not read or verified.
    if (!primary && i.input.vertical === 'field_notes' && finding.entries.some((e) => missingFields(shape, e).every((f) => f === 'leaf' || f === 'want'))) {
      return await fail(NOT_A_KIND);
    }
    if (primary) {
      const existing = await i.fileDeps.existing(i.input.vertical, entryUrl(shape, primary), entryTitle(primary)).catch(() => null);
      if (existing) return await fail(`That story is already in the queue: “${existing}”. Nothing was added.`);
    }

    await setStage(i.q, i.id, 'checking', ledger.spent, at());
    const verdict = await verifyFinding({ client: i.client, ledger, input: i.input, finding, readPage: i.readPage, recordCost: i.recordCost });
    if (!verdict.ok) return await fail(verdict.reason === limitReason(i.input.vertical) ? limitText(i.input.vertical) : `${verdict.reason} Nothing was added.`);

    await setStage(i.q, i.id, 'filing', ledger.spent, at());
    return await finish(await fileIdea({ input: i.input, verified: verdict.verified, deps: i.fileDeps }));
  } catch (error) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), component: 'one-box-seed', message: 'run_failed', id: i.id, error: error instanceof Error ? error.message : String(error) }));
    await fail('Something went wrong; nothing was added.').catch(() => undefined);
  }
}
