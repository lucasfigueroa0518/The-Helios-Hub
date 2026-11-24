/**
 * One written tip slide, for the average social-media viewer (Tommy, 2026-11-06: "the header for each slide should
 * not be the name of the tool ... it should be the exact value that they're going to get from it ... the body copy
 * should explain what it is in layman's terms"). The slide shows `headline` and `body` only; `name` and `tryIt`
 * go into the caption's how-to-try lines, verbatim.
 */
export type DraftSlide = {
  kind: 'tip';
  /** The exact value the reader gets, in the shape of the tip's primary want. About 8 words at most. */
  headline: string;
  /** What it is, in plain words a stranger follows, naming the tool once. No commands or jargon. */
  body: string;
  /** The tool, skill, repo or technique's real name, as the source gives it. */
  name: string;
  /** How to try it: the exact command, prompt, setting or first steps as the source states them (caption only); empty when the source states none (the caption then links the source). */
  tryIt: string;
  /** The tip this slide was written from. */
  tipId: string;
};

/** The Writer's output (and the Editor's): one slide per tip plus the caption's own text (code adds the how-to-try lines). */
export type PostDraft = {
  slides: DraftSlide[];
  caption: string;
};

export type GateName = 'fact_check' | 'repeat' | 'overrun';

export type HardFailure = { gate: GateName; detail: string };

/** A slide the fact check failed while enough other slides passed: taken off the draft, its tip set aside by the run. */
export type DroppedSlide = { tipId: string; problems: string[] };

/** The result of the gates: hard failures stop the draft, notes go to review. */
export type GateReport = {
  hard: HardFailure[];
  notes: string[];
  /** The draft the other gates judged and the post carries: the input draft minus `dropped`. */
  draft: PostDraft;
  /** Slides taken off the draft because the fact check failed only them (see runGates). */
  dropped: DroppedSlide[];
  /** Set when the fact checker could not run (call failed or cap): the draft is neither passed nor failed. */
  factCheckUnavailable?: string;
  /** Usage of the fact check call, when it made one. */
  factCheckUsage?: StageUsage;
};

/** Token usage of one model call (the shape `cacheUsageFromMessage` returns plus output tokens). */
export type StageUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalInputTokens: number;
  outputTokens: number;
};

/**
 * What a fact checker answers. `problems` is the flat list; `bySlide` (keyed by the slide's tipId) and `caption`
 * attribute each problem to where it sits. A problem in neither (or a checker that gives no attribution) is
 * unattributed and fails the whole post. `unavailable` means it could not run at all (nothing was verified), which
 * is not the same as a claim failing.
 */
export type FactCheckResult = {
  ok: boolean;
  problems: string[];
  bySlide?: Record<string, string[]>;
  caption?: string[];
  usage?: StageUsage;
  unavailable?: string;
};

/** Injected fact checker: grounds the draft in the tips' own text. */
export type FactChecker = (input: { draft: PostDraft; sourceText: string }) => Promise<FactCheckResult>;

/** What the Writer answers for a tip whose source does not say what the thing is and does for the reader (or is not about AI): that tip gets no slide. */
export type InsufficientSource = { tipId: string; missing: string };
