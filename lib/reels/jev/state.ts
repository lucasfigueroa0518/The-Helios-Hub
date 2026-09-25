import { JEV_EXCERPT_CHARS } from '@/lib/reels/config';

/**
 * Everything the pipeline scrapes is untrusted input (JEV-06 / D-030). State is
 * always structured so the scraped text sits under an explicitly untrusted key
 * rather than flowing in as free-form prose that could read as instructions.
 */
export type UntrustedText = {
  untrusted_content: string;
};

export function excerpt(text: string, limit = JEV_EXCERPT_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  // Prefer a sentence boundary so the excerpt does not end mid-clause.
  const window = trimmed.slice(0, limit);
  const lastStop = window.lastIndexOf('. ');
  return `${lastStop > limit * 0.5 ? window.slice(0, lastStop + 1) : window}\u2026`;
}

export function untrusted(text: string, limit?: number): UntrustedText {
  return { untrusted_content: excerpt(text, limit) };
}
