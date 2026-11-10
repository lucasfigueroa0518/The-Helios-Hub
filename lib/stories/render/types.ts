/**
 * Stories frame data (plan §6, S-32). A frame is plain JSON from the build:
 * copy, photo, credit, source tag. Templates lay it out; they never call a
 * model. The render review (S-33) may change settings (backdrop, family,
 * layout, photo focus), never the words.
 */

export const FRAME_W = 1080;
export const FRAME_H = 1920;
/** Instagram's own controls: progress bar and account name on top, reply bar below (S-23, plan §6). */
export const SAFE_TOP = 250;
export const SAFE_BOTTOM = 340;
/** Image stories: JPEG, 8 MB max (plan §1, verified facts). */
export const MAX_JPEG_BYTES = 8 * 1024 * 1024;
/** Video stories (AI Trivia): MP4, at most 60 s; Meta's cap on a Story video file is 100 MB. */
export const MAX_MP4_BYTES = 100 * 1024 * 1024;

export const BACKDROPS = ['black', 'white', 'orange', 'green'] as const;
export type Backdrop = (typeof BACKDROPS)[number];

/**
 * `guess_the_number` is retired (AI Trivia AT-14): it stays in the union and the SQL CHECKs so its history still
 * loads, and nothing new is requested, built or rendered for it.
 */
export type Series = 'morning_download' | 'guess_the_number' | 'free_vs_paid' | 'ai_trivia';

export type Photo = {
  /** http(s) URL, or a path inside the repo (served locally by the renderer). */
  src: string;
  /** Credit line drawn on the frame (S-23). */
  credit: string;
  kind: 'person' | 'scene' | 'logo';
  /** Crop centre as object-position fractions (0–1). */
  focus?: { x: number; y: number };
};

/** "via The Verge", "reported by Reuters", "from OpenAI's blog" (S-15). */
export type SourceTag = { verb: 'via' | 'reported by' | 'from'; name: string };

export type OpenerData = { role: 'opener'; /** e.g. "Wednesday, October 8" */ date: string; storyCount: number; photo?: Photo };
export type StoryData = { role: 'story'; /** One or two full sentences (S-15). */ headline: string; source: SourceTag; photo?: Photo };
export type CloserData = { role: 'closer' };
/** Series intro slide (S-50): Free vs. Paid's, fixed copy. */
export type IntroData = { role: 'intro' };
/** AI Trivia (planning/AI Trivia/CONTRACT.md §3): the option count follows the difficulty (hard 2, medium 3, easy 4). */
export type TriviaLetter = 'A' | 'B' | 'C' | 'D';
export type TriviaCopy = {
  question: string;
  difficulty: 'hard' | 'medium' | 'easy';
  options: Array<{ letter: TriviaLetter; text: string }>;
  correct: TriviaLetter;
  /** Why the answer matters to the viewer. */
  answerLine: string;
};
/**
 * AI Trivia's two slides, each a 5-second video (lib/stories/trivia/render): the question, then the answer (the
 * correct option lights). Both carry the whole question; "AI TRIVIA" and "Tap to reveal" are the renderer's (AT-25).
 */
export type QuestionData = { role: 'question'; photo?: Photo } & TriviaCopy;
export type AnswerData = { role: 'answer'; photo?: Photo } & TriviaCopy;
export type PaidData = { role: 'paid'; tool: string; price: string; period: string; tease: string; logo?: Photo };
export type FreeData = {
  role: 'free';
  tool: string;
  /** One plain line on what it does. */
  what: string;
  /** How to get it: "Free download at gimp.org". */
  how: string;
  platforms: string;
  /** The paid tool's price, struck through for contrast. */
  paidPrice: string;
  /** S-08: an occasional developer tool, labeled as one. */
  devTool?: boolean;
  logo?: Photo;
};

export type FrameData = OpenerData | StoryData | CloserData | IntroData | QuestionData | AnswerData | PaidData | FreeData;
export type FrameRole = FrameData['role'];

/**
 * Visual style (S-53, exploration): `polished` is the Helios design system;
 * `homemade` looks typed out in Instagram's own story editor (Classic text,
 * highlight boxes, stickers, pen arrows, emoji). Same data, either style.
 */
export const STYLES = ['polished', 'homemade'] as const;
export type Style = (typeof STYLES)[number];

/** The style each series ships in (S-54): Morning Download and AI Trivia polished, Free vs. Paid homemade. */
export const SERIES_STYLE: Record<Series, Style> = {
  morning_download: 'polished',
  guess_the_number: 'homemade',
  free_vs_paid: 'homemade',
  ai_trivia: 'polished',
};

/** Series whose frames are videos (MP4 + a poster JPEG), not images. */
export const VIDEO_SERIES: ReadonlySet<Series> = new Set<Series>(['ai_trivia']);

export type Frame = {
  series: Series;
  backdrop: Backdrop;
  /** Default polished. */
  style?: Style;
  /** 1-based position in the set, and the set's size. */
  index: number;
  total: number;
  data: FrameData;
};

/** The photo a frame draws, whatever its role. */
export function framePhoto(data: FrameData): Photo | undefined {
  if (data.role === 'closer' || data.role === 'intro') return undefined;
  if (data.role === 'paid' || data.role === 'free') return data.logo;
  return data.photo;
}
