/**
 * Jev grades each candidate photo against the story's brief (MD-LFD D18/D19/D21, 2026-11-23). Questions, scale and
 * tier rule copied verbatim from scripts/photo-vision-test.ts (PHOTO_QUESTIONS, THUMBNAIL_CUTOFF, tier) and the grade
 * call from scripts/md-photo-trial.ts grade(). Jev isn't asked ai_made (D19): Haiku's lenient check on the pick covers it.
 */
import { choice, image, noul, type Questions } from '@typesafe-ai/sdk';

import { jevCostUsd } from '@/lib/social/jev/client';

import type { PhotoBrief } from './brief';
import type { Candidate } from './candidates';

import type { MediaVerdict } from '@/lib/news-ranker/posts';
export type { MediaVerdict };

/** The Jev client's one call (TypeSafeClient.systemOne, header TypeSafe-Danger-Zone-Images). */
export type PhotoJev = { systemOne: (...a: any[]) => Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The photo questions, shared word for word by both graders. */
export const PHOTO_QUESTIONS = {
  logo: 'Is the main content of the picture a logo, wordmark or brand mark, rather than a scene, person, object or screen?',
  ai_made: 'Was this picture made by an AI image generator, rather than being a real photograph, a real screenshot or a human-made drawing?',
  thumbnail: 'Is this a thumbnail: a graphic built to win a click on a video or article, such as cut-out people or reaction faces pasted onto a designed background, big bold title text, or panels and logos layered around a person?',
  overlay: 'Does the picture carry a watermark, a TV channel logo, or text from another outlet such as a headline or caption baked into the image?',
  specific: "Does the picture show the brief's subject itself, specifically and recognizably?",
  related: 'Is the picture at least related to the story: the same person, product, company, place or event, even if not its specific subject?',
  clarity: 'How clear is the picture at phone size: one readable subject, well lit, not cluttered? One is unreadable; ten is instantly clear.',
} as const;

export const THUMBNAIL_CUTOFF = 0.7;
export type Answers = { logo: number; ai_made: number; overlay: number; thumbnail?: number; specific: number; related: number; clarity: number };

/** The tier rule (D17/D18): rejections first, then specific → good, related → usable. Yes/no answers are probabilities. */
export function tier(a: Answers): MediaVerdict {
  // Lucas, 2026-11-23: "thumbnails can NEVER be used". At 0.7 Jev caught all 17 of Opus's thumbnails in 171 trial
  // images, with 3 false rejections (thumbs/ in the lab); a miss costs more than a lost candidate.
  if (a.logo >= 0.5 || a.ai_made >= 0.5 || a.overlay >= 0.5 || (a.thumbnail ?? 0) >= THUMBNAIL_CUTOFF) return 'none';
  if (a.specific >= 0.5 && a.clarity >= 6) return 'good';
  if ((a.specific >= 0.5 || a.related >= 0.5) && a.clarity >= 5) return 'usable';
  return 'none';
}

/** A fetched candidate: the graded JPEG (≤1024 px) and its size. */
export type FetchedCandidate = Candidate & { jpeg: Buffer; width: number; height: number };
export type GradedPhoto = Candidate & { tier: MediaVerdict; clarity: number; jpeg: Buffer; width: number; height: number };
export type GradeOutcome = { photo: GradedPhoto; answers: Omit<Answers, 'ai_made'> | null; costUsd: number };

/** The Jev question set for one grade (md-photo-trial.ts grade(), verbatim labels). */
export function gradeQuestions(): Questions {
  const scale: Record<string, string> = {};
  for (let k = 1; k <= 10; k++) scale[String(k)] = k === 1 ? 'Unreadable at phone size' : k === 10 ? 'Instantly clear' : `Clarity ${k} of ten`;
  return {
    logo: noul(PHOTO_QUESTIONS.logo, { true: 'A logo or brand mark is the main content', false: 'A scene, person, object or screen' }),
    thumbnail: noul(PHOTO_QUESTIONS.thumbnail, { true: 'A click-bait thumbnail graphic', false: 'A photo, screenshot or plain image' }),
    overlay: noul(PHOTO_QUESTIONS.overlay, { true: 'Carries a watermark, channel logo or another outlet’s text', false: 'Clean' }),
    specific: noul(PHOTO_QUESTIONS.specific, { true: "Shows the brief's subject itself", false: "Does not show the brief's subject" }),
    related: noul(PHOTO_QUESTIONS.related, { true: 'Related to the story', false: 'Unrelated to the story' }),
    clarity: choice(PHOTO_QUESTIONS.clarity, scale),
  } as unknown as Questions;
}

/** Grade one candidate; two attempts, then `none` (as the lab). */
export async function gradePhoto(c: FetchedCandidate, headline: string, b: PhotoBrief, jev: PhotoJev): Promise<GradeOutcome> {
  const qs = gradeQuestions();
  let costUsd = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await jev.systemOne({ state: { context: `Story headline: ${headline}\nPhoto brief: ${b.subject} (${b.good_if})`, picture: image(c.jpeg) }, questions: qs });
      costUsd += jevCostUsd({ input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0 });
      const r = res.answers as Record<string, { noul?: number; probabilities?: Record<string, number> }>;
      let tot = 0, ev = 0;
      for (const [k, p] of Object.entries(r.clarity!.probabilities ?? {})) { tot += p; ev += Number(k) * p; }
      const a = { logo: r.logo!.noul!, overlay: r.overlay!.noul!, thumbnail: r.thumbnail!.noul!, specific: r.specific!.noul!, related: r.related!.noul!, clarity: tot ? ev / tot : 0 };
      return { photo: { ...c, tier: tier({ ...a, ai_made: 0 }), clarity: a.clarity }, answers: a, costUsd };
    } catch { /* retry */ }
  }
  return { photo: { ...c, tier: 'none', clarity: 0 }, answers: null, costUsd };
}
