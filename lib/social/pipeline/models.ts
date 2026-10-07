/**
 * Model per Claude-backed stage: one setting each, never hardcoded at the
 * call site (Tommy, 2026-10-04; spec §7 decisions table).
 *
 * All four start on Claude Sonnet 5.5. After the first end-to-end run, the
 * output is compared against the reference posts; if a stage falls short
 * (the Writer is the likely one), only that stage's setting changes.
 */
export type ClaudeStage = 'reporter' | 'writer' | 'editor' | 'hook' | 'fact-checker';

export type StageModelConfig = {
  model: string;
  /** output_config.effort. Sonnet 5.5's default is high; set explicitly so a model swap can't change it silently. */
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};

export const STAGE_MODELS: Record<ClaudeStage, StageModelConfig> = {
  reporter: { model: 'claude-sonnet-5-5', effort: 'high' },
  writer: { model: 'claude-sonnet-5-5', effort: 'high' },
  editor: { model: 'claude-sonnet-5-5', effort: 'high' },
  /** Hook pass (prototype, Tommy 2026-10-06): its own setting. */
  hook: { model: 'claude-sonnet-5-5', effort: 'high' },
  'fact-checker': { model: 'claude-sonnet-5-5', effort: 'high' },
};
