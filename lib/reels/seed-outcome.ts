import type { ReelSeedOutcome } from '@/lib/reels/seeds';

/**
 * What the Text on Screen seed drawer shows for each way a seed click can come out. Pure, and type-only on the server module,
 * so the client component can import it without pulling in the database.
 */

export type SeedOutcomeView =
  | { kind: 'toast'; text: string }
  | { kind: 'duplicate'; existing: { id: string; headline: string; scoreText: string; yours: boolean } }
  | { kind: 'confirm'; text: string; estimateCents: number }
  | { kind: 'none'; text: string };

const cents = (usd: number) => `${Math.round(usd * 100)}¢`;

export function seedOutcomeView(out: ReelSeedOutcome): SeedOutcomeView {
  if (out.status === 'added') {
    const scored = out.scored && out.net != null ? `scored ${out.net.toFixed(2)}` : out.scored ? 'scored, but no bucket cleared its bar' : 'not scored yet';
    return { kind: 'toast', text: `“${out.title}” is in the queue, ${scored}. Nothing was made.${out.flags.length ? ` ${out.flags.join(' ')}` : ''}` };
  }
  if (out.status === 'duplicate') {
    const { id, headline, net, yours } = out.existing;
    return { kind: 'duplicate', existing: { id, headline, scoreText: net == null ? 'not scored' : `scored ${net.toFixed(2)}`, yours } };
  }
  if (out.status === 'needs_paid_confirm') {
    const lead = out.linkUnreadable ? 'I couldn’t read your link, and found no related story' : 'I found no related story';
    return { kind: 'confirm', estimateCents: Math.round(out.estimateUsd * 100), text: `${lead} in what we’ve collected or on Google News. Search the web for it? About ${cents(out.estimateUsd)}, never more than ${cents(out.maxUsd)}.` };
  }
  if (out.reason === 'scoring_unavailable') return { kind: 'none', text: 'Scoring is unavailable right now, so nothing was added. Nothing was spent on a paid search.' };
  return {
    kind: 'none',
    text: out.linkUnreadable
      ? 'I couldn’t read your link and couldn’t find a related story, so nothing was added. Paste a few lines of the story in the text box and try again.'
      : 'I couldn’t find a related story for that headline, so nothing was added. Add your link or a few lines of the story and try again.',
  };
}
