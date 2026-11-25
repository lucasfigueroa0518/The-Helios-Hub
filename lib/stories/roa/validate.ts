/**
 * The Real or AI? validator (code, CONTRACT.md §3 "Validator limits"). Every
 * rule roa-write@3 and roa-reveal@2 state as required is checked here (roa-write@3 rule 7 is the screen's); the
 * builder re-runs the provenance and used-key checks before a candidate posts.
 */
import { EMOJI_RUN } from '@/lib/stories/render/emoji';

import {
  NO_AI_SUBJECTS,
  RETIRED_TRAPS,
  ROA_PROMPT_MAX_WORDS,
  ROA_PROOF_MAX_CHARS,
  ROA_REVEAL_MAX_CHARS,
  ROA_REVEAL_MAX_WORDS,
  SUBJECTS,
  TRAP_TRUTH,
  TRAPS,
  type Provenance,
  type RoaCandidate,
  type Subject,
  type Trap,
  type Truth,
} from './types';

/** One emoji anywhere (the stories emoji pattern, plus flags and keycaps). Not global, so .test has no state. */
const EMOJI = new RegExp(`${EMOJI_RUN.source}|\\p{Regional_Indicator}|\\u20E3`, 'u');

export const REAL_KINDS = ['bank', 'commons', 'nasa'] as const;
export const AI_KINDS = ['generated', 'dataset', 'viral'] as const;

/** Search words for a real photo: a few plain words. */
export const SEARCH_WORDS = { min: 1, max: 6 } as const;

export const text = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
const nonEmpty = (v: unknown) => text(v).length > 0;
const isUrl = (u: unknown) => /^https?:\/\/\S+$/i.test(text(u));

/** The truth a provenance kind implies: real photos come only from the bank, Commons or NASA (RA-5). */
export function provenanceTruth(p: Provenance): Truth {
  return (REAL_KINDS as readonly string[]).includes(p.kind) ? 'real' : 'ai';
}

/** Problems in the reveal line (RA-13): ≤ 10 words, ≤ 70 characters, no `!`, no emoji. */
export function lineProblems(line: unknown): string[] {
  const s = text(line);
  const out: string[] = [];
  if (!s) return ['line: empty'];
  const words = wordCount(s);
  if (words > ROA_REVEAL_MAX_WORDS) out.push(`line: ${words} words (max ${ROA_REVEAL_MAX_WORDS})`);
  if (s.length > ROA_REVEAL_MAX_CHARS) out.push(`line: ${s.length} chars (max ${ROA_REVEAL_MAX_CHARS})`);
  if (s.includes('!')) out.push('line: exclamation mark');
  if (EMOJI.test(s)) out.push('line: emoji');
  return out;
}

export function proofProblems(proof: unknown): string[] {
  const s = text(proof);
  if (!s) return ['proof: empty'];
  return s.length > ROA_PROOF_MAX_CHARS ? [`proof: ${s.length} chars (max ${ROA_PROOF_MAX_CHARS})`] : [];
}

/** The prompt shown on an AI reveal (RA-17): ≤ 25 words. */
export function promptProblems(prompt: unknown): string[] {
  const s = text(prompt);
  if (!s) return ['prompt: empty'];
  const words = wordCount(s);
  return words > ROA_PROMPT_MAX_WORDS ? [`prompt: ${words} words (max ${ROA_PROMPT_MAX_WORDS})`] : [];
}

/** Complete provenance (R8): a real photo needs its link, licence and credit; an AI image its generation record or source. */
export function provenanceProblems(p: unknown): string[] {
  if (!p || typeof p !== 'object') return ['provenance: missing'];
  const o = p as Record<string, unknown>;
  const kind = text(o.kind);
  if (!kind) return ['provenance: no kind'];
  const out: string[] = [];
  switch (kind) {
    case 'bank':
    case 'commons':
    case 'nasa':
      if (!isUrl(o.url)) out.push('provenance: no source link');
      if (!nonEmpty(o.licence)) out.push('provenance: no licence');
      if (!nonEmpty(o.credit)) out.push('provenance: no credit');
      break;
    case 'generated':
      if (!nonEmpty(o.model)) out.push('provenance: no model');
      if (!nonEmpty(o.prompt)) out.push('provenance: no prompt');
      if (!nonEmpty(o.createdAt)) out.push('provenance: no creation time');
      break;
    case 'dataset':
      if (!nonEmpty(o.dataset)) out.push('provenance: no dataset');
      if (!nonEmpty(o.id)) out.push('provenance: no dataset id');
      break;
    case 'viral':
      if (!isUrl(o.url)) out.push('provenance: no source link');
      break;
    default:
      out.push(`provenance: unknown kind ${kind}`);
  }
  return out;
}

/** The pool key or the bare image key, as the bare image key. */
export const bareImageKey = (key: string) => key.replace(/^roa:/, '');

export type CandidateContext = {
  /** Image keys already in a published (or about-to-post) set. */
  used: ReadonlySet<string>;
};

/** A candidate before it pools or posts: truth matches trap and provenance, provenance complete, image never posted. */
export function candidateProblems(c: RoaCandidate, ctx: CandidateContext): string[] {
  const out: string[] = [];
  if (!/^[0-9a-f]{16}$/.test(c.imageKey)) out.push(`image key: ${c.imageKey} is not 16 hex characters`);
  if (c.truth !== 'real' && c.truth !== 'ai') out.push(`truth: ${String(c.truth)}`);
  if (!(SUBJECTS as readonly string[]).includes(c.subject)) out.push(`subject: ${String(c.subject)}`);
  if (!(TRAPS as readonly string[]).includes(c.trap)) out.push(`trap: ${String(c.trap)}`);
  else if (c.trap !== 'twin' && TRAP_TRUTH[c.trap] !== c.truth) out.push(`trap: ${c.trap} makes a ${TRAP_TRUTH[c.trap]} round, not ${c.truth}`);
  const prov = provenanceProblems(c.provenance);
  out.push(...prov);
  if (!prov.length && provenanceTruth(c.provenance) !== c.truth) out.push(`provenance: a ${c.provenance.kind} image cannot be ${c.truth}`);
  if (c.twinOf !== undefined && c.truth !== 'ai') out.push('twin: only the AI twin points at its real photo');
  if (c.truth === 'ai' && NO_AI_SUBJECTS.includes(c.subject)) out.push(`subject: ${c.subject} is never an AI image`);
  if (ctx.used.has(c.imageKey)) out.push('image key: already in a published set');
  return out;
}

/** The proof line (R8, ≤ 60 chars). Real: "place, year · credit"; AI: the model or the source. */
export function proofOf(p: Provenance): string {
  const max = ROA_PROOF_MAX_CHARS;
  const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…`);
  switch (p.kind) {
    case 'bank':
    case 'commons':
    case 'nasa': {
      // The photographer's name stays whole as long as it can: the source suffix goes before the place, the year last.
      const credit = text(p.credit);
      const short = credit.replace(/\s*\/\s*(Wikimedia Commons|NASA)$/i, '') || credit;
      const place = text(p.place);
      const year = text(p.year);
      const join = (head: string[], who: string) => (head.filter(Boolean).length ? `${head.filter(Boolean).join(', ')} · ${who}` : who);
      for (const option of [join([place, year], credit), join([place, year], short), join([year], credit), join([year], short), short]) {
        if (option.length <= max) return option;
      }
      return year ? `${year} · ${clip(short, max - year.length - 3)}` : clip(short, max);
    }
    case 'generated':
      return clip(`Made with ${text(p.model)}`, max);
    case 'dataset':
      return clip(p.model ? `${text(p.model)}, from ${text(p.dataset)}` : `AI image from ${text(p.dataset)}`, max);
    case 'viral':
      return clip(p.model ? `Viral AI image made with ${text(p.model)}` : 'Viral AI image', max);
  }
}

/* ── roa-write@3 specs ──────────────────────────────────────────────── */

export type RoaSpec = { subject: Subject; trap: Trap; searchWords: string; aiPrompt: string };
export type SpecItem = { subject?: unknown; trap?: unknown; search_words?: unknown; ai_prompt?: unknown };

/** The truths one spec yields: a twin is one real and one AI image. */
export const specTruths = (trap: Trap): Truth[] => (trap === 'twin' ? ['real', 'ai'] : [TRAP_TRUTH[trap]]);

/**
 * Check the writer's specs: each valid alone (a known cell, the fields its trap needs, the prompt within 25 words), each
 * on its own subject, and together at most `perTruth` real and `perTruth` AI images. Specs past the balance are dropped
 * in order; the rest go on.
 */
export function validateSpecs(items: unknown, perTruth: number): { specs: RoaSpec[]; rejected: Array<{ cell: string; problems: string[] }> } {
  const specs: RoaSpec[] = [];
  const rejected: Array<{ cell: string; problems: string[] }> = [];
  const count: Record<Truth, number> = { real: 0, ai: 0 };
  const subjects = new Set<string>();
  for (const raw of Array.isArray(items) ? (items as SpecItem[]) : []) {
    const subject = text(raw?.subject) as Subject;
    const trap = text(raw?.trap) as Trap;
    const searchWords = text(raw?.search_words);
    const aiPrompt = text(raw?.ai_prompt);
    const cell = `${subject || '?'}.${trap || '?'}`;
    const problems: string[] = [];
    if (!(SUBJECTS as readonly string[]).includes(subject)) problems.push(`subject: ${subject || 'empty'}`);
    if (!(TRAPS as readonly string[]).includes(trap)) problems.push(`trap: ${trap || 'empty'}`);
    else if (RETIRED_TRAPS.includes(trap)) problems.push(`trap: ${trap} is retired`);
    if (!problems.length) {
      const truths = specTruths(trap);
      if (truths.includes('ai') && NO_AI_SUBJECTS.includes(subject)) problems.push(`subject: ${subject} is never made as an AI image`);
      if (truths.includes('real')) {
        const n = wordCount(searchWords);
        if (n < SEARCH_WORDS.min || n > SEARCH_WORDS.max) problems.push(`search_words: ${n} words (${SEARCH_WORDS.min}–${SEARCH_WORDS.max})`);
      }
      if (truths.includes('ai')) problems.push(...promptProblems(aiPrompt).map((p) => p.replace(/^prompt/, 'ai_prompt')));
      if (subjects.has(subject)) problems.push(`subject: ${subject} already used by another spec`);
      if (!problems.length && truths.some((t) => count[t] >= perTruth)) problems.push(`over the balance of ${perTruth} real and ${perTruth} AI`);
      if (!problems.length) for (const t of truths) count[t]++;
    }
    if (problems.length) {
      rejected.push({ cell, problems });
      continue;
    }
    subjects.add(subject);
    specs.push({ subject, trap, searchWords, aiPrompt });
  }
  return { specs, rejected };
}
