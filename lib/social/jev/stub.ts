/**
 * Stub Jev for offline tests and dry runs. Answers come from a table keyed
 * by `${version}:${subjectId}`; an unknown key or question throws, so a
 * test can never fall through to a live call or a silent default.
 */
import type { JevAsk, JevResult } from './client';

/** Question id → probability of yes. `'*'` answers any question not listed. */
export type StubAnswers = Record<string, number>;

export type StubTable = Record<string, StubAnswers>;

export function stubKey(version: string, subjectId: string): string {
  return `${version}:${subjectId}`;
}

/**
 * `handlers` answer a whole question set in code (e.g. pairwise sets whose
 * question ids are positional); everything else comes from `table`.
 */
export function createStubJev(table: StubTable, handlers: Record<string, JevAsk> = {}): JevAsk {
  return async (request, meta) => {
    const handler = handlers[meta.version];
    if (handler) return handler(request, meta);
    const key = stubKey(meta.version, meta.subjectId);
    const entry = table[key];
    if (!entry) throw new Error(`stub Jev: no answers for ${key}`);
    const answers: JevResult['answers'] = {};
    for (const [id, q] of Object.entries(request.questions)) {
      const p = entry[id] ?? entry['*'];
      if (p === undefined) throw new Error(`stub Jev: no answer for ${key} / ${id}`);
      // A choice question: the stub picks the first label (tests that care pass a handler).
      const labels = (q as { type?: string; criteria?: Record<string, unknown> }).type === 'choice' ? Object.keys((q as { criteria: Record<string, unknown> }).criteria) : null;
      answers[id] = labels ? { choice: labels[0]!, probabilities: Object.fromEntries(labels.map((l, i) => [l, i === 0 ? p : (1 - p) / Math.max(1, labels.length - 1)])) } : { noul: p };
    }
    // Rough token count (≈4 chars/token) so cost plumbing is exercised.
    const input_tokens = Math.ceil(JSON.stringify(request).length / 4);
    return { answers, usage: { input_tokens, output_tokens: 0 }, model: 'stub-jev' };
  };
}
