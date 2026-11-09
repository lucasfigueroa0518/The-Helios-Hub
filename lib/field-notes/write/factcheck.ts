/**
 * The model-backed fact check: a HARD gate. `modelFactCheck(client)` returns the `FactChecker` the
 * gates call. The client passed in must be the budget-guarded one (writePost builds this checker
 * from the client it was given when `factCheck: 'model'`), so the check is metered and capped like
 * the Writer and the Editor; this module never builds a client.
 *
 * Order: first the free deterministic check (numerals and backtick spans must appear in the
 * source); if it already fails, the model is not called and nothing is paid. Otherwise one forced
 * tool call lists every claim with a verbatim evidence quote. Code then enforces what the model
 * only reports: an unsupported claim fails; a "supported" claim whose quote is not in the source
 * fails; an empty claim list fails. A call that cannot run (error, refusal, cap) is `unavailable`,
 * never a pass.
 *
 * Every problem is attributed (`bySlide` by the slide's tipId, or `caption`) so the gate can drop a failing slide
 * instead of the whole post (gates.ts slidesToDrop). Each claim carries the tipId of the slide it sits on, or
 * `caption`; a problem filed under any other id is unattributed and fails the whole post. When the free check fails
 * only on some slides and enough slides are left, the model checks the rest (the failing slides are already lost),
 * so one bad number no longer stops the others from being verified.
 */
import { callTool, type FieldNotesClient } from './client';
import { numeralFactCheck } from './gates';
import { buildFactCheckRequest, CAPTION_CLAIM_ID, FACT_CHECK_TOOL_NAME } from './prompts';
import { TIP_SLIDES_MIN } from '@/lib/field-notes/types';
import type { FactChecker, FactCheckResult, PostDraft } from './types';

type Claim = { claim: string; tipId: string; kind: string; supported: boolean; evidence: string };

function readClaims(input: unknown): Claim[] | null {
  const raw = (input as { claims?: unknown } | null)?.claims;
  if (!Array.isArray(raw)) return null;
  const out: Claim[] = [];
  for (const c of raw) {
    const r = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    if (typeof r.claim !== 'string' || typeof r.supported !== 'boolean' || typeof r.tipId !== 'string') return null;
    out.push({ claim: r.claim.trim(), tipId: r.tipId.trim(), kind: typeof r.kind === 'string' ? r.kind : 'other', supported: r.supported, evidence: typeof r.evidence === 'string' ? r.evidence.trim() : '' });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** True when every fragment of the quote (split at an ellipsis) appears in the source, ignoring case and punctuation. */
export function quoteInSource(quote: string, sourceText: string): boolean {
  const src = norm(sourceText);
  const parts = quote.split(/\.{3}|…/).map(norm).filter((p) => p.length >= 3);
  return parts.length > 0 && parts.every((p) => src.includes(p));
}

type Attributed = FactCheckResult & { bySlide: Record<string, string[]>; caption: string[] };

/** One model call over `draft`; each problem lands under its slide, the caption, or nowhere (unattributed). */
async function modelCheck(client: FieldNotesClient, draft: PostDraft, sourceText: string): Promise<Attributed> {
  const r = await callTool(client, buildFactCheckRequest({ draft, sourceText }), FACT_CHECK_TOOL_NAME);
  if (!r.ok) return { ok: false, problems: [], bySlide: {}, caption: [], unavailable: r.reason };
  const claims = readClaims(r.input);
  if (!claims) return { ok: false, problems: ['the fact check answer was malformed'], bySlide: {}, caption: [], usage: r.usage };
  if (claims.length === 0) return { ok: false, problems: ['the fact check listed no claims'], bySlide: {}, caption: [], usage: r.usage };
  const slideIds = new Set(draft.slides.map((s) => s.tipId));
  const problems: string[] = [];
  const bySlide: Record<string, string[]> = {};
  const caption: string[] = [];
  for (const c of claims) {
    let p: string | null = null;
    if (!c.supported) p = `unsupported ${c.kind}: "${c.claim}" (${c.evidence || 'no reason given'})`;
    else if (!quoteInSource(c.evidence, sourceText)) p = `${c.kind} "${c.claim}" was called supported, but its evidence quote is not in the source`;
    if (!p) continue;
    if (c.tipId.toLowerCase() === CAPTION_CLAIM_ID) caption.push(p);
    else if (slideIds.has(c.tipId)) (bySlide[c.tipId] ??= []).push(p);
    else p = `${p} [filed under "${c.tipId}", which is no slide of this draft]`;
    problems.push(p);
  }
  return { ok: problems.length === 0, problems, bySlide, caption, usage: r.usage };
}

export function modelFactCheck(client: FieldNotesClient): FactChecker {
  return async ({ draft, sourceText }) => {
    const cheap = await numeralFactCheck({ draft, sourceText });
    if (cheap.ok) return modelCheck(client, draft, sourceText);
    // The free check failed: nothing is paid unless enough clean slides (and a clean caption) could still make a post.
    const clean = draft.slides.filter((s) => !(cheap.bySlide[s.tipId]?.length));
    if (cheap.caption.length || clean.length < TIP_SLIDES_MIN) return cheap;
    const m = await modelCheck(client, { ...draft, slides: clean }, sourceText);
    if (m.unavailable) return m;
    const bySlide: Record<string, string[]> = { ...cheap.bySlide };
    for (const [id, ps] of Object.entries(m.bySlide)) bySlide[id] = [...(bySlide[id] ?? []), ...ps];
    return { ok: false, problems: [...cheap.problems, ...m.problems], bySlide, caption: m.caption, usage: m.usage };
  };
}
