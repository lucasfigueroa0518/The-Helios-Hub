/**
 * Canonical shared voice block for the v2 creator pipeline.
 *
 * The Writer prompt's `## Voice` section (docs/HELIOS-PIPELINE-V2-HANDOFF.md
 * Appendix §2) is the single source of truth. This module re-exports it as a
 * string and derives the banned-phrase lists for the code check from the same
 * text, so voice rules can't drift across Writer, Editor, Caption, and the
 * checker. Substitution happens at module load (constant string interpolation)
 * so the resulting prompt bytes are stable across requests — prompt caching
 * stays intact.
 */

export const VOICE_BLOCK = `Direct, dry, confident. A sharp editor, not a press release.

Write the way a person talks:
- Use real names. "Norland Labs says," not "the company says" when you can name it.
- Say who did what. "Norland Labs tested the software," not "the software was tested."
- Read every line aloud in your head. If nobody would say it in a normal voice, rewrite it.
- Vary sentence length. Three short sentences in a row is too many.
- Don't open two slides the same way.

Never use:
- Em dashes, double hyphens (--), emoji or exclamation marks.
- "Not X, it's Y" or "not X but Y" constructions.
- Filler that sounds deep: "at its core," "the real question is," "it's worth noting," "moving forward."
- Announcing instead of saying: "let's dive in," "here's what you need to know," "here's the kicker," "here's why."
- Endings that tack on fake depth: "..., highlighting the growing tension."
- "Serves as," "boasts" or "features" where "is" or "has" works.
- Unnamed authority, like "experts say."
- Glue words: "Meanwhile," "Additionally," "Furthermore," "That said."
- These words: landscape, ecosystem, space (as in "AI space"), game-changer, paradigm, revolutionary, seismic, watershed, pivotal, robust, groundbreaking, unprecedented, delve, testament, reshape, unlock, leverage, empower, elevate, transform, redefine, reimagine.`;

export type BannedRule = { kind: 'literal' | 'regex'; pattern: string; label: string };

/**
 * Always wrong: em dashes, emoji, exclamation marks, multi-word phrases that
 * have no legitimate use in Helios voice, and single hype words that always
 * read as inflated marketing regardless of context.
 */
export const BANNED_ALWAYS: BannedRule[] = [
  // Dash family. Split into explicit rules so error messages name the exact
  // character. "--" (double ASCII hyphen) is included because it renders as
  // two hyphens on Instagram and reads as an em dash the copy tried to
  // sneak past the em-dash ban.
  { kind: 'regex', pattern: '\\u2014', label: 'em dash (—)' },
  { kind: 'regex', pattern: '\\u2013', label: 'en dash (–)' },
  { kind: 'literal', pattern: '--', label: '"--" (double hyphen used as a dash)' },
  { kind: 'regex', pattern: '!', label: 'exclamation mark' },
  {
    kind: 'regex',
    pattern:
      '[\\u{1F300}-\\u{1F6FF}\\u{1F900}-\\u{1F9FF}\\u{1FA70}-\\u{1FAFF}\\u{2600}-\\u{27BF}]',
    label: 'emoji',
  },
  // Multi-word invented-contrast constructions. The voice block bans "not
  // X, it's Y" and "not X but Y" in prose; this section catches every
  // shape a model reaches for when it wants to insert a false-choice
  // contrast the sources don't make (Google CC re-run 2026-09-29).
  { kind: 'regex', pattern: '\\bnot\\s+[^,\\.]{1,40},\\s*it\'s\\s+', label: '"not X, it\'s Y"' },
  { kind: 'regex', pattern: '\\bnot\\s+[^,\\.]{1,40}\\s+but\\s+', label: '"not X but Y"' },
  { kind: 'regex', pattern: '\\bnot\\s+just\\s+[^,\\.]{1,40},\\s+', label: '"not just X, Y"' },
  { kind: 'regex', pattern: '\\bnot\\s+just\\s+[^,\\.]{1,40}\\s+but\\s+', label: '"not just X but Y"' },
  { kind: 'regex', pattern: '\\bnot\\s+merely\\s+[^,\\.]{1,40}[,\\s]', label: '"not merely X"' },
  { kind: 'regex', pattern: '\\bnot\\s+simply\\s+[^,\\.]{1,40}[,\\s]', label: '"not simply X"' },
  // Mirror form: "X, not Y" ("designed in, not discovered"). Same invented
  // contrast framing, just with the negation on the second half.
  { kind: 'regex', pattern: '\\b[a-z]{4,}(?:ed|ing|s)?\\s+in,\\s+not\\s+[a-z]', label: '"X, not Y" invented contrast' },
  { kind: 'regex', pattern: '[a-z]{4,}[,;]\\s+not\\s+[a-z]{4,}', label: '"X, not Y" invented contrast' },
  // "Unlike X, Y" — invented-contrast framing (Google CC run flagged
  // "Unlike an AI that just answers questions, CC takes actions on your
  // behalf" — the "just answers questions" contrast came from the model,
  // not the sources). Catches "Unlike an AI...", "Unlike other agents...",
  // "Unlike traditional chatbots...", etc.
  { kind: 'regex', pattern: '(?:^|[\\s,;.:!?"])[Uu]nlike\\b[^,\\.]{1,60},', label: '"Unlike X, Y" invented contrast' },
  { kind: 'literal', pattern: 'at its core', label: '"at its core"' },
  { kind: 'literal', pattern: 'the real question is', label: '"the real question is"' },
  { kind: 'literal', pattern: "it's worth noting", label: '"it\'s worth noting"' },
  { kind: 'literal', pattern: 'moving forward', label: '"moving forward"' },
  { kind: 'literal', pattern: "let's dive in", label: '"let\'s dive in"' },
  { kind: 'literal', pattern: "here's what you need to know", label: '"here\'s what you need to know"' },
  { kind: 'literal', pattern: "here's the kicker", label: '"here\'s the kicker"' },
  { kind: 'literal', pattern: "here's why", label: '"here\'s why"' },
  { kind: 'literal', pattern: 'highlighting the growing tension', label: '"highlighting the growing tension"' },
  { kind: 'literal', pattern: 'experts say', label: '"experts say"' },
  { kind: 'literal', pattern: 'serves as', label: '"serves as"' },
  { kind: 'literal', pattern: 'game-changer', label: '"game-changer"' },
  // Sentence-starter glue words.
  { kind: 'regex', pattern: '(?:^|\\n)\\s*Meanwhile,', label: '"Meanwhile," at start of line' },
  { kind: 'regex', pattern: '(?:^|\\n)\\s*Additionally,', label: '"Additionally," at start of line' },
  { kind: 'regex', pattern: '(?:^|\\n)\\s*Furthermore,', label: '"Furthermore," at start of line' },
  { kind: 'regex', pattern: '(?:^|\\n)\\s*That said,', label: '"That said," at start of line' },
  // Clear hype words — no legitimate use in Helios voice.
  { kind: 'regex', pattern: '\\bdelve\\b', label: '"delve"' },
  { kind: 'regex', pattern: '\\bpivotal\\b', label: '"pivotal"' },
  { kind: 'regex', pattern: '\\bparadigm\\b', label: '"paradigm"' },
  { kind: 'regex', pattern: '\\brevolutionary\\b', label: '"revolutionary"' },
  { kind: 'regex', pattern: '\\bseismic\\b', label: '"seismic"' },
  { kind: 'regex', pattern: '\\bwatershed\\b', label: '"watershed"' },
  { kind: 'regex', pattern: '\\bgroundbreaking\\b', label: '"groundbreaking"' },
  { kind: 'regex', pattern: '\\bunprecedented\\b', label: '"unprecedented"' },
  { kind: 'regex', pattern: '\\btestament\\b', label: '"testament"' },
  { kind: 'regex', pattern: '\\bredefine[sd]?\\b', label: '"redefine"' },
  { kind: 'regex', pattern: '\\breimagine[sd]?\\b', label: '"reimagine"' },
  { kind: 'regex', pattern: '\\becosystem\\b', label: '"ecosystem"' },
  { kind: 'regex', pattern: '\\bboasts?\\b', label: '"boasts"' },
];

/**
 * Judgment words: single words that have genuine normal uses ("space" in the
 * physical sense, a product legitimately "features" X, a bookshelf can be
 * "robust"). Code-check surfaces these to the Editor (for slides) or Caption
 * (for the caption). Editor decides: if the use is the banned inflated one,
 * rewrite; if normal, keep and note the reason in EDIT NOTES.
 */
export const BANNED_JUDGMENT: string[] = [
  'landscape',
  'space',
  'robust',
  'features',
  'unlock',
  'leverage',
  'empower',
  'elevate',
  'transform',
  'reshape',
];
