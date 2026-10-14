/** Raw error → reason code (spec §4.2). Order matters: first match wins. No model involved. */
const RULES: ReadonlyArray<[RegExp, string]> = [
  [/watch reached|spend cap|cost.?cap|budget|capped/i, 'cap_hit'],
  [/timed? ?out|timeout|ETIMEDOUT/i, 'timeout'],
  [/rate.?limit|\b429\b/i, 'rate_limited'],
  [/\b5\d\d\b|internal server error|service unavailable|bad gateway/i, 'service_5xx'],
  [/\b40[13]\b|unauthori[sz]ed|forbidden|access token|invalid token|expired token|permission/i, 'auth'],
  [/copy_does_not_fit|too long|over.?limit|length/i, 'too_long'],
  [/rejected_background|no (usable )?(photo|image)|background/i, 'no_photo'],
  [/json|parse|malformed|schema/i, 'malformed_output'],
  [/refus/i, 'refused'],
  [/not found|\b404\b/i, 'not_found'],
];

export function reasonFor(_stage: string, raw: string | null | undefined): string {
  if (!raw) return 'other';
  for (const [re, code] of RULES) if (re.test(raw)) return code;
  return 'other';
}

/** Carousels already store a reason_code (lib/social/pipeline/types.ts ReasonCode). */
const CAROUSEL: Record<string, string> = {
  'over-limit': 'too_long',
  'cost-cap': 'cap_hit',
  'render-failed': 'render_failed',
  'service-error': 'service_5xx',
  'malformed-output': 'malformed_output',
  'needs-fresh-draft': 'needs_fresh_draft',
  'unfixable-draft': 'unfixable_draft',
  refused: 'refused',
  'main-claim-false': 'claim_false',
  'unverifiable-claim': 'claim_unverifiable',
};
export function carouselReason(code: string): string {
  return CAROUSEL[code] ?? code.replace(/-/g, '_');
}

export const REASON_LABEL: Record<string, string> = {
  cap_hit: 'hit its spend cap',
  timeout: 'timed out',
  rate_limited: 'was rate limited',
  service_5xx: 'service error',
  auth: 'sign-in or permission error',
  too_long: 'ran too long',
  no_photo: 'no usable photo',
  malformed_output: 'unreadable model output',
  refused: 'model refused',
  not_found: 'something it needed was missing',
  render_failed: 'render failed',
  needs_fresh_draft: 'needed a fresh draft',
  unfixable_draft: 'draft could not be fixed',
  claim_false: 'main claim was false',
  claim_unverifiable: "claim couldn't be verified",
  reporter_error: "couldn't read this type's data",
  did_not_run: "didn't run",
  other: 'unrecognized error',
};

const STAGE: Record<string, string> = {
  'jev-scoring': 'Scoring', reporter: 'Reporter', writer: 'Writer', editor: 'Editor', 'fact-checker': 'Fact-checker',
  mechanical: 'Checks', design: 'Design', copy: 'Copy', frame: 'Frame', video: 'Video', song: 'Song', run: 'Run',
  publish: 'Publish', ideas: 'Ideas', render: 'Render', build: 'Build', report: 'Report',
};
export function stageLabel(stage: string): string {
  if (STAGE[stage]) return STAGE[stage]!;
  const words = stage.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
