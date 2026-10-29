import type { Queryable } from '@/lib/explainers/db';
import type { BankedCutout } from '@/lib/real-case/bank';
import type { CreateMessage } from '@/lib/reel-ai-drama/reporting/llm';
import type { Asset, VisualKind } from '@/lib/reel-ai-drama/types';

/** Where a candidate came from (one adapter each, `harvest/sources/`). */
export type SourceName =
  | 'bank'
  | 'wikidata'
  | 'commons'
  | 'openverse'
  | 'serper'
  | 'article'
  | 'newsroom'
  | 'logo'
  | 'video'
  | 'screen'
  | 'map'
  | 'paper'
  | 'document'
  /** A line sketch traced from a reference photo when no clean photo exists (MD-14, MD-60). */
  | 'sketch';

/** A measured box around a word or quote in a screenshot, in image pixels (MD-43). */
export type TextBox = { text: string; x: number; y: number; w: number; h: number };

/** What a candidate's date rests on (research 04 §5.1), most to least reliable. */
export type DateBasis = 'event' | 'exif' | 'commons' | 'caption' | 'capture' | 'article' | 'unknown';

/** One thing the harvest looks for: a person, the key moment, an expected visual, a page to capture… */
export type Want = {
  id: string;
  kind: VisualKind;
  what: string;
  /** Search words. */
  terms: string;
  /** People the image is meant to show (identity is checked against these). */
  people: string[];
  qids: string[];
  playerId: string | null;
  /** The pitch's scene: the harvest dies without an image for it (MD-33). */
  key_moment: boolean;
  sources: SourceName[];
  /** For a person: their role in the story, used to tell namesakes apart when resolving a QID by name. */
  context?: string;
  /** For pages, posts, documents, papers and videos. */
  url?: string;
  /** Words to measure in a screenshot (quotes, key words, the headline). */
  phrases?: string[];
  place?: { name: string; address: string | null; lat: number | null; lon: number | null; role: string };
};

/** A candidate before the filters: found on the web, or made by code into `localFile`. */
export type RawCandidate = {
  source: SourceName;
  want: string;
  kind: VisualKind;
  /** Remote image to download; null when `localFile` is set. */
  url: string | null;
  localFile?: string;
  source_page: string | null;
  credit: string;
  license: string | null;
  /** Caption, alt or title text: what the source says the image is. */
  caption: string;
  people: string[];
  /** QIDs the source itself ties the image to (Wikidata P18, Commons depicts, the bank). */
  qids: string[];
  place: string | null;
  date_taken: string | null;
  date_basis: DateBasis;
  width?: number;
  height?: number;
  character_image: boolean;
  made: boolean;
  /** A trusted source needs no watermark look (bank, logo bank, our own renders). */
  trusted: boolean;
  /** `shows` for made items, written by the code that made them. */
  shows?: string;
  /** What kind of made asset this is (sketches here; the director's makes elsewhere). */
  made_kind?: Asset['made_kind'];
  /** The caption embedded in the file (IPTC/XMP), read after download. */
  embedded_caption?: string;
  text_boxes?: TextBox[];
  flags: string[];
};

export type ScreenshotResult = { file: string; width: number; height: number; boxes: TextBox[]; title: string; captured_at: string };
/** Playwright capture of a page/post/document (screens.ts live; stubbed in tests). */
export type Screenshot = (url: string, opts: { out: string; phrases: string[] }) => Promise<ScreenshotResult>;

/** The kit's map renderer (B4, `explainers/reel-ai-drama/kit/maps/render-map.mjs`). */
export type RenderMap = (opts: { lat: number; lon: number; zoom: number; label: string; sublabel: string; out: string }) => Promise<unknown>;

export type VideoFrames = (
  url: string,
  opts: { outDir: string; max: number },
) => Promise<{ frames: { file: string; at: number }[]; channel: string; title: string; date: string | null }>;

/** Upscales `input` by `scale` into `output`; null when no upscaler is installed (MD-16). */
export type Upscale = (input: string, output: string, scale: number) => Promise<void>;

/** A face box, normalised 0–1 to the image (x, y top-left), with the detector's confidence. */
export type FaceBox = { x: number; y: number; w: number; h: number; score: number };
/** Face boxes per local file; null for a file the detector could not read. Local code, no AI (faces.ts). */
export type DetectFaces = (files: string[]) => Promise<Map<string, FaceBox[] | null>>;

/** Draws a line sketch of the person in `reference` (sketch.ts); never photoreal (MD-14). */
export type GenerateSketch = (req: { prompt: string; reference: string }) => Promise<{ png: Buffer; usd: number }>;

export type HarvestDeps = {
  db: Queryable;
  /** Every outside GET/POST (Wikidata, Commons, Openverse, Serper, articles, Nominatim, image downloads). */
  http: typeof fetch;
  /** Haiku looks at thumbnail sheets; null: no looks, so untrusted candidates are rejected. */
  create: CreateMessage | null;
  /** B3's loader; the harvest reads only `harvest-look`. */
  loadPrompt: (name: 'harvest-look') => string;
  /** Optional: Serper is skipped (and noted) without it. */
  serperKey?: string | null;
  screenshot?: Screenshot | null;
  renderMap?: RenderMap | null;
  videoFrames?: VideoFrames | null;
  upscale?: Upscale | null;
  /** Local face detector (MediaPipe in a headless page); null: no face boxes, noted. */
  detectFaces?: DetectFaces | null;
  /** Line-sketch generator for cast with no clean photo; null: no sketches, noted. */
  sketch?: GenerateSketch | null;
  /** Banked cutouts (defaults to `loadCutouts()`), resolved against `root`. */
  cutouts?: readonly BankedCutout[];
  root?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (entry: Record<string, unknown>) => void;
  /** Stop paying for looks and searches past this (default HARVEST_CAP_USD). */
  capUsd?: number;
};

/** Per-run state every adapter shares. */
export type SourceRun = {
  deps: HarvestDeps;
  notes: string[];
  now: Date;
  /** Absolute path of `<jobDir>/media/tmp`, where adapters write made files. */
  tmpDir: string;
  /** News story (event within the news window) vs history (MD-09). */
  isNews: boolean;
  eventDate: string | null;
  /** Every cast name, to read captions for who an image names. */
  cast: string[];
  spend: { serperQueries: number; serperUsd: number; lookUsd: number };
  nextName: (ext: string) => string;
};

export type Source = (want: Want, run: SourceRun) => Promise<RawCandidate[]>;
