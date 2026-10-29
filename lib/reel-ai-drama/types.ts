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
  kind: 'person' | 'company';
  /** BluePlayer.id when the member is on the central blue-chip list, else null. */
  player_id: string | null;
  /** What they want in this story (MD-29: a central figure's want drives the events). */
  want: string;
};

export type SourceRef = { url: string; title: string; publisher: string; date: string | null };

export type ExpectedVisual = { kind: VisualKind; what: string; hint: string };

/** One story idea from the development producer (D2). */
export type Pitch = {
  title: string;
  /** Two sentences at most. */
  logline: string;
  /** About 120 words: beginning, turn, what it meant. */
  pitch: string;
  story_type: StoryType;
  era: Era;
  /** YYYY-MM-DD; month or year precision uses the first day and `date_precision`. */
  event_date: string | null;
  date_precision: 'day' | 'month' | 'year';
  cast: CastMember[];
  /** Name of the figure whose want drives the events (a cast member). */
  central_figure: string;
  /** The vivid, concrete moment or detail that makes it a scene (MD-24). */
  scene: string;
  /** The turn or reversal. */
  turn: string;
  /** What it meant for the AI world (MD-24, D-6 Lucas's version). */
  implication: string;
  /** A fresh development that makes it timely, or null (MD-09, MD-32). */
  why_now: string | null;
  /** Suggested engine; the writer may change it or go beyond the examples (MD-36). */
  engine: string;
  expected_visuals: ExpectedVisual[];
  sources: SourceRef[];
};

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
  cast: (CastMember & { qid: string | null })[];
  places: { name: string; address: string | null; lat: number | null; lon: number | null; role: string }[];
  /** False kills the story (MD-31). */
  verdict: { holds: boolean; reason: string };
};

// ── Media harvest (P3) ──────────────────────────────────────────────────────

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
  fact_ids: string[];
  /** An asset id or plain description the line depends on seeing, or null (W-96 rewrite). */
  must_show: string | null;
  /** A silent picture beat after the line, in seconds (0–1), or null (W-130). The line ends its frame. */
  pause_after?: number | null;
};

export type WriterDraft = {
  title: string;
  engine: string;
  /** The hook: on screen within 1.5s, usually from the first frame (MD-34). */
  hook: { on_screen: string; line_id: string };
  rungs: { id: string; purpose: string; lines: ScriptLine[] }[];
  turn_rung_id: string;
  landing_rung_id: string;
  /** Spoken and captioned over the brand close (S-33, MD-18). */
  close_question: string;
  word_count: number;
  /** How the voice says names it would get wrong (TTS text only; captions keep the spelling). */
  pronounce?: { word: string; say: string }[];
};

/** One frame of the director's storyboard (written as STORYBOARD.md by the kit's project-files writer). */
export type StoryboardFrame = {
  n: number;
  name: string;
  line_ids: string[];
  /** The treatment from the kit (CONTRACT.md §Kit): photo, cutout_lift, collision, page, map, board, whiteboard, newspaper, close… */
  treatment: string;
  asset_ids: string[];
  purpose: string;
  motion: string;
  marks: string;
  sound: string;
  music: 'start' | 'change' | 'drop' | 'hold' | 'end';
  on_screen: string | null;
  /** Who appears and how, for the variety check (MD-60): no person shown the same way > 2 frames in a row. */
  shows?: { person: string; asset_id: string; treatment: string }[];
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

export type DirectorPlan = {
  frames: StoryboardFrame[];
  /** Assets to make for exact moments (MD-59); may be empty. */
  makes?: MakeRequest[];
  /** One round only (MD-38); empty when the script works as written. */
  lines_back: { line_id: string; why: string; suggestion: string }[];
};

// ── Checks and delivery ─────────────────────────────────────────────────────

export const CHECK_IDS = ['facts', 'integrity', 'first_viewer', 'breakage'] as const;
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
  | 'director'
  | 'writer_revise'
  | 'facts_check'
  | 'workspace'
  | 'voice'
  | 'integrity_check'
  | 'make'
  | 'sound_design'
  | 'build'
  | 'assemble'
  | 'render'
  | 'first_viewer'
  | 'fix'
  | 'deliver';
