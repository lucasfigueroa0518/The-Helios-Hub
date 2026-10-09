/**
 * Model per Claude-backed stage: one setting each, never hardcoded at the
 * call site (Tommy, 2026-10-04; spec §7 decisions table).
 *
 * All four start on Claude Sonnet 5.5. After the first end-to-end run, the
 * output is compared against the reference posts; if a stage falls short
 * (the Writer is the likely one), only that stage's setting changes.
 */
export type ClaudeStage = 'reporter' | 'writer' | 'editor' | 'fact-checker' | 'shorten';

export type StageModelConfig = {
  model: string;
  /** output_config.effort. Sonnet 5.5's default is high; set explicitly so a model swap can't change it silently. */
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};

export const STAGE_MODELS: Record<ClaudeStage, StageModelConfig> = {
  reporter: { model: 'claude-sonnet-5-5', effort: 'high' },
  writer: { model: 'claude-sonnet-5-5', effort: 'high' },
  editor: { model: 'claude-sonnet-5-5', effort: 'high' },
  'fact-checker': { model: 'claude-sonnet-5-5', effort: 'high' },
  /** The over-length rescue (writer/shorten.ts, 2026-10-08): a few lines cut to fit; low effort is enough. */
  shorten: { model: 'claude-sonnet-5-5', effort: 'low' },
};

/**
 * Photo vision check (Tommy, 2026-10-06, after the photo-finder bench): a
 * small vision model looks at the top stock candidates. Its own setting;
 * no effort parameter (a short forced-tool answer).
 */
export const PHOTO_VISION_MODEL = { model: 'claude-haiku-4-5-20251001' } as const;
