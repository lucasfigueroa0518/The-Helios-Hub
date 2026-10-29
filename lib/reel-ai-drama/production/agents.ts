import {
  DIAGNOSER_AGENT,
  FIRST_VIEWER_AGENT,
  FRAME_WORKER_AGENT,
  READER_AGENT,
  SCENE_BUILDER_AGENT,
  SCENE_FRAME_WORKER_AGENT,
  TECH_FRAME_WORKER_AGENT,
  type AgentQuery,
} from '@/lib/explainers/render/agent';

/**
 * The frame-building session's subagents. Reel AI Drama reuses the Explainer session machinery
 * (runAgentSession) and swaps the subagents in the options it passes to the SDK through a wrapped
 * `query`, so nothing on the Explainer side changes. Copied from lib/real-case/render/agents.ts (which
 * stays dormant, MD-48) rather than imported, so the Real Case cleanup cannot break it.
 *
 * Kept: the legacy `frame-worker` (one frame module per dispatch) with our `frame-worker` prompt, and
 * the picture checker. Removed: the Explainer world builders, readers and first viewer: our first
 * viewer is check C3, run outside the session.
 */

export type AgentOverrides = Record<string, { prompt: string; description: string } | null>;

export function dramaAgentOverrides(frameWorkerPrompt: string): AgentOverrides {
  return {
    [FRAME_WORKER_AGENT]: {
      description: 'Writes exactly one frame module (assets/frames/<frame_id>.js) and its sound events from its role file and packet.',
      prompt: frameWorkerPrompt,
    },
    [SCENE_BUILDER_AGENT]: null,
    [SCENE_FRAME_WORKER_AGENT]: null,
    [TECH_FRAME_WORKER_AGENT]: null,
    [READER_AGENT]: null,
    [DIAGNOSER_AGENT]: null,
    [FIRST_VIEWER_AGENT]: null,
  };
}

/** A `query` that applies `overrides` to the session options' `agents` before calling `query`. */
export function withAgentOverrides(query: AgentQuery, overrides: AgentOverrides): AgentQuery {
  return ((params: { prompt: unknown; options?: Record<string, unknown> }) => {
    const agents = { ...((params.options?.agents ?? {}) as Record<string, Record<string, unknown>>) };
    for (const [name, override] of Object.entries(overrides)) {
      if (override === null) delete agents[name];
      else if (agents[name]) agents[name] = { ...agents[name], ...override };
    }
    return query({ ...params, options: { ...params.options, agents } } as never);
  }) as unknown as AgentQuery;
}
