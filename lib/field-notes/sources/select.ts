/**
 * Pick the tips for a post (CONTRACT-v4 section 3). Pure: no clock, no database, no model.
 *
 * - Skips expired candidates (tip_expiry_days counted from `firstSeenAt`, when we found it, never from the
 *   source's publish date, so an evergreen tip is not expired for being old; a `technique` tip never expires),
 *   subjects already posted (the candidate's normalized title, or the same GitHub owner/repo; or its title or first
 *   POSTED_NAME_HEAD_CHARS of text naming a posted subject: a posted headline of two or more words, a posted command or
 *   slug token, or a posted repo's owner/repo, see `namesPostedSubject`), and source URLs already posted.
 * - Never a tip scored 0 (the AI gate's no, `about_ai`, field-notes-score@3), not even to reach `minTotal`.
 * - Highest score first; newest publish date breaks exact ties.
 * - DISTINCT subjects (one tip per subject on a post: the normalized title, and one tip per GitHub repo), and at
 *   most maxPerWant(post size) tips with the same want on one post (counting the tips already on it, `takenWants`). When
 *   that cap would leave the post under `minTotal`, it is relaxed just enough to reach it, highest scores first.
 * - When scores tie within WANT_TIE_BAND, the want used least in the last 7 posts (`recentWants`) goes first.
 * - The mix (Tommy, 2026-11-06: favour features of the tools people already use over small repos): at most
 *   maxRepoTips(post size) tips from the six `repo_*` leaves on one post (seeded tips on it count); when any eligible tip from
 *   FEATURE_LEAVES exists, the post includes at least one (the highest scored still free; it beats the want cap if it
 *   must); inside the tie band a FEATURE_LEAVES tip goes before any other, then the want rule. When the want cap and
 *   then the repo cap would leave the post under `minTotal`, each is relaxed in turn just enough to reach it.
 *
 * `selectTips` takes the top few; `selectNextTip` is the top one. `admitSeeds` applies the same post rules
 * (distinct subjects, the per-want cap) to a person's seeded tips, in their own order (no score). `scoringOrder` picks
 * which newly found candidates a run scores (per-source flood cap, then round-robin in registry order).
 */
import type { ContentLeaf, Want } from '@/lib/field-notes/types';
import type { ScoredCandidate } from './score';
import { candidateTitle, canonicalSourceUrl, githubRepoOf, type TipCandidate } from './candidate';

/**
 * At most this many tips with one want on a post of `postSize` tips (relaxed only to reach `minTotal`): half the post,
 * rounded up, and never under 2 (3 or 4 tips: 2; 5 or 6 tips: 3). Scaled when posts grew to TIP_SLIDES_MAX = 6
 * (Tommy, 2026-11-08): a flat 2 would need three different wants on every 6-tip post, which starves it.
 */
export const maxPerWant = (postSize: number): number => Math.max(MAX_PER_WANT, Math.ceil(postSize / 2));
/** The floor of the per-want cap (the whole cap for posts of up to 4 tips). */
export const MAX_PER_WANT = 2;
/** Scores this close count as a tie for the want-variety rule. */
export const WANT_TIE_BAND = 0.05;
/** How many recent posts `recentWants` covers (the caller reads them: store.recentPostWants). */
export const RECENT_WANT_POSTS = 7;
/** No source puts more than this many new candidates into one run's scoring (a flood cap, before the round-robin). */
export const MAX_CANDIDATES_PER_SOURCE = 5;
/** The leaf that never expires: a tool-agnostic practice (a guide section) is as good next month. */
export const EVERGREEN_LEAF = 'technique';
/** The open-source repository leaves: at most maxRepoTips(post size) of them on one post (relaxed only to reach `minTotal`). */
export const REPO_LEAVES = [
  'repo_free_alternative', 'repo_data', 'repo_mcp', 'repo_agent_runtime', 'repo_automation', 'repo_memory',
] as const satisfies readonly ContentLeaf[];
/** The floor of the repo cap (the whole cap for posts of up to 5 tips). */
export const MAX_REPO_TIPS = 2;
/**
 * At most this many `repo_*` tips on a post of `postSize` tips: half the post, rounded down, and never under 2
 * (3 to 5 tips: 2; 6 tips: 3). Features of the tools people already use stay at least half of a full post.
 */
export const maxRepoTips = (postSize: number): number => Math.max(MAX_REPO_TIPS, Math.floor(postSize / 2));
/** Features and practice of the tools people already use: a post includes one whenever one is eligible. */
export const FEATURE_LEAVES = ['coding_agent_feature', 'llm_app_feature', 'technique'] as const satisfies readonly ContentLeaf[];
export const isRepoLeaf = (leaf: ContentLeaf | null | undefined): boolean => !!leaf && (REPO_LEAVES as readonly string[]).includes(leaf);
export const isFeatureLeaf = (leaf: ContentLeaf | null | undefined): boolean => !!leaf && (FEATURE_LEAVES as readonly string[]).includes(leaf);

export type SelectInput = {
  scored: readonly (ScoredCandidate & {
    /** When we first saw it (tips.created_at). Expiry counts from this only; absent means never expired. */
    firstSeenAt?: string | null;
    /** The stored subject: a seeder's name for a seed; for a found tip only a placeholder (its title is the key). */
    subject?: string | null;
  })[];
  now: Date;
  tipExpiryDays: number;
  /** Subjects of tips already on a post (drafted, approved, posted): a candidate whose title matches is skipped. */
  postedSubjects?: readonly string[];
  /** Source links already on a post: skipped, and so is any candidate in the same GitHub repo. */
  postedUrls?: readonly string[];
  /** Subjects already on the post (a seeded tip's), so the fill never repeats a tool. */
  takenSubjects?: readonly string[];
  /** Source links already on the post (seeded tips), so the fill never takes a second tip from one GitHub repo. */
  takenUrls?: readonly (string | null)[];
  /** Wants of the tips already on the post (seeded tips), counted toward the per-want cap. */
  takenWants?: readonly (Want | null)[];
  /** Leaves of the tips already on the post (seeded tips): a repo leaf counts toward the repo cap, a feature leaf meets the feature rule. */
  takenLeaves?: readonly (ContentLeaf | null)[];
  /** The wants of the tips on the last RECENT_WANT_POSTS posts, one entry per tip. */
  recentWants?: readonly Want[];
  /**
   * The fewest tips the post needs, counting the ones already on it (TIP_SLIDES_MIN). When the per-want cap would leave
   * the post short of it, the want cap is relaxed just enough (highest scores first). Absent: never relaxed.
   */
  minTotal?: number;
  /**
   * The post's full size, the tips already on it included, that scales the per-want and repo caps (maxPerWant,
   * maxRepoTips). Absent: the tips already on the post plus `count`.
   */
  postSize?: number;
};

/** Subject normalization: lowercase, punctuation to spaces, spaces collapsed (the fact check's rule). */
export const normalizeSubject = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const norm = normalizeSubject;
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const repoKey = (url: string | null | undefined) => {
  const repo = githubRepoOf(url);
  return repo ? `github:${repo.slug}` : null;
};

/** How much of a candidate's text (after its title) the posted-name check reads: where a post names its subject. */
export const POSTED_NAME_HEAD_CHARS = 300;

/** Hyphenated everyday words: never a distinctive name on their own. */
const COMMON_HYPHENATED = new Set([
  'built-in', 'real-time', 'open-source', 'step-by-step', 'one-click', 'long-running', 'multi-step', 'low-code', 'no-code',
  'end-to-end', 'follow-up', 'sign-in', 'sign-up', 'opt-in', 'opt-out', 'read-only', 'up-to-date', 'well-known', 'hands-on',
  'day-to-day', 'how-to', 'add-on', 'plug-in', 'pre-built', 'self-hosted', 'third-party', 'e-mail', 'ai-powered', 'on-device',
  'full-stack', 'single-page', 'back-end', 'front-end', 'non-technical', 're-run', 'co-author', 'high-quality', 'large-scale',
]);
const COMMON_SLASHED = new Set(['and/or', 'w/o', 'input/output', 'i/o', 'n/a', 'yes/no', 'on/off', 'read/write', 'before/after', 'client/server']);
const TRIM_PUNCT = /^[\s"'`“”‘’(\[{<*_,;:!?]+|[\s"'`“”‘’)\]}>*_,;:!?.]+$/g;

/**
 * A command- or slug-like token of a posted subject (`/review`, `owner/repo`, `gemini-cli`, `claude.md`, `gpt-5`),
 * lowercase, or null for a plain word. A hyphen or dot token needs a letter and four characters; everyday
 * hyphenated words are left out.
 */
function slugToken(raw: string): string | null {
  const t = raw.toLowerCase().replace(TRIM_PUNCT, '');
  if (t.length < 3 || !/\p{L}/u.test(t)) return null;
  if (/^\/[a-z][\w-]*$/.test(t)) return t;
  if (/^[\w.-]+\/[\w.-]+$/.test(t)) return COMMON_SLASHED.has(t) ? null : t;
  if (t.length >= 4 && /^[\p{L}\p{N}]+(?:[.-][\p{L}\p{N}]+)+$/u.test(t)) return COMMON_HYPHENATED.has(t) ? null : t;
  return null;
}

/** Regex-escaped for a `u` pattern (`/` and `-` are literal outside a class and must not be escaped there). */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A whole-token match: no letter, digit, `_` or `-` right before; none (nor `.x`) right after. */
const tokenPattern = (token: string) => new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRe(token)}(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])`, 'u');

/** What a posted subject or repo can be recognised by in a later candidate's head. */
export type PostedNames = { phrases: string[]; tokens: RegExp[] };

/**
 * The distinctive names already posted: each posted subject (a slide headline) of at least two words, as a normalized
 * phrase; each command- or slug-like token in a posted subject; and each posted GitHub repo as `owner/repo`. A one-word
 * plain subject is never a name (it would block every candidate that uses the word). Pure.
 */
export function postedNames(subjects: readonly string[], urls: readonly string[] = []): PostedNames {
  const phrases = new Set<string>();
  const tokens = new Set<string>();
  for (const s of subjects) {
    const n = norm(s);
    // Words as written (`and/or` is one word, not two), each with a letter or digit.
    if (n && s.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length >= 2) phrases.add(n);
    for (const raw of s.split(/\s+/)) {
      const t = slugToken(raw);
      if (t) tokens.add(t);
    }
  }
  for (const u of urls) {
    const repo = githubRepoOf(u);
    if (repo) tokens.add(repo.slug);
  }
  return { phrases: [...phrases], tokens: [...tokens].map(tokenPattern) };
}

/**
 * True when a candidate's title or the first POSTED_NAME_HEAD_CHARS of its text names something already posted: a
 * posted subject phrase (on word boundaries), a posted command or slug token, or a posted repo (`owner/repo`, which
 * also catches a github.com link to it). Deterministic: no model.
 */
export function namesPostedSubject(c: { untrustedContent?: string | null }, names: PostedNames): boolean {
  if (!names.phrases.length && !names.tokens.length) return false;
  const title = candidateTitle(c);
  const rest = (c.untrustedContent ?? '').trim().slice(title.length, title.length + POSTED_NAME_HEAD_CHARS);
  const head = `${title}\n${rest}`;
  const normalized = ` ${norm(head)} `;
  if (names.phrases.some((p) => normalized.includes(` ${p} `))) return true;
  const lower = head.toLowerCase();
  return names.tokens.some((re) => re.test(lower));
}

type KeySource = {
  subject?: string | null;
  candidate: { sourceKind?: string; sourceLabel: string; sourceUrl: string; untrustedContent?: string };
};

/**
 * The subject a candidate stands for, normalized. A seed: the seeder's subject. A found tip: its own title (the first
 * line of its text), because its stored subject is only our source label until a post names it. Fallbacks: the stored
 * subject, our label, the link.
 */
export const subjectKey = (s: KeySource): string => {
  if (s.candidate.sourceKind === 'seed' && s.subject?.trim()) return norm(s.subject);
  const title = norm(candidateTitle(s.candidate));
  return title || norm(s.subject || s.candidate.sourceLabel || canonicalSourceUrl(s.candidate.sourceUrl));
};

/** Every key that makes two candidates "the same subject": the subject key, and the GitHub repo when it has one. */
export const subjectKeys = (s: KeySource): string[] => {
  const repo = repoKey(s.candidate.sourceUrl);
  return repo ? [subjectKey(s), repo] : [subjectKey(s)];
};

export function selectTips(input: SelectInput, count: number): ScoredCandidate[] {
  const postedSubjects = new Set((input.postedSubjects ?? []).map(norm).filter(Boolean));
  const postedUrls = new Set((input.postedUrls ?? []).map(canonicalSourceUrl));
  const postedRepos = new Set((input.postedUrls ?? []).map(repoKey).filter((k): k is string => !!k));
  const names = postedNames(input.postedSubjects ?? [], input.postedUrls ?? []);
  const cutoff = input.now.getTime() - input.tipExpiryDays * 86_400_000;

  const eligible = input.scored.filter((s) => {
    // A score of 0 is a no from the AI gate (field-notes-score@3) or a no to everything: never on a post, not even to reach minTotal.
    if (!(s.score > 0)) return false;
    const seen = ms(s.firstSeenAt);
    if (s.leaf !== EVERGREEN_LEAF && Number.isFinite(seen) && seen < cutoff) return false;
    if (postedSubjects.has(subjectKey(s))) return false;
    if (namesPostedSubject(s.candidate, names)) return false;
    const repo = repoKey(s.candidate.sourceUrl);
    if (repo && postedRepos.has(repo)) return false;
    if (postedUrls.has(canonicalSourceUrl(s.candidate.sourceUrl))) return false;
    return true;
  });

  const newest = (s: (typeof eligible)[number]) => {
    const t = ms(s.candidate.publishedAt);
    return Number.isFinite(t) ? t : ms(s.firstSeenAt) || 0;
  };
  eligible.sort((a, b) => b.score - a.score || newest(b) - newest(a) || a.candidate.sourceUrl.localeCompare(b.candidate.sourceUrl));

  const recent = new Map<Want, number>();
  for (const w of input.recentWants ?? []) recent.set(w, (recent.get(w) ?? 0) + 1);
  // An untagged tip has no want to vary: inside a tie band it goes after the tagged ones.
  const usage = (w: Want | null) => (w ? (recent.get(w) ?? 0) : Number.POSITIVE_INFINITY);

  const seen = new Set((input.takenSubjects ?? []).map(norm));
  for (const u of input.takenUrls ?? []) {
    const k = repoKey(u);
    if (k) seen.add(k);
  }
  const perWant = new Map<Want, number>();
  for (const w of input.takenWants ?? []) if (w) perWant.set(w, (perWant.get(w) ?? 0) + 1);
  const already = Math.max(input.takenSubjects?.length ?? 0, input.takenWants?.length ?? 0, input.takenUrls?.length ?? 0, input.takenLeaves?.length ?? 0);
  const postSize = input.postSize ?? already + count;
  const wantCap = maxPerWant(postSize);
  const repoCap = maxRepoTips(postSize);
  let repos = (input.takenLeaves ?? []).filter(isRepoLeaf).length;
  let hasFeature = (input.takenLeaves ?? []).some(isFeatureLeaf);
  const out: ScoredCandidate[] = [];
  type E = (typeof eligible)[number];
  const free = (s: E) => !out.includes(s) && !subjectKeys(s).some((k) => seen.has(k));
  const underWantCap = (s: E) => !(s.want && (perWant.get(s.want) ?? 0) >= wantCap);
  const underRepoCap = (s: E) => !(isRepoLeaf(s.leaf) && repos >= repoCap);
  const take = (pick: E) => {
    out.push(pick);
    for (const k of subjectKeys(pick)) seen.add(k);
    if (pick.want) perWant.set(pick.want, (perWant.get(pick.want) ?? 0) + 1);
    if (isRepoLeaf(pick.leaf)) repos += 1;
    if (isFeatureLeaf(pick.leaf)) hasFeature = true;
  };
  /** The best free feature tip, under the want cap when one is; null when none is left (or one is on the post). */
  const featureStillNeeded = (): E | null => {
    if (hasFeature) return null;
    const features = eligible.filter((s) => isFeatureLeaf(s.leaf) && free(s));
    return features.find(underWantCap) ?? features[0] ?? null;
  };

  let pool = eligible;
  while (out.length < count) {
    // Whatever can still go on this post, best first.
    pool = pool.filter((s) => free(s) && underWantCap(s) && underRepoCap(s));
    // The last slot goes to a feature tip when the post has none yet and one is eligible (it beats the want cap).
    const reserved = out.length === count - 1 ? featureStillNeeded() : null;
    if (reserved) {
      take(reserved);
      break;
    }
    const top = pool[0];
    if (!top) break;
    // Inside the tie band a feature tip goes first, then the least recently used want; the sort order breaks what is left.
    const rank = (s: E) => [isFeatureLeaf(s.leaf) ? 0 : 1, usage(s.want)] as const;
    const better = (a: E, b: E) => {
      const [fa, ua] = rank(a);
      const [fb, ub] = rank(b);
      return fa < fb || (fa === fb && ua < ub);
    };
    let pick = top;
    for (const s of pool) {
      if (top.score - s.score > WANT_TIE_BAND) break;
      if (better(s, pick)) pick = s;
    }
    take(pick);
    pool = pool.filter((s) => s !== pick);
  }
  // The pool ran dry with room left (caps): the feature rule still gets its tip.
  if (out.length < count) {
    const f = featureStillNeeded();
    if (f) take(f);
  }

  // Starvation: the caps left the post under its minimum. Relax the want cap first, then the repo cap, each just
  // enough, highest scores first.
  if (input.minTotal !== undefined) {
    const short = () => out.length < count && already + out.length < input.minTotal!;
    for (const relaxRepo of [false, true]) {
      for (const s of eligible) {
        if (!short()) break;
        if (free(s) && (relaxRepo || underRepoCap(s))) take(s);
      }
    }
  }
  return out;
}

export function selectNextTip(input: SelectInput): ScoredCandidate | null {
  return selectTips(input, 1)[0] ?? null;
}

/** What `admitSeeds` reads of a seeded tip. */
export type SeedForPost = { id: string; subject: string; want: Want | null; sourceLabel: string | null; sourceUrl: string | null };

/**
 * A person's seeded tips onto one post, in the order given (the named seed first, then oldest first): a seed goes on
 * while the post has room (`count`), its subject (or GitHub repo) is not on the post yet, and its want has fewer than maxPerWant(count).
 * The rest wait, still candidates, for a later post. Pure.
 */
export function admitSeeds<T extends SeedForPost>(seeds: readonly T[], count: number): { admitted: T[]; waiting: T[] } {
  const admitted: T[] = [];
  const waiting: T[] = [];
  const seen = new Set<string>();
  const perWant = new Map<Want, number>();
  const wantCap = maxPerWant(count);
  for (const s of seeds) {
    const keys = subjectKeys({ subject: s.subject, candidate: { sourceKind: 'seed', sourceLabel: s.sourceLabel ?? '', sourceUrl: s.sourceUrl ?? `tip:${s.id}` } });
    if (admitted.length >= count || keys.some((k) => seen.has(k)) || (s.want && (perWant.get(s.want) ?? 0) >= wantCap)) {
      waiting.push(s);
      continue;
    }
    admitted.push(s);
    for (const k of keys) seen.add(k);
    if (s.want) perWant.set(s.want, (perWant.get(s.want) ?? 0) + 1);
  }
  return { admitted, waiting };
}

/**
 * Which newly found candidates (already-stored links dropped by the caller) a run scores, in order: at most
 * `perSource` from any one source (newest publish date first, undated after in the source's own order), then the
 * `slots` shared round-robin across sources in the order they were collected (the registry order), so every source
 * gets a turn before any gets a second. Pure. The caller saves only the ones it scores; the rest are found again later.
 */
export function scoringOrder(candidates: readonly TipCandidate[], o: { slots: number; perSource?: number }): TipCandidate[] {
  const perSource = o.perSource ?? MAX_CANDIDATES_PER_SOURCE;
  const bySource = new Map<string, TipCandidate[]>();
  for (const c of candidates) {
    const key = c.sourceLabel || c.sourceKind;
    const list = bySource.get(key) ?? [];
    list.push(c);
    bySource.set(key, list);
  }
  const queues = [...bySource.values()].map((list) =>
    list
      .map((c, i) => ({ c, i, t: ms(c.publishedAt) }))
      .sort((a, b) => (Number.isFinite(b.t) ? b.t : -Infinity) - (Number.isFinite(a.t) ? a.t : -Infinity) || a.i - b.i)
      .slice(0, perSource)
      .map((x) => x.c),
  );
  const out: TipCandidate[] = [];
  for (let round = 0; out.length < o.slots && queues.some((q) => q.length > round); round += 1) {
    for (const q of queues) {
      if (out.length >= o.slots) break;
      if (q[round]) out.push(q[round]!);
    }
  }
  return out;
}
