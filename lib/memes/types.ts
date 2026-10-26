/**
 * Shapes for the meme lab (planning/Memes/BUILD_PLAN.md). The catalog and the
 * situations are approved data (planning/Memes/TEMPLATE_CARDS.md,
 * AUDIENCE_SITUATIONS.md); code reads them from lib/memes/catalog.ts and
 * lib/memes/situations.ts.
 */

/** What a slot accepts (TEMPLATE_CARDS.md): a blue-chip player, a factual line, or a viewer line. */
export type SlotKind = 'entity' | 'text' | 'viewer';

export type TemplateSlot = {
  id: string;
  /** Where it sits in the image, in words (the card's own). */
  where: string;
  /** What it holds. */
  role: string;
  /**
   * What the content must do to play this slot's role (meme-writer@2): the
   * writer is held to it, and a judge checks each slot against it. Written
   * from the approved role; no new meaning.
   */
  must?: string;
  /**
   * The format's own line, printed by code around the writer's part `{x}`
   * ("You guys are getting {x}?"). The writer fills only `{x}`, so the line
   * the joke depends on can't be dropped. On a derived slot it wraps the
   * source slot's `{x}` (Oprah's "You get {x}!" above "Everybody gets {x}!").
   */
  pattern?: string;
  /** Kinds the writer may fill it with; empty for a slot code fills (fixed or derived). */
  accepts: readonly SlotKind[];
  /** The writer may leave it empty. */
  optional?: boolean;
  /** Code renders this text; the writer never fills it. */
  fixed?: string;
  /** An optional writable slot prints this when the writer leaves it empty (Absolute Cinema's "CINEMA"). */
  fallback?: string;
  /** Code fills it from another slot: the same fill (a repeat) or a transform of its text. */
  derived?: { from: string; as: 'repeat' | 'mocking-case' | 'everywhere' };
};

export type TemplateCard = {
  /** Our slug. */
  id: string;
  imgflipId: string;
  name: string;
  /** Imgflip rank on 2026-10-13, the order of TEMPLATE_CARDS.md. */
  rank: number;
  /** Image file under lib/memes/assets/templates/. */
  image: string;
  width: number;
  height: number;
  logic: string;
  slots: readonly TemplateSlot[];
  situations: readonly string[];
  landscape: boolean;
  /** Know Your Meme entry: the 90-day cooldown's family key (ME-45). Confirmed at intake. */
  family: string;
  burnedIn: string | null;
  watch: string;
};

export type ExcludedTemplate = { imgflipId: string; name: string; rank: number; why: string; rule: string };

export type Audience = 'everyday' | 'builder';

export type Situation = {
  id: string;
  name: string;
  audience: Audience;
  feeling: string;
  broughtUpBy: string;
  /** The viewer line pattern; a bracket is filled from the story's facts. */
  viewerLine: string;
  shapes: readonly string[];
  keepClearOf: string;
};
