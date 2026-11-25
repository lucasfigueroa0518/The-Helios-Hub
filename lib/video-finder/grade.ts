/**
 * Video finder grading (lab, 2026-11-23). Jev answers the same yes/no questions about each sampled
 * frame; code turns the answers into a verdict and a clip window. Lucas's bar: raw b-roll or actual
 * footage of the event, never a news report, reaction or commentary video. Watermarks are fine,
 * so nothing here asks about them.
 *
 * The aggregation (frameOk, onSubject, judgeFrames, pickWindow, clipTier) is pure and tested offline.
 */
import { image, noul, type Questions } from '@typesafe-ai/sdk';

export const FRAME_QUESTIONS = {
  news: 'Is this frame from a news broadcast or a news report: a presenter or anchor, a news studio, an on-screen caption bar naming a person or story, or a reporter speaking to the camera?',
  commentary: 'Is this frame from a reaction or commentary video: someone talking to the camera about a topic, a face in a corner over other footage, or slides and graphics explaining something?',
  card: 'Is this frame mostly text, a title card, a logo animation, a designed graphic, or a blank or dark screen? A product’s own screen shown in use, such as an app or website being operated, is not a card.',
  raw: 'Is this frame real footage, meaning a camera recording of a real scene or event or a product’s own screen recording, rather than people presenting or talking about it?',
  speaker: 'Is this frame an interview, a panel, a speech or presentation on stage, or someone addressing the camera, rather than a scene of people doing something?',
  specific: 'Does this frame visibly show what the footage brief describes, the story’s own subject, rather than something only related to the topic?',
} as const;

export type FrameKey = keyof typeof FRAME_QUESTIONS;
export type FrameAnswers = Record<FrameKey, number>;

export function frameQuestions(): Questions {
  return {
    news: noul(FRAME_QUESTIONS.news, { true: 'A news report frame', false: 'Not a news report frame' }),
    commentary: noul(FRAME_QUESTIONS.commentary, { true: 'Reaction or commentary', false: 'Not reaction or commentary' }),
    card: noul(FRAME_QUESTIONS.card, { true: 'Text, graphic or blank', false: 'A real picture' }),
    raw: noul(FRAME_QUESTIONS.raw, { true: 'Real footage', false: 'Presenting, talking or graphics' }),
    speaker: noul(FRAME_QUESTIONS.speaker, { true: 'People talking', false: 'Not mainly people talking' }),
    specific: noul(FRAME_QUESTIONS.specific, { true: "Shows the brief's subject", false: "Does not show the brief's subject" }),
  } as unknown as Questions;
}

export function frameState(context: string, jpeg: Buffer) {
  return { context, picture: image(jpeg) };
}

/**
 * Frames that mark the whole video as a report or commentary. A news-looking frame that is still real
 * footage (burned-in captions, a channel bug over b-roll) is footage, not a report: watermarks are fine.
 * Talking heads (interviews, panels, stage talks) are never footage (Lucas, 2026-11-23: straight b-roll only).
 */
export const reportish = (f: FrameAnswers) => (f.news >= 0.5 && f.raw < 0.5) || f.commentary >= 0.5 || f.speaker >= 0.5;
/** A frame that is real footage and not a report, commentary or card. */
export const frameOk = (f: FrameAnswers) => f.raw >= 0.5 && f.card < 0.5 && !reportish(f);
/** Bar on `specific`: lower when the video's own title or the article already ties it to the story. */
export const SPECIFIC_BAR = 0.5;
export const SPECIFIC_BAR_MATCHED = 0.3;
/** Real footage that shows the story's own subject. */
export const onSubject = (f: FrameAnswers, bar = SPECIFIC_BAR) => frameOk(f) && f.specific >= bar;

export type FrameVerdict = { reject: string | null; onSubject: number; reports: number; run: [number, number] | null };

/**
 * Where in the source the usable footage is (null answers = frame failed to grade). The source video as a whole is
 * not judged: a news package or talk often holds a stretch of raw footage, and only the trimmed clip is posted.
 * Report, talking and commentary frames are simply not footage, so the run never includes them.
 */
export function judgeFrames(frames: (FrameAnswers | null)[], bar = SPECIFIC_BAR): FrameVerdict {
  const ok = frames.filter((f): f is FrameAnswers => Boolean(f));
  const reports = ok.filter(reportish).length;
  if (ok.length < 3) return { reject: 'too few frames graded', onSubject: 0, reports, run: null };
  // Longest run of consecutive on-subject frames; ties go to the higher mean `specific`.
  let best: [number, number] | null = null, bestScore = -1;
  for (let i = 0; i < frames.length; i++) {
    let j = i;
    while (j < frames.length && frames[j] && onSubject(frames[j]!, bar)) j++;
    if (j > i) {
      const len = j - i;
      const mean = frames.slice(i, j).reduce((s, f) => s + f!.specific, 0) / len;
      const score = len + mean / 10;
      if (score > bestScore) { best = [i, j - 1]; bestScore = score; }
      i = j;
    }
  }
  return { reject: best ? null : 'no frame shows the subject as real footage', onSubject: ok.filter((f) => onSubject(f, bar)).length, reports, run: best };
}

/** The clip window for a run of frames at `times`: centred on the run, 5–10 s, inside the video. */
export function pickWindow(times: number[], run: [number, number], duration: number): { start: number; len: number } {
  const gap = times.length > 1 ? times[1]! - times[0]! : duration;
  const from = Math.max(0, times[run[0]]! - gap / 2);
  const to = Math.min(duration, times[run[1]]! + gap / 2);
  const len = Math.min(10, Math.max(5, to - from), duration);
  const centre = (from + to) / 2;
  const start = Math.max(0, Math.min(duration - len, centre - len / 2));
  return { start: Math.round(start * 10) / 10, len: Math.round(len * 10) / 10 };
}

export type Tier = 'golden' | 'good' | 'none';

/**
 * Final tier, judged on the trimmed clip (its three check frames), which is what gets posted.
 * Golden: every check frame is clean footage of the subject. Lucas: "a story with a great video is GOLDEN"; only
 * golden clips promote a story. Good: two of three check frames are, and at most one looks like a report.
 */
export function clipTier(v: FrameVerdict, check: (FrameAnswers | null)[], bar = SPECIFIC_BAR): Tier {
  if (v.reject || !v.run) return 'none';
  const graded = check.filter((f): f is FrameAnswers => Boolean(f));
  if (graded.length < 3) return 'none';
  const reports = graded.filter(reportish).length;
  const pass = graded.filter((f) => onSubject(f, bar)).length;
  if (reports === 0 && pass === graded.length) return 'golden';
  if (reports <= 1 && pass >= 2) return 'good';
  return 'none';
}
