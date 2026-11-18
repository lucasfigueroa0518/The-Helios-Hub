/**
 * Session B cost telemetry (2026-11-16): where a reel's frame-building spend goes, by agent, turn,
 * tool call and revision round. Observe and write only: it reads the Agent SDK messages each session
 * already streams (runAgentSession's onMessage) and prices per-turn usage with the repo's pricing
 * helper. It makes no model, API or network call, and it never moves jobs.spend_usd: the phase rows
 * in explainers.cost_events stay the spend; the breakdown goes to explainers.cost_breakdown.
 *
 * What the stream gives (and what it does not):
 *   - one `assistant` message per content block; blocks of one API turn share message.id and usage,
 *     so turns are deduplicated by id (the last usage seen for an id wins);
 *   - subagent turns (the agent runner's orchestrator dispatching builders) carry parent_tool_use_id,
 *     the id of the Task/Agent tool_use that started them, and their own usage;
 *   - tool results arrive in `user` messages as tool_result blocks (text and/or image blocks);
 *   - the `result` message has the SDK's total_cost_usd, num_turns and duration_ms for the session.
 *
 * Files, per job: <jobDir>/telemetry/session-b.jsonl (append-only, as it happens, so a crashed run
 * still leaves data), and at the end session-b-summary.json + session-b-summary.md.
 */
import fs from 'node:fs';
import path from 'node:path';

import { priceAnthropicUsage, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';
import { SNAPS_FOR_WORLD, SNAPS_PER_FRAME, type AgentMessage, type SessionResult } from '@/lib/explainers/render/agent';
import { SELF_CHECKS_PER_BUILDER } from '@/lib/explainers/render/policy';
import type { ExplainersDb, Queryable } from '@/lib/explainers/db';
import { recordCostBreakdown, replaceCostBreakdown, type CostBreakdownRow } from '@/lib/explainers/repository';

/** The fix rounds runBuild can give one builder: one per check (build.ts). */
export const FIX_ROUND_BUDGET = { frame: ['missing', 'requests', 'checks', 'sound', 'finalize', 'repair'], world: ['fix', 'requests'] } as const;
/** A tool result's text, in approximate tokens (bytes / 4). */
export const BYTES_PER_TOKEN = 4;
/** An image whose size cannot be read: about what a ~1.15 MP still costs. */
export const IMAGE_TOKENS_FALLBACK = 1600;

export type TokenBuckets = { fresh: number; cacheWrite: number; cacheRead: number; output: number };
export type TurnRecord = TokenBuckets & { kind: 'turn'; t: number; label: string; agent: string; round: number; model: string; msgId: string; usd: number };
export type ToolCategory = 'snap' | 'self-check' | 'read-image' | 'read' | 'write' | 'bash' | 'search' | 'task' | 'other';
export type ToolRecord = {
  kind: 'tool';
  t: number;
  label: string;
  agent: string;
  round: number;
  tool: string;
  category: ToolCategory;
  /** Text returned into context, in UTF-8 bytes, and its approximate tokens. */
  bytes: number;
  approxTokens: number;
  images: number;
  imageBytes: number;
  imageTokens: number;
  isError: boolean;
  ms: number | null;
  /** A self-check's script (`try` or `bounds`), else null. */
  script: 'try' | 'bounds' | null;
};
export type RoundRecord = {
  kind: 'round_end';
  t: number;
  label: string;
  agent: string;
  round: number;
  roundKind: string;
  model: string;
  turns: number;
  sdkTurns: number | null;
  wallMs: number;
  sdkDurationMs: number | null;
  pricedUsd: number;
  sdkUsd: number;
  gapUsd: number;
  snaps: number;
  tryRuns: number;
  boundsRuns: number;
} & TokenBuckets;

const ZERO = (): TokenBuckets => ({ fresh: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
const add = (a: TokenBuckets, b: TokenBuckets) => {
  a.fresh += b.fresh;
  a.cacheWrite += b.cacheWrite;
  a.cacheRead += b.cacheRead;
  a.output += b.output;
};
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
/** Share of prompt tokens read from the cache: read / (fresh + write + read). */
export const hitRatio = (b: TokenBuckets) => {
  const prompt = b.fresh + b.cacheWrite + b.cacheRead;
  return prompt ? Math.round((b.cacheRead / prompt) * 1000) / 1000 : 0;
};

/** One turn's usage in buckets and dollars (5m cache-write fallback, as SpendMeter prices it). */
export function priceTurn(model: string, usage: MessageUsageLike['usage']): TokenBuckets & { usd: number } {
  const b = usageBucketsFromMessage({ usage }, '5m');
  return {
    fresh: b.uncachedInputTokens,
    cacheWrite: b.cacheCreation5mInputTokens + b.cacheCreation1hInputTokens,
    cacheRead: b.cacheReadInputTokens,
    output: b.outputTokens,
    usd: Number(priceAnthropicUsage(b, { modelId: model }).costUsd),
  };
}

/** The agent a dispatch label belongs to: `scene-builder`, `frame:<frame id>`, or the label itself. */
export function agentOfLabel(label: string): string {
  if (/^scene-builder\b/.test(label)) return 'scene-builder';
  const id = label.split(':').reverse().find((s) => /^\d{1,2}-[a-z]/i.test(s));
  return id ? `frame:${id}` : label;
}

/** The round's kind: `build` for a first dispatch, else the check that sent it back (`checks`, `fix`, …). */
export function roundKindOf(label: string): string {
  const parts = label.split(':');
  if (parts[0] === 'repair') return 'repair';
  if (parts[0] === 'scene-builder') return parts[1] ?? 'build';
  if (parts[0] === 'frame') return parts.length > 2 ? parts[1] : 'build';
  return 'build';
}

/** What a tool call is, for the cost picture (snaps and self-checks are the revision loop). */
export function toolCategory(name: string, input: Record<string, unknown>): ToolCategory {
  if (name === 'Bash') {
    const cmd = String(input.command ?? '');
    if (/assets\/kit\/snap\.mjs/.test(cmd)) return 'snap';
    if (/assets\/kit\/(?:try|bounds)\.mjs/.test(cmd)) return 'self-check';
    return 'bash';
  }
  if (name === 'Read') return /\.(png|jpe?g|webp|gif)$/i.test(String(input.file_path ?? '')) ? 'read-image' : 'read';
  if (name === 'Write' || name === 'Edit' || name === 'NotebookEdit') return 'write';
  if (name === 'Grep' || name === 'Glob') return 'search';
  if (name === 'Task' || name === 'Agent') return 'task';
  return 'other';
}

/** Approximate image tokens (width × height / 750, capped at the ~1.15 MP resize) from a PNG header; the fallback otherwise. */
export function imageTokens(base64: string): number {
  try {
    const head = Buffer.from(base64.slice(0, 48), 'base64');
    if (head.length >= 24 && head.readUInt32BE(0) === 0x89504e47) {
      const w = head.readUInt32BE(16);
      const h = head.readUInt32BE(20);
      if (w > 0 && h > 0) return Math.min(IMAGE_TOKENS_FALLBACK, Math.ceil((w * h) / 750));
    }
  } catch {
    // not base64 / not a PNG
  }
  return IMAGE_TOKENS_FALLBACK;
}

/** The size of a tool_result's content: text bytes and images, apart. */
export function measureToolResult(content: unknown): { bytes: number; images: number; imageBytes: number; imageTokens: number } {
  const out = { bytes: 0, images: 0, imageBytes: 0, imageTokens: 0 };
  const visit = (c: unknown) => {
    if (typeof c === 'string') out.bytes += Buffer.byteLength(c, 'utf8');
    else if (Array.isArray(c)) c.forEach(visit);
    else if (c && typeof c === 'object') {
      const block = c as { type?: string; text?: unknown; source?: { data?: unknown }; content?: unknown };
      if (block.type === 'image') {
        const data = typeof block.source?.data === 'string' ? block.source.data : '';
        out.images++;
        out.imageBytes += Math.floor((data.length * 3) / 4);
        out.imageTokens += imageTokens(data);
      } else if (typeof block.text === 'string') out.bytes += Buffer.byteLength(block.text, 'utf8');
      else if (block.content !== undefined) visit(block.content);
    }
  };
  visit(content);
  return out;
}

type Pending = { agent: string; tool: string; category: ToolCategory; t: number; script: 'try' | 'bounds' | null };

/** One dispatch (session) being observed. */
class RoundObserver {
  readonly turns = new Map<string, TurnRecord>();
  readonly tools: ToolRecord[] = [];
  private pending = new Map<string, Pending>();
  private subagents = new Map<string, string>();
  private lastTurnId: string | null = null;
  firstAt: number | null = null;
  endAt: number | null = null;
  sdkUsd: number | null = null;
  sdkTurns: number | null = null;
  sdkDurationMs: number | null = null;
  record: RoundRecord | null = null;

  constructor(
    private readonly owner: SessionBTelemetry,
    readonly label: string,
    readonly agent: string,
    readonly round: number,
    readonly model: string,
    readonly startedAt: number,
  ) {}

  private agentFor(message: AgentMessage): string {
    const parent = typeof message.parent_tool_use_id === 'string' ? message.parent_tool_use_id : null;
    if (!parent) return this.agent;
    return `${this.agent}>${this.subagents.get(parent) ?? `subagent:${parent}`}`;
  }

  private flushTurn(): void {
    if (this.lastTurnId) {
      const turn = this.turns.get(this.lastTurnId);
      if (turn) this.owner.append(turn);
    }
    this.lastTurnId = null;
  }

  onMessage = (message: AgentMessage): void => {
    const now = this.owner.now();
    this.firstAt ??= now;
    if (message.type === 'assistant') {
      const m = (message.message ?? {}) as { id?: string; model?: string; usage?: MessageUsageLike['usage']; content?: unknown };
      const agent = this.agentFor(message);
      const id = m.id ?? `anon-${this.turns.size}`;
      if (m.usage) {
        if (id !== this.lastTurnId) this.flushTurn();
        const model = m.model ?? this.model;
        const priced = priceTurn(model, m.usage);
        this.turns.set(id, { kind: 'turn', t: this.turns.get(id)?.t ?? now, label: this.label, agent, round: this.round, model, msgId: id, ...priced, usd: priced.usd });
        this.lastTurnId = id;
      }
      for (const block of Array.isArray(m.content) ? m.content : []) {
        const b = block as { type?: string; id?: string; name?: string; input?: Record<string, unknown> };
        if (b.type !== 'tool_use' || !b.id) continue;
        const input = b.input ?? {};
        const name = String(b.name ?? '');
        if (name === 'Task' || name === 'Agent') this.subagents.set(b.id, [input.subagent_type, input.description].filter(Boolean).map(String).join(':') || b.id);
        const script = name === 'Bash' ? (/assets\/kit\/(try|bounds)\.mjs/.exec(String(input.command ?? ''))?.[1] as 'try' | 'bounds' | undefined) ?? null : null;
        this.pending.set(b.id, { agent, tool: name, category: toolCategory(name, input), t: now, script });
      }
    } else if (message.type === 'user') {
      const content = (message.message as { content?: unknown } | undefined)?.content;
      for (const block of Array.isArray(content) ? content : []) {
        const b = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
        if (b.type !== 'tool_result' || !b.tool_use_id) continue;
        const p = this.pending.get(b.tool_use_id);
        this.pending.delete(b.tool_use_id);
        const size = measureToolResult(b.content);
        const rec: ToolRecord = {
          kind: 'tool',
          t: now,
          label: this.label,
          agent: p?.agent ?? this.agentFor(message),
          round: this.round,
          tool: p?.tool ?? 'unknown',
          category: p?.category ?? 'other',
          bytes: size.bytes,
          approxTokens: Math.ceil(size.bytes / BYTES_PER_TOKEN),
          images: size.images,
          imageBytes: size.imageBytes,
          imageTokens: size.imageTokens,
          isError: Boolean(b.is_error),
          ms: p ? now - p.t : null,
          script: p?.script ?? null,
        };
        this.tools.push(rec);
        this.owner.append(rec);
      }
    } else if (message.type === 'result') {
      this.sdkUsd = Number(message.total_cost_usd ?? 0);
      if (typeof message.num_turns === 'number') this.sdkTurns = message.num_turns;
      if (typeof message.duration_ms === 'number') this.sdkDurationMs = message.duration_ms;
    }
  };

  end = (result?: SessionResult | null): RoundRecord => {
    if (this.record) return this.record;
    this.flushTurn();
    this.endAt = this.owner.now();
    const tokens = ZERO();
    let priced = 0;
    for (const t of this.turns.values()) {
      add(tokens, t);
      priced += t.usd;
    }
    // the SDK's total is the spend (cost_events); an aborted session's is the meter's estimate
    const sdkUsd = this.sdkUsd ?? result?.totalCostUsd ?? priced;
    const cmd = (c: ToolCategory) => this.tools.filter((x) => x.category === c);
    this.record = {
      kind: 'round_end',
      t: this.endAt,
      label: this.label,
      agent: this.agent,
      round: this.round,
      roundKind: roundKindOf(this.label),
      model: this.model,
      turns: this.turns.size,
      sdkTurns: this.sdkTurns,
      wallMs: this.endAt - (this.firstAt ?? this.startedAt),
      sdkDurationMs: this.sdkDurationMs,
      pricedUsd: r6(priced),
      sdkUsd: r6(sdkUsd),
      gapUsd: r6(sdkUsd - priced),
      snaps: cmd('snap').filter((x) => !x.isError).length,
      tryRuns: this.tools.filter((x) => x.script === 'try' && !x.isError).length,
      boundsRuns: this.tools.filter((x) => x.script === 'bounds' && !x.isError).length,
      ...tokens,
    };
    this.owner.append(this.record);
    return this.record;
  };
}

export type AgentSummary = TokenBuckets & {
  agent: string;
  models: string[];
  rounds: number;
  turns: number;
  wallMs: number;
  pricedUsd: number;
  sdkUsd: number;
  gapUsd: number;
  cacheHitRatio: number;
  tools: Record<string, { calls: number; bytes: number; approxTokens: number; images: number; imageTokens: number }>;
};
export type FrameLoops = {
  agent: string;
  snapsUsed: number;
  snapsBudget: number;
  fixRoundsUsed: number;
  fixRoundsBudget: number;
  rounds: { n: number; label: string; kind: string; usd: number; snaps: number; tryRuns: number; boundsRuns: number; selfCheckBudgetPerScript: number }[];
};
export type SessionBSummary = {
  jobId: string | null;
  generatedAt: string;
  totals: TokenBuckets & { sdkUsd: number; pricedUsd: number; gapUsd: number; turns: number; rounds: number; wallMs: number; cacheHitRatio: number; toolCalls: number; toolTokens: number; imageTokens: number };
  agents: AgentSummary[];
  rounds: RoundRecord[];
  loops: FrameLoops[];
  top: { line: string; usd: number }[];
  notes: string[];
};

/** The recorder for one job's session B. */
export class SessionBTelemetry {
  private rounds: RoundObserver[] = [];
  private perAgent = new Map<string, number>();
  readonly jsonlPath: string | null;

  constructor(
    private readonly opts: { dir?: string | null; jobId?: string | null; now?: () => number } = {},
  ) {
    this.jsonlPath = opts.dir ? path.join(opts.dir, 'session-b.jsonl') : null;
    if (opts.dir) {
      try {
        fs.mkdirSync(opts.dir, { recursive: true });
      } catch {
        // telemetry fails open
      }
    }
  }

  now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** Append one record to session-b.jsonl (append-only, never throws). */
  append(record: Record<string, unknown>): void {
    if (!this.jsonlPath) return;
    try {
      fs.appendFileSync(this.jsonlPath, `${JSON.stringify(record)}\n`);
    } catch {
      // telemetry fails open
    }
  }

  /** Start observing one dispatch: pass onMessage to runAgentSession, call end() with its result. */
  observe(label: string, model: string): { onMessage: (m: AgentMessage) => void; end: (r?: SessionResult | null) => RoundRecord } {
    const agent = agentOfLabel(label);
    const n = (this.perAgent.get(agent) ?? 0) + 1;
    this.perAgent.set(agent, n);
    const obs = new RoundObserver(this, label, agent, n, model, this.now());
    this.rounds.push(obs);
    this.append({ kind: 'round_start', t: obs.startedAt, label, agent, round: n, model });
    return { onMessage: obs.onMessage, end: obs.end };
  }

  summary(): SessionBSummary {
    const rounds = this.rounds.map((r) => r.end());
    const notes: string[] = [];
    const agents = new Map<string, AgentSummary>();
    const agentRow = (agent: string) => {
      let a = agents.get(agent);
      if (!a) {
        a = { agent, models: [], rounds: 0, turns: 0, wallMs: 0, pricedUsd: 0, sdkUsd: 0, gapUsd: 0, cacheHitRatio: 0, tools: {}, ...ZERO() };
        agents.set(agent, a);
      }
      return a;
    };
    for (const obs of this.rounds) {
      const rec = obs.record!;
      const main = agentRow(obs.agent);
      main.rounds++;
      main.wallMs += rec.wallMs;
      main.sdkUsd += rec.sdkUsd;
      for (const t of obs.turns.values()) {
        const a = agentRow(t.agent);
        if (!a.models.includes(t.model)) a.models.push(t.model);
        a.turns++;
        a.pricedUsd += t.usd;
        add(a, t);
      }
      for (const t of obs.tools) {
        const a = agentRow(t.agent);
        const slot = (a.tools[t.tool] ??= { calls: 0, bytes: 0, approxTokens: 0, images: 0, imageTokens: 0 });
        slot.calls++;
        slot.bytes += t.bytes;
        slot.approxTokens += t.approxTokens;
        slot.images += t.images;
        slot.imageTokens += t.imageTokens;
      }
      if (Math.abs(rec.gapUsd) > Math.max(0.005, rec.sdkUsd * 0.02)) {
        notes.push(`${rec.label}: SDK total $${rec.sdkUsd.toFixed(4)} vs priced turns $${rec.pricedUsd.toFixed(4)} (gap $${rec.gapUsd.toFixed(4)}${rec.turns === 0 ? '; no turns streamed' : ''}).`);
      }
    }
    for (const a of agents.values()) {
      a.pricedUsd = r6(a.pricedUsd);
      a.sdkUsd = r6(a.sdkUsd);
      // a subagent's SDK spend is inside its parent session's total; its gap is not separable
      a.gapUsd = a.agent.includes('>') ? 0 : r6(a.sdkUsd - a.pricedUsd - [...agents.values()].filter((s) => s.agent.startsWith(`${a.agent}>`)).reduce((x, s) => x + s.pricedUsd, 0));
      a.cacheHitRatio = hitRatio(a);
    }
    const loops: FrameLoops[] = [];
    for (const [agent] of this.perAgent) {
      const own = this.rounds.filter((r) => r.agent === agent).map((r) => r.record!);
      const world = agent === 'scene-builder';
      if (!world && !agent.startsWith('frame:')) continue;
      loops.push({
        agent,
        snapsUsed: own.reduce((x, r) => x + r.snaps, 0),
        snapsBudget: world ? SNAPS_FOR_WORLD : SNAPS_PER_FRAME,
        fixRoundsUsed: own.filter((r) => r.roundKind !== 'build').length,
        fixRoundsBudget: world ? FIX_ROUND_BUDGET.world.length : FIX_ROUND_BUDGET.frame.length,
        rounds: own.map((r) => ({ n: r.round, label: r.label, kind: r.roundKind, usd: r.sdkUsd, snaps: r.snaps, tryRuns: r.tryRuns, boundsRuns: r.boundsRuns, selfCheckBudgetPerScript: SELF_CHECKS_PER_BUILDER })),
      });
    }
    const totals = { ...ZERO(), sdkUsd: 0, pricedUsd: 0, gapUsd: 0, turns: 0, rounds: rounds.length, wallMs: 0, cacheHitRatio: 0, toolCalls: 0, toolTokens: 0, imageTokens: 0 };
    let first = Infinity;
    let last = -Infinity;
    for (const obs of this.rounds) {
      const r = obs.record!;
      totals.sdkUsd += r.sdkUsd;
      totals.pricedUsd += r.pricedUsd;
      totals.turns += r.turns;
      add(totals, r);
      first = Math.min(first, obs.firstAt ?? obs.startedAt);
      last = Math.max(last, obs.endAt ?? obs.startedAt);
      for (const t of obs.tools) {
        totals.toolCalls++;
        totals.toolTokens += t.approxTokens;
        totals.imageTokens += t.imageTokens;
      }
    }
    totals.sdkUsd = r6(totals.sdkUsd);
    totals.pricedUsd = r6(totals.pricedUsd);
    totals.gapUsd = r6(totals.sdkUsd - totals.pricedUsd);
    totals.wallMs = rounds.length ? last - first : 0;
    totals.cacheHitRatio = hitRatio(totals);
    return {
      jobId: this.opts.jobId ?? null,
      generatedAt: new Date(this.now()).toISOString(),
      totals,
      agents: [...agents.values()].sort((a, b) => b.pricedUsd - a.pricedUsd),
      rounds,
      loops,
      top: topCostLines(this.rounds.flatMap((o) => [...o.turns.values()]), 10),
      notes,
    };
  }

  /** Rows for explainers.cost_breakdown: one per agent, one per round. Attribution only, never spend. */
  breakdownRows(summary: SessionBSummary): CostBreakdownRow[] {
    if (!summary.jobId) return [];
    const jobId = summary.jobId;
    return [
      // the render's totals and revision loops, one row (Lucas 2026-11-17: the advanced telemetry for every reel)
      {
        jobId,
        component: 'session_b:summary',
        model: null,
        turns: summary.totals.turns,
        inputTokens: summary.totals.fresh,
        outputTokens: summary.totals.output,
        cacheReadTokens: summary.totals.cacheRead,
        cacheWriteTokens: summary.totals.cacheWrite,
        usd: summary.totals.pricedUsd,
        wallMs: summary.totals.wallMs,
        detail: { totals: summary.totals, loops: summary.loops, top: summary.top.slice(0, 10), notes: summary.notes },
      },
      ...summary.agents.map((a) => ({
        jobId,
        component: `session_b:agent:${a.agent}`,
        model: a.models.join(',') || null,
        turns: a.turns,
        inputTokens: a.fresh,
        outputTokens: a.output,
        cacheReadTokens: a.cacheRead,
        cacheWriteTokens: a.cacheWrite,
        usd: a.pricedUsd,
        wallMs: a.wallMs,
        detail: { rounds: a.rounds, sdkUsd: a.sdkUsd, gapUsd: a.gapUsd, cacheHitRatio: a.cacheHitRatio, tools: a.tools },
      })),
      ...summary.rounds.map((r) => ({
        jobId,
        component: `session_b:round:${r.agent.replace(/^frame:/, '')}:${r.round}`,
        model: r.model,
        turns: r.turns,
        inputTokens: r.fresh,
        outputTokens: r.output,
        cacheReadTokens: r.cacheRead,
        cacheWriteTokens: r.cacheWrite,
        usd: r.pricedUsd,
        wallMs: r.wallMs,
        detail: { label: r.label, kind: r.roundKind, sdkUsd: r.sdkUsd, gapUsd: r.gapUsd, snaps: r.snaps, tryRuns: r.tryRuns, boundsRuns: r.boundsRuns },
      })),
    ];
  }

  /** Write session-b-summary.json and .md to the telemetry dir; returns the summary. */
  write(): SessionBSummary {
    const summary = this.summary();
    if (this.opts.dir) {
      try {
        fs.writeFileSync(path.join(this.opts.dir, 'session-b-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
        fs.writeFileSync(path.join(this.opts.dir, 'session-b-summary.md'), summaryMarkdown(summary));
      } catch {
        // telemetry fails open
      }
    }
    return summary;
  }
}

/** The costliest lines: each agent × round × token bucket, priced. */
export function topCostLines(turns: readonly TurnRecord[], n = 10): { line: string; usd: number }[] {
  const lines = new Map<string, number>();
  for (const t of turns) {
    const parts = priceParts(t);
    for (const [bucket, usd] of Object.entries(parts)) {
      const key = `${t.agent} · round ${t.round} (${t.label}) · ${bucket}`;
      lines.set(key, (lines.get(key) ?? 0) + usd);
    }
  }
  return [...lines]
    .map(([line, usd]) => ({ line, usd: r6(usd) }))
    .filter((l) => l.usd > 0)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, n);
}

function priceParts(t: TurnRecord): Record<string, number> {
  const one = (b: Partial<TokenBuckets>) =>
    Number(
      priceAnthropicUsage(
        { uncachedInputTokens: b.fresh ?? 0, cacheReadInputTokens: b.cacheRead ?? 0, cacheCreation5mInputTokens: b.cacheWrite ?? 0, cacheCreation1hInputTokens: 0, outputTokens: b.output ?? 0, webSearchRequests: 0 },
        { modelId: t.model },
      ).costUsd,
    );
  return { output: one({ output: t.output }), 'cache write': one({ cacheWrite: t.cacheWrite }), 'cache read': one({ cacheRead: t.cacheRead }), 'fresh input': one({ fresh: t.fresh }) };
}

const usd = (n: number) => `$${n.toFixed(4)}`;
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** The readable summary. */
export function summaryMarkdown(s: SessionBSummary): string {
  const t = s.totals;
  const out = [
    `# Session B cost telemetry${s.jobId ? ` — job ${s.jobId}` : ''}`,
    '',
    `SDK total ${usd(t.sdkUsd)} (the spend, in cost_events) · priced turns ${usd(t.pricedUsd)} · gap ${usd(t.gapUsd)}`,
    `${t.rounds} rounds · ${t.turns} turns · ${(t.wallMs / 1000).toFixed(1)}s wall · cache hit ${(t.cacheHitRatio * 100).toFixed(1)}% · ${t.toolCalls} tool calls (~${k(t.toolTokens)} text tokens, ~${k(t.imageTokens)} image tokens returned)`,
    '',
    '## Top cost lines',
    '',
    ...s.top.map((l, i) => `${i + 1}. ${usd(l.usd)} — ${l.line}`),
    '',
    '## Agents',
    '',
    '| agent | model | rounds | turns | wall s | priced $ | SDK $ | fresh | cache write | cache read | output | hit % |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...s.agents.map((a) => `| ${a.agent} | ${a.models.join(', ')} | ${a.rounds} | ${a.turns} | ${(a.wallMs / 1000).toFixed(1)} | ${a.pricedUsd.toFixed(4)} | ${a.sdkUsd.toFixed(4)} | ${k(a.fresh)} | ${k(a.cacheWrite)} | ${k(a.cacheRead)} | ${k(a.output)} | ${(a.cacheHitRatio * 100).toFixed(1)} |`),
    '',
    '## Revision loops',
    '',
    ...s.loops.flatMap((l) => [
      `- **${l.agent}**: snaps ${l.snapsUsed}/${l.snapsBudget}, fix rounds ${l.fixRoundsUsed}/${l.fixRoundsBudget}`,
      ...l.rounds.map((r) => `  - round ${r.n} (${r.kind}, ${r.label}): ${usd(r.usd)}, snaps ${r.snaps}, try ${r.tryRuns}/${r.selfCheckBudgetPerScript}, bounds ${r.boundsRuns}/${r.selfCheckBudgetPerScript}`),
    ]),
    '',
    '## Tool results into context',
    '',
    '| agent | tool | calls | text tokens ≈ | images | image tokens ≈ |',
    '|---|---|---|---|---|---|',
    ...s.agents.flatMap((a) => Object.entries(a.tools).map(([tool, x]) => `| ${a.agent} | ${tool} | ${x.calls} | ${k(x.approxTokens)} | ${x.images} | ${k(x.imageTokens)} |`)),
  ];
  if (s.notes.length) out.push('', '## Notes', '', ...s.notes.map((n) => `- ${n}`));
  return `${out.join('\n')}\n`;
}

/**
 * The end of session B: the summary files, then the breakdown rows (explainers.cost_breakdown, never
 * cost_events). Fails open: telemetry never fails a render. Returns null on a failure.
 */
export async function finishSessionBTelemetry(telemetry: SessionBTelemetry, db: Queryable): Promise<SessionBSummary | null> {
  try {
    const summary = telemetry.write();
    await recordCostBreakdown(db, telemetry.breakdownRows(summary));
    telemetry.append({ kind: 'summary', t: telemetry.now(), ...summary.totals });
    return summary;
  } catch {
    return null;
  }
}

/**
 * After the repair pass: rewrite the summary files with every round so far (repair rounds included)
 * and replace the job's session_b:* breakdown rows (delete + insert, one transaction), so the
 * pre-repair rows are not counted twice. Never cost_events or spend. Fails open; null on a failure.
 */
export async function rewriteSessionBTelemetry(telemetry: SessionBTelemetry, db: ExplainersDb, jobId: string): Promise<SessionBSummary | null> {
  try {
    const summary = telemetry.write();
    await replaceCostBreakdown(db, jobId, telemetry.breakdownRows(summary));
    telemetry.append({ kind: 'summary', t: telemetry.now(), after: 'repair', ...summary.totals });
    return summary;
  } catch {
    return null;
  }
}
