import fs from 'node:fs';
import path from 'node:path';

import { jevPick, PICK_MIN, type Candidate } from '@/lib/explainers/jev/questions/section-picker';
import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { applyGuidance, foldRender, guidance, lessonEffects, readLedger, writeLedger, type ContextLog, type Ledger, type RenderLog } from '@/lib/explainers/injection/ledger';
import { lessonIdOf, loadLessonRules } from '@/lib/explainers/injection/lessons';
import { pickedBlock, prepareSections, SECTIONS_DIR, type Section } from '@/lib/explainers/injection/sections';
import type { AgentMessage } from '@/lib/explainers/render/agent';

/**
 * One render's instruction injection (INJECTION-PLAN.md): prepares the sections, picks each builder
 * window's sections with Jev (plus the ledger's promotions and lessons), watches each window for
 * misses and its first self-check, and folds the render into the ledger at the end. Everything fails
 * open: without Jev or on any error a window gets every pick section (the old full stack, as a suffix).
 */

export type InjectionDeps = {
  projectDir: string;
  jobId: string;
  /** <jobDir>/telemetry: injection.jsonl goes here. */
  telemetryDir: string;
  /** The ledger that lasts across renders. */
  ledgerFile: string;
  jev: ExplainersJevRunner | null;
  topicId?: string | null;
  log: (event: string, data?: Record<string, unknown>) => void;
  /**
   * Where renders' first-try logs last across machines (explainers.first_try_log): the ledger's
   * history comes from here when given (production and local alike), and every render is saved here.
   * Without it, the ledger file alone.
   */
  store?: LessonStore | null;
};

/** The database side of the ledger (job.ts gives the explainers DB). */
export type LessonStore = {
  /** The last renders' logs, oldest first. */
  load(): Promise<RenderLog[]>;
  save(render: RenderLog): Promise<void>;
};

type Pick = { ids: string[]; scores: Record<string, number>; lessons: string[]; lessonIds: string[]; role: string; look: string; frame: string | null };

/** The frame id a dispatch label names (`frame:checks:05-payoff` → `05-payoff`), or null (the scene builder). */
export function frameOfLabel(label: string): string | null {
  const last = label.split(':').pop() ?? '';
  return /^\d+-[a-z0-9-]+$/i.test(last) ? last : null;
}

/** The section a Read names, when it is one of the job's section files (a miss). */
export function missOf(filePath: string, byFile: Map<string, string>): string | null {
  const norm = filePath.replace(/\\/g, '/');
  const at = norm.lastIndexOf(`${SECTIONS_DIR.replace(/\\/g, '/')}/`);
  if (at < 0) return null;
  return byFile.get(norm.slice(at + SECTIONS_DIR.length + 1)) ?? null;
}

/** try.mjs's errors from its printed JSON (its problems when it printed them, else its errors). */
export function tryErrorsOfText(text: string): string[] | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text.slice(start)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (Array.isArray(j.problems) && j.problems.length) {
    return j.problems.map((p) => {
      const x = (p ?? {}) as { frame?: unknown; message?: unknown };
      return `${x.frame ? `${String(x.frame)}: ` : ''}${String(x.message ?? '')}`;
    });
  }
  return Array.isArray(j.errors) ? j.errors.map(String) : [];
}

const textOfResult = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : '')).join('\n')
      : '';

export class InjectionRun {
  private sections: Section[] | null = null;
  private byFile = new Map<string, string>();
  private picks = new Map<string, Promise<Pick>>();
  private contexts: ContextLog[] = [];
  private ledger: Ledger;

  constructor(private readonly deps: InjectionDeps) {
    this.ledger = readLedger(deps.ledgerFile);
  }

  /** Write the section files and turn the core-only stack on for this job. False when it cannot. */
  prepare(): boolean {
    try {
      this.sections = prepareSections(this.deps.projectDir);
    } catch (err) {
      this.deps.log('injection_failed', { step: 'prepare', error: (err as Error).message });
      this.sections = null;
    }
    for (const s of this.sections ?? []) if (s.tier !== 'core') this.byFile.set(`${s.id.replace(':', '--')}.md`, s.id);
    return Boolean(this.sections);
  }

  /** Replace the ledger's history with the store's (the DB): call once before the first dispatch. */
  async loadHistory(): Promise<void> {
    if (!this.deps.store) return;
    try {
      // the DB's renders, plus any the file has that the DB does not (renders from before the DB log)
      const fromDb = await this.deps.store.load();
      const have = new Set(fromDb.map((r) => r.jobId));
      const renders = [...fromDb, ...this.ledger.renders.filter((r) => !have.has(r.jobId))].sort((a, b) => a.at.localeCompare(b.at)).slice(-20);
      this.ledger = { ...this.ledger, renders };
    } catch (err) {
      this.deps.log('injection_failed', { step: 'load_history', error: (err as Error).message });
    }
  }

  /** The ledger as it stood when this render began. */
  get ledgerNow(): Ledger {
    return this.ledger;
  }

  /** Log a window that is not a builder dispatch (session A's catalog). */
  addContext(ctx: ContextLog): void {
    this.contexts.push(ctx);
    this.append({ kind: 'context', ...ctx });
  }

  get active(): boolean {
    return Boolean(this.sections);
  }

  private candidates(): Candidate[] {
    return (this.sections ?? []).filter((s) => s.tier === 'pick').map((s) => ({ id: s.id, label: `${s.file} § ${s.heading}`, summary: s.summary }));
  }

  private read(rel: string, max = 8000): string {
    try {
      return fs.readFileSync(path.join(this.deps.projectDir, rel), 'utf8').slice(0, max);
    } catch {
      return '';
    }
  }

  private pickFor(agent: string, frame: string | null, look: string): Promise<Pick> {
    const key = `${agent}|${frame ?? 'world'}`;
    let p = this.picks.get(key);
    if (!p) {
      p = (async (): Promise<Pick> => {
        const role = agent;
        const g = guidance(this.ledger, role, look);
        const cands = this.candidates();
        const ids = cands.map((c) => c.id);
        let scores: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 1]));
        if (this.deps.jev && cands.length) {
          const task = frame ? this.read(path.join('.hyperframes', 'frame-packets', `${frame}.md`)) : this.read('STORYBOARD.md');
          const state = { role, look, task: task || '(no packet)' };
          try {
            const r = await jevPick(this.deps.jev, 'sections', cands, state, { component: `injection:${role}`, topicId: this.deps.topicId });
            scores = r.scores;
            if (r.failed) this.deps.log('injection_jev_partial', { agent, frame, failedBatches: r.failed });
          } catch (err) {
            this.deps.log('injection_failed', { step: 'jev', agent, frame, error: (err as Error).message });
          }
        }
        return { ids: applyGuidance(ids, scores, g, PICK_MIN), scores, lessons: g.lessons, lessonIds: g.lessonIds, role, look, frame };
      })();
      this.picks.set(key, p);
    }
    return p;
  }

  /**
   * The dispatch message with this window's picked sections and lessons in front of it, and the
   * observer that logs the window's misses and first self-check. Without sections: the prompt as is.
   */
  async dispatch(agent: string, prompt: string, label: string, look: string): Promise<{ prompt: string; onMessage: (m: AgentMessage) => void; end: () => void }> {
    const none = { prompt, onMessage: () => {}, end: () => {} };
    if (!this.sections) return none;
    try {
      const frame = frameOfLabel(label);
      const pick = await this.pickFor(agent, frame, look);
      const chosen = this.sections.filter((s) => pick.ids.includes(s.id));
      const ctx: ContextLog = { label, role: pick.role, look: pick.look, frame, injected: pick.ids, scores: pick.scores, misses: [], firstTry: null, lessons: pick.lessonIds };
      this.contexts.push(ctx);
      const tries = new Set<string>();
      const onMessage = (m: AgentMessage) => {
        try {
          if (m.type === 'assistant') {
            const content = (m.message as { content?: unknown } | undefined)?.content;
            for (const b of Array.isArray(content) ? content : []) {
              const x = b as { type?: string; id?: string; name?: string; input?: Record<string, unknown> };
              if (x.type !== 'tool_use') continue;
              if (x.name === 'Read') {
                const id = missOf(String(x.input?.file_path ?? ''), this.byFile);
                if (id && !ctx.misses.includes(id)) ctx.misses.push(id);
              }
              if (x.name === 'Bash' && x.id && /assets\/kit\/try\.mjs/.test(String(x.input?.command ?? ''))) tries.add(x.id);
            }
          } else if (m.type === 'user' && ctx.firstTry === null) {
            const content = (m.message as { content?: unknown } | undefined)?.content;
            for (const b of Array.isArray(content) ? content : []) {
              const x = b as { type?: string; tool_use_id?: string; content?: unknown };
              if (x.type !== 'tool_result' || !x.tool_use_id || !tries.has(x.tool_use_id)) continue;
              const errors = tryErrorsOfText(textOfResult(x.content));
              if (errors) {
                ctx.firstTry = errors;
                break;
              }
            }
          }
        } catch {
          /* fail open */
        }
      };
      const end = () => this.append({ kind: 'context', ...ctx });
      return { prompt: `${pickedBlock(chosen, pick.lessons)}${prompt}`, onMessage, end };
    } catch (err) {
      this.deps.log('injection_failed', { step: 'dispatch', label, error: (err as Error).message });
      return none;
    }
  }

  private append(record: Record<string, unknown>): void {
    try {
      fs.mkdirSync(this.deps.telemetryDir, { recursive: true });
      fs.appendFileSync(path.join(this.deps.telemetryDir, 'injection.jsonl'), `${JSON.stringify(record)}\n`);
    } catch {
      /* fail open */
    }
  }

  /**
   * Fold this render into the ledger file, save it to the store (the DB), and write the render's
   * first-try notes (telemetry/first-try-lessons.md); returns a short summary for the log. Safe to
   * call twice (the repair pass): the second call replaces the first everywhere.
   */
  async finish(): Promise<FinishSummary | null> {
    if (!this.contexts.length) return null;
    const render: RenderLog = { jobId: this.deps.jobId, at: new Date().toISOString(), contexts: this.contexts };
    try {
      const fresh = readLedger(this.deps.ledgerFile);
      writeLedger(this.deps.ledgerFile, foldRender(fresh, render));
    } catch (err) {
      this.deps.log('injection_failed', { step: 'ledger', error: (err as Error).message });
    }
    if (this.deps.store) {
      try {
        await this.deps.store.save(render);
      } catch (err) {
        this.deps.log('injection_failed', { step: 'store', error: (err as Error).message });
      }
    }
    const tried = this.contexts.filter((c) => c.firstTry !== null);
    const summary: FinishSummary = {
      contexts: this.contexts.length,
      injected: this.contexts.reduce((x, c) => x + c.injected.length, 0),
      misses: this.contexts.reduce((x, c) => x + c.misses.length, 0),
      firstTryErrors: this.contexts.reduce((x, c) => x + (c.firstTry?.length ?? 0), 0),
      firstTryRuns: tried.length,
      firstTryClean: tried.filter((c) => c.firstTry!.length === 0).length,
      lessonsInjected: this.contexts.reduce((x, c) => x + (c.lessons?.length ?? 0), 0),
    };
    this.append({ kind: 'summary', ...summary });
    try {
      const ledger = foldRender(this.ledger, render);
      fs.writeFileSync(path.join(this.deps.telemetryDir, 'first-try-lessons.md'), firstTryNotes(render, ledger, summary));
    } catch {
      /* notes fail open */
    }
    return summary;
  }
}

export type FinishSummary = {
  contexts: number;
  injected: number;
  misses: number;
  firstTryErrors: number;
  /** Windows that ran a first self-check, and how many of those came back clean. */
  firstTryRuns: number;
  firstTryClean: number;
  lessonsInjected: number;
};

/** One render's first-try notes: each window, the lessons it got, what its first self-check said, and how each lesson has done so far. */
export function firstTryNotes(render: RenderLog, ledger: Ledger, summary: FinishSummary): string {
  const rules = loadLessonRules();
  const out: string[] = [
    `# First-try lessons: job ${render.jobId}`,
    '',
    `${summary.firstTryClean} of ${summary.firstTryRuns} builder windows passed their first self-check; ${summary.firstTryErrors} first-try errors; ${summary.lessonsInjected} lessons injected; ${summary.misses} misses.`,
    '',
    '## Windows',
    '',
  ];
  for (const c of render.contexts) {
    if (c.role === 'planner') continue;
    const made = new Map<string, number>();
    for (const e of c.firstTry ?? []) {
      const id = lessonIdOf(e, rules);
      made.set(id, (made.get(id) ?? 0) + 1);
    }
    const verdict = c.firstTry === null ? 'no self-check' : c.firstTry.length === 0 ? 'CLEAN' : `${c.firstTry.length} errors`;
    out.push(`### ${c.label} (${c.role}, ${c.look}): ${verdict}`);
    if (c.lessons?.length) out.push(`- lessons given: ${c.lessons.map((id) => `${id}${made.has(id) ? ' (made anyway)' : ''}`).join(', ')}`);
    for (const [id, n] of [...made].sort((a, b) => b[1] - a[1])) out.push(`- ${n}× ${id}${id.startsWith('kind:') ? ' (no rule yet)' : ''}`);
    out.push('');
  }
  const effects = lessonEffects(ledger).filter((e) => e.injected > 0 || e.withoutErrors > 0).sort((a, b) => b.withoutErrors + b.recurred - (a.withoutErrors + a.recurred));
  if (effects.length) {
    out.push(`## Lessons so far (${ledger.renders.length} renders)`, '', '| role, look | lesson | given → made anyway | not given → made |', '|---|---|---|---|');
    for (const e of effects.slice(0, 40)) out.push(`| ${e.role}, ${e.look} | ${e.lesson.slice(0, 70)} | ${e.injected} → ${e.recurred} | ${e.without} → ${e.withoutErrors} |`);
    out.push('');
  }
  const unwritten = new Set(effects.filter((e) => e.lesson.startsWith('kind:')).map((e) => e.lesson));
  if (unwritten.size) out.push('## Kinds with no rule yet (write one in explainers/injection/lessons.json)', '', ...[...unwritten].slice(0, 20).map((k) => `- ${k.slice(5)}`), '');
  return `${out.join('\n')}\n`;
}
