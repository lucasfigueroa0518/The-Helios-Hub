/**
 * Real or AI? shapes (planning/Real or AI/CONTRACT.md §3). Shared by the engine (Builder A, owner of this file),
 * the slides and lab (Builder B) and the plumbing (Builder C). A builder who needs a name that isn't here asks.
 */
import type { PhotoCamera } from '@/lib/photos/types';
import type { Photo } from '@/lib/stories/render/types';

export type Truth = 'real' | 'ai';
export const TRUTHS: readonly Truth[] = ['real', 'ai'];

/** The trap decides the round's truth (TRAP_TRUTH); `twin` makes a real photo and its AI twin. */
export type Trap = 'too_perfect' | 'impossible' | 'mundane' | 'amateur' | 'twin';
export const TRAPS: readonly Trap[] = ['too_perfect', 'impossible', 'mundane', 'amateur', 'twin'];
/**
 * Traps the writer no longer plans (RA-23, Lucas 2026-11-16 lab 2 review: every `mundane` AI image was guessed by both
 * players, five of six marked dead easy). Kept in the type so imported and older rows still read.
 */
export const RETIRED_TRAPS: readonly Trap[] = ['mundane'];
export const WRITER_TRAPS: readonly Trap[] = TRAPS.filter((t) => !RETIRED_TRAPS.includes(t));
/** Subjects never made as AI images, in any trap (RA-23: AI close-ups of food and rooms were the dead-easy rounds). Real photos of them stay. */
export const NO_AI_SUBJECTS: readonly Subject[] = ['food', 'everyday_interiors'];
export const TRAP_TRUTH: Record<Exclude<Trap, 'twin'>, Truth> = {
  too_perfect: 'real',
  impossible: 'real',
  mundane: 'ai',
  amateur: 'ai',
};

export type Subject =
  | 'nature_weather'
  | 'animals'
  | 'cities_architecture'
  | 'food'
  | 'everyday_interiors'
  | 'travel_spots'
  | 'space'
  | 'vehicles'
  | 'crowds_events'
  | 'old_photos';
export const SUBJECTS: readonly Subject[] = [
  'nature_weather',
  'animals',
  'cities_architecture',
  'food',
  'everyday_interiors',
  'travel_spots',
  'space',
  'vehicles',
  'crowds_events',
  'old_photos',
];

/**
 * What the camera recorded (EXIF), for a real reveal's camera card (RA-26). Every field is optional: sources leave
 * gaps, and the photo bank and most NASA files carry none. The shared finder's shape since the Stories Split (SS-22).
 */
export type Camera = PhotoCamera;

export type Provenance =
  | {
      kind: 'bank' | 'commons' | 'nasa';
      url: string;
      licence: string;
      credit: string;
      place?: string;
      year?: string;
      camera?: Camera;
      /** The image URL actually downloaded (SS-23): the photo bank's source URL and the used-photo ledger's key. Absent on older rows. */
      src?: string;
    }
  | { kind: 'generated'; model: string; prompt: string; createdAt: string }
  | { kind: 'dataset'; dataset: string; id: string; model?: string }
  | { kind: 'viral'; url: string; firstSeen?: string; model?: string };

export type RoaCandidate = {
  /** sha1(bytes), first 16 hex: the same image never enters twice. */
  imageKey: string;
  truth: Truth;
  subject: Subject;
  trap: Trap;
  provenance: Provenance;
  /** `roa/candidates/<imageKey>.jpg` in the stories bucket. */
  storagePath: string;
  /** Twin pairs: the AI twin points at its real photo's imageKey. */
  twinOf?: string;
};

/** Image coordinates, 0–1. */
export type TellBox = { x: number; y: number; w: number; h: number };

export type RoaScreen = {
  pass: boolean;
  /** Why it failed: too_dark (code), visible_tell (spotted in a 3-second look), real_person, brand, readable_text, no_clear_subject, off_putting. */
  reasons: string[];
  /** 0–1: the chance a viewer gets it wrong in a 3-second look. */
  difficulty: number;
  /** AI only: a subtle tell found on close inspection (RA-17). Kept from the screen; never drawn since RA-26. */
  tellBox?: TellBox;
  /** Where the subject is (RA-28): the slide text keeps off it. Absent on rows screened before roa-screen@4. */
  subjectBox?: TellBox;
};

/**
 * What the reveal pays off with (RA-26): an AI image we generated shows the prompt that made it. Every other image
 * goes by the effort gap (RA-27 for imported AI): what it took (real) or would have taken (AI) when the gap is large,
 * else a card built by code: the camera card for a real photo, the origin card (model, where it came from) for AI.
 */
export type RoaPayoff = 'prompt' | 'effort' | 'camera' | 'origin';
export const ROA_PAYOFFS: readonly RoaPayoff[] = ['prompt', 'effort', 'camera', 'origin'];

export type RoaPoolPayload = {
  kind: 'roa';
  c: RoaCandidate;
  screen: RoaScreen;
  /** The effort line (payoff `effort`); empty for the other payoffs. */
  reveal: string;
  /** Absent on rows written before RA-26: AI reads as `prompt`, real as `camera`. */
  payoff?: RoaPayoff;
  writtenOn: string;
  /** The reveal line failed open: what is still off about it, shown at approval. */
  revealFlags?: string[];
};

/** The subject in frame pixels after the crop (RA-28, layout.ts): the slide's text keeps off it. */
export type SubjectRect = { top: number; bottom: number; left: number; right: number };

export type RoaQuestionData = { role: 'roa_question'; round: 1 | 2; photo: Photo; subject?: SubjectRect };
export type RoaRevealData = {
  role: 'roa_reveal';
  round: 1 | 2;
  photo: Photo;
  subject?: SubjectRect;
  truth: Truth;
  payoff: RoaPayoff;
  /** `effort` only: what it took (real) or would have taken (AI) to get the shot, ≤ 10 words, ≤ 70 chars (RA-13). */
  line?: string;
  /** `prompt` only: the prompt that made the image, ≤ 25 words. */
  prompt?: string;
  /** `camera` and `origin` only: the card, already worded. */
  receipt?: Receipt;
  /** ≤ 60 chars. Real: "place, year · credit"; AI: the model or source. */
  proof: string;
};

/** The camera or origin card: a small heading and up to three rows. */
export type Receipt = { head: string; rows: string[] };

export type RoaRound = { key: string; truth: Truth; difficulty: number; provenance: Provenance };
export type RoaSetPayload = { rounds: RoaRound[] };

export const ROA_SERIES = 'real_or_ai' as const;
export const ROA_KEY_PREFIX = 'roa:';
export const roaPoolKey = (imageKey: string) => `${ROA_KEY_PREFIX}${imageKey}`;
export const roaStoragePath = (imageKey: string) => `roa/candidates/${imageKey}.jpg`;
/** The pool holds at most this many open candidates. */
export const ROA_POOL_CAP = 20;
/** Candidates made per pool day (RA-16). */
export const ROA_PER_DAY = 4;
/** Rounds per set (RA-9). */
export const ROA_ROUNDS = 2;
/** The swipe lab: the engine passes a batch when Lucas scores at or below this (RA-7). */
export const ROA_LAB_PASS = 0.62;
export const ROA_LAB_BATCH = 20;
/** Each image shows this long in the lab before the buttons appear. */
export const ROA_LAB_VIEW_MS = 3000;
export const ROA_REVEAL_MAX_WORDS = 10;
export const ROA_REVEAL_MAX_CHARS = 70;
export const ROA_PROMPT_MAX_WORDS = 25;
export const ROA_PROOF_MAX_CHARS = 60;
