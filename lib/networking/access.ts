import { INVITE_KEYWORDS, haystackOf, matchesAny } from '@/lib/networking/taxonomy';
import type { AccessType, CandidateEvent } from '@/lib/networking/types';

export type AccessInference = {
  access: AccessType;
  evidence: string | null;
};

export function inferAccess(candidate: CandidateEvent): AccessInference {
  const hay = haystackOf([
    candidate.title,
    candidate.description,
    candidate.hostName,
    candidate.priceText,
  ]);

  if (matchesAny(hay, INVITE_KEYWORDS)) {
    return { access: 'invite_only', evidence: 'invite/approval language' };
  }

  if (candidate.priceAmount != null && candidate.priceAmount > 0) {
    return { access: 'paid', evidence: `price ${candidate.priceAmount}` };
  }

  if (candidate.isFree === true) {
    return { access: 'open', evidence: 'marked free' };
  }

  if (candidate.priceText) {
    const text = candidate.priceText.toLowerCase();
    if (/free|\$0|no cost/.test(text)) {
      return { access: 'open', evidence: candidate.priceText };
    }
    if (/\$\s*\d|tickets? from|usd|eur/.test(text)) {
      return { access: 'paid', evidence: candidate.priceText };
    }
  }

  if (candidate.url) {
    return { access: 'open', evidence: 'public rsvp url' };
  }

  return { access: 'open', evidence: null };
}
