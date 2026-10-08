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

export const BACKDROPS = ['black', 'white', 'orange', 'green'] as const;
export type Backdrop = (typeof BACKDROPS)[number];

export type Series = 'morning_download' | 'guess_the_number' | 'free_vs_paid';

/**
 * Guess the Number layout families (S-13). Every photo is a bleed fade (S-44):
 * photo-led (the photo bleeds from the top), marquee (the game line on top,
 * the photo fading in below it), type-led (no photo).
 */
export const GTN_FAMILIES = ['photo', 'marquee', 'type'] as const;
export type GtnFamily = (typeof GTN_FAMILIES)[number];

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
/** Guess the Number's intro (S-49): today's game, its difficulty and topic. */
export const DIFFICULTIES = ['low', 'medium', 'high'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
/**
 * Series intro slide (S-49, S-50). Guess the Number's carries the difficulty
 * and the model-written topic; Free vs. Paid's is fixed copy.
 */
export type IntroData = { role: 'intro'; difficulty?: Difficulty; topic?: string };
export type QuestionData = { role: 'question'; family: GtnFamily; question: string; photo?: Photo };
export type AnswerData = { role: 'answer'; family: GtnFamily; number: string; label: string; meaning: string; source: SourceTag; photo?: Photo };
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

export type Frame = {
  series: Series;
  backdrop: Backdrop;
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
