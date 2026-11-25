import type { Queryable } from '@/lib/explainers/db';
import type { Pitch } from '@/lib/reel-ai-drama/types';
import { runSubmit, section, type SendMessage, type SubmitTool } from '@/lib/reel-ai-drama/writing/llm';
import { countWords } from '@/lib/reel-ai-drama/writing/validate';

/**
 * MD-107: give a pitch written before iteration 5 its prose `brief`, so the new writer can run on the same
 * story. One Sonnet 5.5 call per pitch: the producer prompt is the cached system prefix (cachedSystemText via
 * runSubmit, 1h), the old pitch and its sources are the user message, and `submit_brief` returns the brief.
 * Used only by scripts/reel_ai_drama_rebrief.ts, which runs it only with --yes.
 */

export const REBRIEF_MODEL = 'claude-sonnet-5-5';
const REBRIEF_MAX_TOKENS = 4_000;
/** The brief is about 120–180 words (ITERATION-5.md); outside this band costs one correction. */
export const BRIEF_MIN_WORDS = 80;
export const BRIEF_MAX_WORDS = 240;

export const SUBMIT_BRIEF_TOOL: SubmitTool = {
  name: 'submit_brief',
  description: 'Submit the prose brief for this already-chosen story, once.',
  strict: true,
  input_schema: { type: 'object', additionalProperties: false, required: ['brief'], properties: { brief: { type: 'string' } } },
};

export type RebriefRow = { id: string; title: string; pitch: Pitch };

/** The old pitch (its story fields) and its sources; the task line says only what to hand back. */
export function rebriefUserMessage(row: RebriefRow): string {
  const { sources, expected_visuals: _visuals, ...story } = row.pitch;
  void _visuals;
  return [
    section('Task', 'This story is already chosen. Write its brief and submit it with `submit_brief`. Find nothing new; use only what the pitch and its sources say.'),
    section('The pitch', { ...story, title: row.title }),
    section('Its sources', sources ?? []),
  ].join('\n\n');
}

export function parseBrief(raw: unknown): { value: string | null; problems: string[] } {
  const brief = typeof (raw as { brief?: unknown })?.brief === 'string' ? (raw as { brief: string }).brief.trim() : '';
  if (!brief) return { value: null, problems: ['brief is missing'] };
  const n = countWords(brief);
  if (n < BRIEF_MIN_WORDS || n > BRIEF_MAX_WORDS) return { value: brief, problems: [`the brief runs ${n} words; write about 120–180`] };
  return { value: brief, problems: [] };
}

/**
 * A worst-case estimate in USD: every call pays full input (no cache hit) plus about 600 output tokens.
 * Sonnet 5.5: $2 input and $10 output per million tokens (lib/anthropic-pricing.ts).
 */
export function estimateRebrief(rows: readonly RebriefRow[], systemChars: number): number {
  const tokens = (chars: number) => Math.ceil(chars / 3.5);
  return rows.reduce((usd, r) => usd + ((tokens(systemChars) + tokens(rebriefUserMessage(r).length)) * 2 + 600 * 10) / 1_000_000, 0);
}

/** One call; the brief and its cost (recorded in the ledger under `rebrief`). */
export async function rebriefPitch(
  deps: { create: SendMessage; db: Queryable; producerPrompt: string },
  row: RebriefRow,
): Promise<{ brief: string; usd: number }> {
  const result = await runSubmit(deps.create, { db: deps.db, mode: 'development', pitchId: row.id }, {
    component: 'rebrief',
    model: REBRIEF_MODEL,
    system: deps.producerPrompt,
    user: rebriefUserMessage(row),
    tool: SUBMIT_BRIEF_TOOL,
    maxTokens: REBRIEF_MAX_TOKENS,
    parse: parseBrief,
  });
  return { brief: result.value, usd: result.usd };
}

/** Write the brief onto the pitch row (the rest of the pitch is untouched). */
export async function saveBrief(db: Queryable, row: RebriefRow, brief: string): Promise<void> {
  await db.query(`UPDATE reel_ai_drama.pitches SET pitch = $2::jsonb, updated_at = now() WHERE id = $1`, [row.id, JSON.stringify({ ...row.pitch, brief })]);
}
