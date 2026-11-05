/**
 * Reel AI Drama — the shared types every part of the pipeline reads and writes (CONTRACT.md).
 * Decisions: planning/AI Mini Docs/PLAN.md (MD-xx). Change a type here only through the contract.
 */

export type Mode = 'development' | 'production';

// ── Development (PROCESS.md D1–D7) ──────────────────────────────────────────

/** Story types about how the AI world was built (MD-26). Keys are stable; labels are for prompts and the lab. */
export const STORY_TYPES = {
  founding_moment: 'Founding moments: the meetings and decisions where companies and labs began',
  big_bet: 'Big bets and near-death moments',
  power_struggle: 'Boardroom power struggles and firings',
  rivalry: 'Rivalries and feuds',
  talent_war: 'Talent wars, defections and exoduses',
  deal: 'Deals made, and deals refused',
  breakthrough: 'Breakthroughs and the people behind them',
  launch: 'Launches that changed everything',
  missed_chance: 'Missed chances: who had it first and let it go',
  principles: 'Principles kept and broken: charters, ethics boards, nonprofit to for-profit',
  courtroom: 'Courtrooms, hearings and regulators',
  failure: 'Flops, crises and public failures',
  comeback: 'Comebacks',
  prediction: 'Predictions that came true, or famously didn\'t',
} as const;
export type StoryType = keyof typeof STORY_TYPES;

/** Eras of the AI world; a cell is player × story type × era. */
export const ERAS = {
  origins: 'Before 2015: the people and labs before the boom',
  early_labs: '2015–2019: the early labs',
  scale_up: '2019–2022: scaling up, before chatbots went mainstream',
  race: 'Late 2022–2024: the race after chatbots went mainstream',
  now: '2025 to today',
} as const;
export type Era = keyof typeof ERAS;

/** Kinds of real visual a documentary can use (research 04; MD-03). */
export const VISUAL_KINDS = [
  'person_photo',
  'event_photo',
  'place_photo',
  'product',
  'logo',
  'map',
  'web_page',
  'social_post',
  'document',
  'paper',
  'chart',
  'video_frame',
  'headline',
  'archival',
  'object',
] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

export type CastMember = {
  name: string;
  role: string;
  /** MD-135: a product (Siri, Alexa) is a player like a person or a company. */
  kind: 'person' | 'company' | 'product';
  /** BluePlayer.id when the member is on the central blue-chip list, else null. */
  player_id: string | null;
  /** What they want in this story. Pitches before iteration 5 only (MD-100: the brief carries the story). */
  want?: string;
};

export type SourceRef = { url: string; title: string; publisher: string; date: string | null };

export type ExpectedVisual = { kind: VisualKind; what: string; hint: string };

/**
 * One story idea from the development producer (D2). Iteration 5 (MD-100): the story is one prose `brief`;
 * the producer no longer writes logline, pitch, story question, end point, turn, engine, scene, implication
 * or central figure. Those stay optional for rows written before it; read the story through `pitchBrief`
 * and the central person through `pitchCentral`.
 */
export type Pitch = {
  title: string;
  /** Prose, about 120–180 words: who, what, when, the main tension, what to focus on, why it mattered (MD-100). */
  brief: string;
  /** A search lens only (MD-105): it never reaches the writer. */
  story_type: StoryType;
  era: Era;
  /** YYYY-MM-DD; month or year precision uses the first day and `date_precision`. */
  event_date: string | null;
  date_precision: 'day' | 'month' | 'year';
  /** The people and companies in the story, the most central first (`pitchCentral`). */
  cast: CastMember[];
  /** A fresh development that makes it timely, or null (MD-09, MD-32). */
  why_now: string | null;
  expected_visuals: ExpectedVisual[];
  sources: SourceRef[];
  // ── Pitches before iteration 5 only ──
  logline?: string;
  pitch?: string;
  central_figure?: string;
  scene?: string;
  turn?: string;
  implication?: string;
  story_question?: string | null;
  end_point?: string | null;
  engine?: string;
};

/** The pitch's story in prose: the brief, or (a pitch before iteration 5) its old pitch text. */
export function pitchBrief(p: Pick<Pitch, 'brief' | 'pitch' | 'logline'> | null | undefined): string {
  return (p?.brief?.trim() || p?.pitch?.trim() || p?.logline?.trim() || '').trim();
}

/**
 * The pitch's central person: the old `central_figure` when a pitch has one, else the first person in the
 * cast (the producer lists the most central first), else the first cast member; '' when there is no cast.
 */
export function pitchCentral(p: Pick<Pitch, 'cast' | 'central_figure'>): string {
  if (p.central_figure?.trim()) return p.central_figure.trim();
  const cast = p.cast ?? [];
  return (cast.find((c) => c.kind === 'person') ?? cast[0])?.name ?? '';
}

export type Score = { score: number; notes: Record<string, string> };

export type VisualsGrade = 'green' | 'amber' | 'red';

/** The cheap visuals check's result (D6; MD-22, research 04). */
export type VisualsCard = {
  grade: VisualsGrade;
  faces: { name: string; found: boolean; count: number }[];
  /** Visuals specific to this story (not generic photos of the people). */
  specific_count: number;
  kinds: VisualKind[];
  counts: Partial<Record<VisualKind, number>>;
  gaps: string[];
  sample: { url: string; kind: VisualKind; what: string }[];
  usd: number;
};

export type PitchStatus = 'new' | 'duplicate' | 'rejected' | 'pooled' | 'picked' | 'made' | 'killed' | 'retired';

export type PitchRow = {
  id: string;
  session_id: string | null;
  cell_id: string | null;
  origin: 'producer' | 'seed' | 'calibration';
  title: string;
  pitch: Pitch;
  event_key: string;
  event_date: string | null;
  central_player_id: string | null;
  status: PitchStatus;
  duplicate_of: string | null;
  reject_reason: string | null;
  revive_when: string | null;
  drama: Score | null;
  drama_score: number | null;
  material: Score | null;
  material_score: number | null;
  visuals_card: VisualsCard | null;
  visuals_grade: VisualsGrade | null;
  rank_score: number | null;
  created_at: string;
  updated_at: string;
  made_at: string | null;
};

// ── Reporting (P2) ──────────────────────────────────────────────────────────

export type FactSheet = {
  summary: string;
  timeline: { date: string; event: string; fact_ids: string[] }[];
  facts: {
    id: string; // F1, F2…
    text: string;
    source_ids: string[];
    /** A claim the story turns on (needs two independent sources, D-61 rewrite). */
    key: boolean;
    /** The story's core: the central figure's want, the scene or the turn. Unconfirmed, it kills the story (MD-31). */
    core?: boolean;
    confidence: 'confirmed' | 'single_source' | 'disputed';
  }[];
  sources: { id: string; url: string; title: string; publisher: string; date: string | null; kind: string }[];
  /** `verified: false` (set by code): the source page was never fetched, so the wording is unchecked and never shown as verbatim. */
  quotes: { id: string; speaker: string; text: string; source_id: string; date: string | null; context: string; verified?: boolean }[];
  artifacts: {
    id: string; // A1…
    kind: 'post' | 'statement' | 'document' | 'headline' | 'paper' | 'filing' | 'other';
    text: string; // verbatim
    source_id: string;
    url: string | null;
    date: string | null;
    /** False (set by code) when the source page was never fetched: never shown as verbatim. */
    verified?: boolean;
  }[];
  /**
   * The larger context (MD-119), optional on old sheets: `role` is what they were at the time of the story,
   * `background` who they were before (a company: what it was beyond this story), `later` what they did
   * after or are now, as of the reporter's today. `context_fact_ids` are the facts that source the member's
   * line; a context fact is an ordinary fact, so the writer cites it like any other.
   */
  cast: (CastMember & { qid: string | null; background?: string | null; later?: string | null; context_fact_ids?: string[] })[];
  /** `fact_ids` (optional on old sheets): the facts that place it in the story. */
  places: { name: string; address: string | null; lat: number | null; lon: number | null; role: string; fact_ids?: string[] }[];
  /**
   * Places and people relative to each other (near, across from, same week as, rival of, works for), so the
   * setup can place every new part against one already set (iteration 4, S2). Optional on old sheets.
   */
  relations?: { a: string; relation: string; b: string; fact_ids: string[] }[];
  /** False kills the story (MD-31). */
  verdict: { holds: boolean; reason: string };
};

// ── Media harvest (P3) ──────────────────────────────────────────────────────

/** A coarse grid over a picture, row by row. Shape cells are '0' | '1'; tone cells one hex digit of luminance, '.' where it is transparent. */
export type PictureGrid = { w: number; h: number; cells: string };
/** A detected face box, 0–1 of the image. `score`: the detector's confidence. `trusted`: only a trusted face may be a head. */
export type PictureFace = { x: number; y: number; w: number; h: number; score?: number; trusted?: boolean; name?: string };
/** How well a cutout was cut (harvest/transparent.ts). Each measure 0–1. A `rejected` cut is never offered as a cutout. */
export type PictureCut = { grade: 'clean' | 'rough' | 'rejected'; edge_softness: number; islands: number; straight_cuts: number; sharpness: number; fringe?: number; /** Cleaned with the photo it came from in hand. */ with_source?: boolean };
/**
 * A picture's measured pixels (iteration 9, 10), 0–1 of the image unless named otherwise. Free and local, once per asset;
 * every field optional, so older inventories load (their `visible`, `shape` and `tone` were always there).
 *   chip           a logo whose background can't be keyed
 *   faces          main face first
 *   cut            cutouts only
 *   open_edges     the cutout's picture stops at that image border
 *   sharp_width_px the widest it may be drawn on the 1080-wide frame and stay sharp
 *   phash, dup_of  perceptual hash; the asset id of the near-identical picture this one repeats, or null
 *   brightness     mean luminance
 *   expression     short plain words from the look step, or null
 */
export type PictureRegions = {
  visible: { x: number; y: number; w: number; h: number };
  shape: PictureGrid;
  tone: PictureGrid;
  chip?: boolean;
  /** How far from grey a logo's ink is, 0–1: under a little, it's a one-colour mark that can take any ink. */
  chroma?: number;
  /** Where a picture's subject is, from its own pixels: what a piece over it stands clear of. */
  focus?: { x: number; y: number; w: number; h: number } | null;
  /** Where to crop to lose a block of words the picture's own top or bottom edge cuts through. */
  edge_cut?: { top?: number; bottom?: number };
  faces?: PictureFace[];
  cut?: PictureCut;
  open_edges?: { left: boolean; right: boolean; top: boolean; bottom: boolean };
  sharp_width_px?: number;
  phash?: string;
  dup_of?: string | null;
  brightness?: number;
  expression?: string | null;
};

export type Asset = {
  id: string; // V1, V2…
  kind: VisualKind;
  /** Path relative to the job dir (e.g. media/V1.jpg). */
  file: string;
  url: string | null;
  source_page: string | null;
  credit: string;
  license: string | null;
  /** One plain sentence: what the image actually shows (integrity check reads this). */
  shows: string;
  people: string[];
  qids: string[];
  place: string | null;
  date_taken: string | null;
  date_confidence: 'exact' | 'approximate' | 'unknown';
  width: number;
  height: number;
  phash: string | null;
  /** A person's banked character image (MD-41): may repeat through the story. */
  character_image: boolean;
  /** Made by code (screenshot, map render, drawing) rather than found. */
  made: boolean;
  upscaled: boolean;
  flags: string[];
  /** The cast name this is the anchor portrait of: it recurs through the reel (MD-60). */
  anchor_for?: string | null;
  /** Normalised 0–1 box of the main face, so crops keep the face (not "a shot of his shirt"). */
  face?: { x: number; y: number; w: number; h: number } | null;
  /** What kind of made asset this is (MD-14, MD-59); null for found media. */
  made_kind?: 'sketch' | 'setting' | 'expression' | 'collage' | 'drawing' | null;
  /** Iteration 9: what code measured on the real pixels (harvest/regions.ts); the kit's stage places pictures from it. */
  regions?: PictureRegions;
};

export type VisualsInventory = {
  assets: Asset[];
  usable_count: number;
  counts: Partial<Record<VisualKind, number>>;
  /** Set when the harvest kills the story (MD-31, MD-33). */
  kill: { reason: string } | null;
  usd: number;
};

// ── Writing (P4) and directing (P5) ────────────────────────────────────────

export type ScriptLine = {
  id: string; // L1…
  /** Spoken narration (what the voice says and the captions show, MD-15). */
  text: string;
  /** Short on-screen words beyond captions (names, dates, numbers), or null. */
  on_screen: string | null;
  /**
   * 'date' when the label is a date (MD-130; `L1`'s always is), else null. The kit styles date labels more
   * prominently (it gets this as `label_kind`). Optional: scripts saved before iteration 7 don't carry it.
   */
  on_screen_kind?: 'date' | null;
  fact_ids: string[];
  /** An asset id or plain description the line depends on seeing, or null (W-96 rewrite). */
  must_show: string | null;
  /** A silent picture beat after the line, in seconds (0–1), or null (W-130). The line ends its frame. */
  pause_after?: number | null;
};

/**
 * The blind story editor's notes (MD-102). It reads only the script (each line's id, narration and on-screen
 * words), retells it, and names what loses or confuses a first-time viewer: at most five notes, each on the
 * lines it names. The writer rewrites once; the notes ship as story flags.
 */
export type StoryNotes = { tell_back: string; notes: { lines: string[]; note: string }[] };

export type WriterDraft = {
  title: string;
  /** The hook: on screen within 1.5s, usually from the first frame (MD-34). */
  hook: { on_screen: string; line_id: string };
  /** `purpose`: what the rung does in the story. */
  rungs: { id: string; purpose: string; lines: ScriptLine[] }[];
  /** The rung where the tension peaks (any position; the music lands there). */
  peak_rung_id: string;
  landing_rung_id: string;
  /** Spoken and captioned over the brand close (S-33, MD-18). */
  close_question: string;
  word_count: number;
  /** How the voice says names it would get wrong (TTS text only; captions keep the spelling). */
  pronounce?: { word: string; say: string }[];
  /** The cast names central to the story, as the facts name them: they get cutouts (MD-100). */
  central: string[];
  /** Drafts saved before iteration 5 named the peak this way; read it through `peakRungId`. */
  turn_rung_id?: string;
};

/** The rung where the tension peaks: `peak_rung_id`, or a saved draft's old `turn_rung_id`. */
export function peakRungId(draft: Pick<WriterDraft, 'peak_rung_id' | 'turn_rung_id'>): string {
  return draft.peak_rung_id ?? draft.turn_rung_id ?? '';
}

/** What a frame's focus is (MD-131): the kind of thing the eye lands on first. */
export const FOCUS_KINDS = ['person', 'place', 'object', 'logo', 'document', 'number', 'animation'] as const;
export type FocusKind = (typeof FOCUS_KINDS)[number];

/** One frame of the director's storyboard (written as STORYBOARD.md by the kit's project-files writer). */
/** The exact spoken words a thing lands on, in the frame's voice; '' is the frame's start (ITERATION-10). */
export type BlueprintWords = string;

/** What a frame is, in fields: code compiles this into the frame (ITERATION-10-CONTRACT §4). */
export type Blueprint = {
  ground: string;
  style: 'cutouts' | 'paper';
  arrangement: 'face_off' | 'lead_inset' | 'row' | 'pile' | 'facing' | 'turned_away' | 'leads_to' | 'solo';
  hook?: { text: string; on: BlueprintWords };
  peak?: boolean;
  pieces: {
    id: string;
    asset?: string;
    treatment?: string;
    opts?: Record<string, unknown>;
    fill?: boolean;
    note?: string;
    note_role?: 'figure' | 'place' | 'date' | 'body';
    role?: 'lead';
    side?: 'left' | 'right';
    belongs?: string;
    onto?: { piece: string; box: string };
    /** Iteration 11: the solver's exact geometry, px on the 1080x1920 frame. The layout treats the piece as fixed. */
    place?: { x: number; y: number; w: number; rotate?: number; z?: number };
    crop?: { x: number; y: number; w: number; h: number };
    on: BlueprintWords;
    until?: BlueprintWords;
    label?: string;
  }[];
  labels: { text: string; sub?: string; kind?: string; for?: string; on: BlueprintWords }[];
  speech: { on_piece: string; text: string; on: BlueprintWords; until?: BlueprintWords }[];
  marks: { kind: string; on_piece: string; target?: string; from?: string; on: BlueprintWords }[];
  arrows: { from: string; to: string; on: BlueprintWords }[];
  camera: { move: 'hold' | 'push' | 'drift' | 'slide' | 'tour'; stops: { on: BlueprintWords; aim: string; zoom?: number }[] };
  ground_tone?: { on: BlueprintWords; to: number }[];
  sounds: { kind: string; what: string; on: BlueprintWords; dur?: number }[];
};

/** What the creative pass may add to a frame (ITERATION-10-CONTRACT §5). Touches only add. */
export type Touch = { id: string; frame: number; why: string } & (
  | { type: 'extra_line'; text: string; for?: string; on: BlueprintWords }
  | { type: 'in_turn'; piece_ids: string[]; from: BlueprintWords; to: BlueprintWords }
  | { type: 'closer_cuts'; aim: string; on: BlueprintWords[] }
  | { type: 'mark'; kind: string; on_piece: string; target?: string; on: BlueprintWords }
  | { type: 'ground_tone'; on: BlueprintWords; to: number }
  | { type: 'sound'; kind: string; what: string; on: BlueprintWords; dur?: number }
);
/** A small piece of code in a box the layout assigns; it can touch nothing else (assets/custom/<id>.js). */
export type CustomPiece = { id: string; frame: number; why: string; aspect: number; min_width: number; on: BlueprintWords; until?: BlueprintWords; code: string };
/** assets/touches.json. */
export type Touches = { touches: Touch[]; custom: CustomPiece[] };

/**
 * A blueprint with its asset ids rewritten by `to` (a wish resolved, a photo swapped for its cutout, a failed make). `to`
 * returning null takes the piece away, and everything that hung on it. `plainOnly`: only pictures standing on their own
 * change; a treatment's or a full-frame picture keeps its photo. Pure.
 */
export function mapBlueprintAssets(blueprint: Blueprint, to: (id: string) => string | null, { plainOnly = false }: { plainOnly?: boolean } = {}): Blueprint {
  const gone = new Set<string>();
  const pieces = (blueprint.pieces ?? []).flatMap((p) => {
    if (!p.asset || (plainOnly && (p.treatment || p.fill))) return [p];
    const next = to(p.asset);
    if (next === null) {
      gone.add(p.id);
      return [];
    }
    return [{ ...p, asset: next }];
  });
  const stays = (id: string | undefined | null) => !id || !gone.has(id);
  const groundIsAsset = !['charcoal', 'kraft', 'whiteboard'].includes(blueprint.ground);
  return {
    ...blueprint,
    ground: groundIsAsset && !plainOnly ? to(blueprint.ground) ?? 'charcoal' : blueprint.ground,
    pieces: pieces.filter((p) => stays(p.belongs) && stays(p.onto?.piece)),
    labels: (blueprint.labels ?? []).filter((l) => stays(l.for)),
    speech: (blueprint.speech ?? []).filter((s) => stays(s.on_piece)),
    marks: (blueprint.marks ?? []).filter((m) => stays(m.on_piece) && stays(m.from)),
    arrows: (blueprint.arrows ?? []).filter((a) => stays(a.from) && stays(a.to)),
    camera: { ...blueprint.camera, stops: (blueprint.camera?.stops ?? []).filter((s) => stays(s.aim)) },
  };
}

/** Every asset a blueprint shows. Pure. */
export function blueprintAssets(blueprint: Blueprint | null | undefined): string[] {
  if (!blueprint) return [];
  const ground = ['charcoal', 'kraft', 'whiteboard'].includes(blueprint.ground) ? [] : [blueprint.ground];
  return [...new Set([...ground, ...(blueprint.pieces ?? []).flatMap((p) => (p.asset ? [p.asset] : []))])];
}

export type StoryboardFrame = {
  /** Null for the close, which is code's. */
  blueprint?: Blueprint | null;
  n: number;
  name: string;
  line_ids: string[];
  /** The treatment from the kit (CONTRACT.md §Kit): photo, cutout_lift, collision, page, map, board, whiteboard, newspaper, close… */
  treatment: string;
  asset_ids: string[];
  purpose: string;
  /** @deprecated Gone from the plan (ITERATION-10 §4); only `checks/**` still reads it, until the join. Saved plans may carry it. */
  motion?: string;
  /** @deprecated As `motion`. */
  marks?: string;
  /** @deprecated As `motion`. */
  sound?: string;
  music: 'start' | 'change' | 'drop' | 'hold' | 'end';
  on_screen: string | null;
  /** Lines whose on-screen label the director drops because it fights this frame's picture (MD-126). */
  drop_labels?: string[];
  /** Who appears and how, for the variety check (MD-60): no person shown the same way > 2 frames in a row. */
  shows?: { person: string; asset_id: string; treatment: string }[];
  /**
   * What the eye lands on first in this frame (MD-131): its kind and, in a few words, what it is. The close
   * has `focus: null`. Optional: plans saved before iteration 7 don't carry it (the shares check skips them).
   */
  focus?: { kind: FocusKind; what: string } | null;
  /**
   * The picture beats of this frame, in spoken order (MD-136). Optional: plans saved before iteration 8 don't
   * carry them (the shot-map checks skip those). The close has none.
   */
  shots?: FrameShot[];
};

/** One picture beat inside a frame (MD-136): what is on screen from the moment `at` is spoken. */
export type FrameShot = {
  /** The exact spoken words this beat lands on, copied from the frame's narration. */
  at: string;
  /** What is on screen, in a few plain words. */
  shows: string;
  /** The assets, makes or wishes this beat uses; empty for a code-built number or text. */
  asset_ids: string[];
  /** A named player this beat introduces (its first mention in the reel), or null. */
  introduces: string | null;
};

/** An asset the director asks to be made for one moment (MD-59): drawn, traced or code-built, never photoreal. */
export type MakeRequest = {
  /** M1, M2…; frames reference it in asset_ids like any asset. */
  id: string;
  kind: 'setting' | 'expression' | 'collage' | 'drawing';
  /** Exactly what the moment needs. */
  brief: string;
  people: string[];
  /** Asset ids it traces or composes from. */
  from_assets: string[];
  /** A seeded setting id, only when it is an exact match for the moment; else null. */
  seed: string | null;
};

/**
 * A shot the director wants but the inventory lacks (MD-68). Frames name the wish id (W1…) in `asset_ids`
 * and `shows`; after the targeted search each id becomes the found asset, or `fallback` when nothing is found.
 */
export type ShotWish = {
  id: string;
  /** The cast name the media must show, or null for a place, object or document. */
  person: string | null;
  /** Exactly what the media must show (who, doing what, where, when): a person, an object or a place. */
  want: string;
  /**
   * True: the find is cut out (background removed) and joins the inventory as a transparent cutout of what
   * `want` names, usable in tableau, collage, cutout_lift and collision like any cutout (MD-127). Optional:
   * plans saved before iteration 7 don't carry it (read as false).
   */
  cut_out?: boolean;
  /**
   * The Google Images query for this wish, 2 to 5 words, naming the thing itself (MD-139). Required of new
   * plans; plans saved before iteration 8 don't carry it (the search falls back to words from `want`).
   */
  query?: string;
  /** What is wanted: a photo (the default), a logo, a product, an object or a place (MD-135, MD-139). */
  as?: 'photo' | 'logo' | 'product' | 'object' | 'place';
  /** How many different pictures to keep, 1 to 10 (a burst behind a number, MD-138). Default 1. */
  count?: number;
  frame_ns: number[];
  /** An inventory asset id or a make id the frames use if the search finds nothing. */
  fallback: string;
};

export type DirectorPlan = {
  frames: StoryboardFrame[];
  /** Assets to make for exact moments (MD-59); may be empty. */
  makes?: MakeRequest[];
  /** Shots planned first, searched for after (MD-68); may be empty. */
  wishes?: ShotWish[];
  /** One round only (MD-38); empty when the script works as written. */
  lines_back: { line_id: string; why: string; suggestion: string }[];
  /** Set by code, never the model: what still failed validation after the fix round, and what code did about it. The run flags them. */
  repairs?: string[];
};

// ── Checks and delivery ─────────────────────────────────────────────────────

export const CHECK_IDS = ['story', 'facts', 'integrity', 'first_viewer', 'breakage'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/** A visible warning on a delivered reel (checks fail open, MD-39). */
export type JobFlag = { at: string; check: CheckId | 'harvest' | 'reporting' | 'voice' | 'render' | 'cost'; detail: string };

export type PostText = { caption: string; credits: string[]; question: string };

export type DeliveryReport = {
  job_id: string;
  video: string | null;
  contact_sheet: string | null;
  seconds: number | null;
  usd: number;
  usd_unknown_parts: string[];
  flags: JobFlag[];
  post: PostText | null;
};

export type JobStage =
  | 'pick'
  | 'reporting'
  | 'harvest'
  | 'writer'
  | 'story_notes'
  | 'story_rewrite'
  | 'director'
  | 'wish_search'
  | 'writer_revise'
  | 'facts_check'
  | 'workspace'
  | 'voice'
  | 'integrity_check'
  | 'make'
  | 'sound_design'
  | 'compile'
  | 'assemble'
  | 'creative_pass'
  | 'render'
  | 'first_viewer'
  | 'deliver';
