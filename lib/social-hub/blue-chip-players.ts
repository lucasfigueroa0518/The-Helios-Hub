/**
 * BLUE_CHIP_PLAYERS: the one list of the companies and people whose moves are
 * the blockbusters of AI news (Lucas, 2026-10-13). Before this there were
 * three lists that had drifted apart: the 15 companies and 15 people the Jev
 * scoring questions name (lib/reels/jev/questions/scoring-shared.ts, D-077),
 * the major-player regex Morning Download scores a headline with
 * (lib/stories/md-score.ts), and the company patterns the carousel pool
 * spreads by (lib/social/ingest/select/companies.ts). Higgsfield was a
 * blockbuster to the reels but invisible to the other two.
 *
 * Every system now reads this list. Each keeps the behavior it had, through a
 * view derived below:
 *
 *   - jevBlueChips(roster): the names a Jev question set embeds. A shipped
 *     version's wording never changes (a new wording is a new version), so
 *     each version names a numbered roster and keeps it: roster 1 is D-077's
 *     30 names (scoring-pass1-v4, major-news@1 and @2), roster 2 adds Palantir
 *     (Lucas, 2026-10-13: scoring-pass1-v5, major-news@3). A player joins the
 *     questions only when a new version takes up a new roster.
 *   - BLUE_CHIP_HEADLINE_MATCH: Morning Download's "major player" test.
 *     Case-sensitive on purpose: "Intel", "Oracle" and "Apple" are names, "intel"
 *     and "apple" are not.
 *   - BLUE_CHIP_SPREAD_KEYS: which company a headline is mainly about, for the
 *     carousel pool's spread rule. Case-insensitive, so only a pattern that is
 *     safe in lowercase belongs in `aliases`. A player with none is never held
 *     back (Intel, Oracle, AMD). A person never has a key of their own: a
 *     headline naming them counts as a story about their primary company, as
 *     "Sam Altman" always counted as OpenAI.
 *
 * A person's `companyIds` is who they lead or front, so a meme or a graphic
 * can put the right company next to them; the first id is the company a story
 * about them spreads under. It may name a blue-chip company or one of the
 * AFFILIATED_COMPANIES: metadata only (Lucas, 2026-10-13). An affiliated
 * company names and badges its person and has a logo; it never makes a
 * headline major, never gets a spread key, and is never in a Jev question.
 *
 * Every company carries its Wikidata QID: the exact identity the logo bank
 * (lib/social-hub/logo-bank.ts) resolves from, never matched by name.
 * Affiliations were checked against Wikidata on 2026-10-13 (CEO and founder
 * claims). Plain data, no imports, so any layer can read it.
 */

export type BluePlayerKind = 'company' | 'person';

/** The Jev roster a player entered. A shipped question-set version names one roster forever. */
export type JevRoster = 1 | 2;
export const CURRENT_JEV_ROSTER: JevRoster = 2;

export type BluePlayer = {
  /** Stable slug. A company's id is also its spread key. */
  id: string;
  kind: BluePlayerKind;
  /** The exact name, spelled as it is written in print. */
  name: string;
  /** Names it went by before, still matched where a name is matched (xAI for SpaceXAI). */
  aka?: readonly string[];
  /** A company's Wikidata QID; null for a person. */
  qid: string | null;
  /** A person: the companies (blue-chip or affiliated ids) they lead or front, primary first. A company: always empty. */
  companyIds: readonly string[];
  /** A company that stories spread under another company's key (DeepMind under Google). */
  rollsUpTo?: string;
  /** How the Jev questions name this player, and the roster it entered; both null when no question names it. */
  jevLabel: string | null;
  jevRoster: JevRoster | null;
  /** Names that mark this player in a headline, matched with exact case and word boundaries. */
  tokens: readonly string[];
  /** Extra headline patterns (regex sources) matched case-insensitively: products, brands, full names. Decides the spread key. */
  aliases: readonly string[];
};

/** A company a blue-chip person leads, kept as their metadata: not a blue-chip player itself. */
export type AffiliatedCompany = { id: string; name: string; qid: string };

type Jev = [label: string, roster: JevRoster] | null;

const company = (
  id: string,
  name: string,
  qid: string,
  jev: Jev,
  tokens: readonly string[],
  aliases: readonly string[] = [],
  rollsUpTo?: string,
): BluePlayer => ({
  id, kind: 'company', name, qid, companyIds: [], jevLabel: jev?.[0] ?? null, jevRoster: jev?.[1] ?? null, tokens, aliases,
  ...(rollsUpTo ? { rollsUpTo } : {}),
});

const person = (
  id: string,
  name: string,
  jev: Jev,
  companyIds: readonly string[],
  tokens: readonly string[],
  aliases: readonly string[] = [],
): BluePlayer => ({ id, kind: 'person', name, qid: null, companyIds, jevLabel: jev?.[0] ?? null, jevRoster: jev?.[1] ?? null, tokens, aliases });

/** D-077's names, in the order the shipped questions list them. */
const d077 = (label: string): Jev => [label, 1];

/**
 * Jev order first (companies, then people: the wording of the shipped
 * questions depends on it), then players only the headline matchers knew.
 */
export const BLUE_CHIP_PLAYERS: readonly BluePlayer[] = [
  // ── Companies the Jev questions name ──
  company('anthropic', 'Anthropic', 'Q116758847', d077('Anthropic'), ['Anthropic', 'Claude'], ['anthropic', 'claude']),
  company('nvidia', 'Nvidia', 'Q182477', d077('Nvidia'), ['Nvidia'], ['nvidia']),
  company('microsoft', 'Microsoft', 'Q2283', d077('Microsoft'), ['Microsoft', 'Copilot'], ['microsoft', 'copilot', 'bing']),
  company('google', 'Google', 'Q95', d077('Google'), ['Google', 'Gemini'], ['google', 'alphabet', 'gemini', 'veo']),
  company('meta', 'Meta', 'Q380', d077('Meta'), ['Meta', 'Llama'], ['meta', 'llama', 'instagram', 'whatsapp']),
  company('openai', 'OpenAI', 'Q21708200', d077('OpenAI'), ['OpenAI', 'ChatGPT'], ['openai', 'chatgpt', 'gpt-\\d', 'sora', 'codex']),
  company('hugging-face', 'Hugging Face', 'Q108943604', d077('Hugging Face'), ['Hugging Face'], ['hugging face']),
  // xAI is now SpaceXAI, a SpaceX division (Wikidata; its site says SpaceXSI), so its stories spread under SpaceX and
  // it prints as SpaceXAI (Lucas, 2026-10-13). The id and roster 1/2's Jev label keep the old name: shipped wording.
  { ...company('xai', 'SpaceXAI', 'Q120599684', d077('xAI (Grok counts as xAI)'), ['xAI', 'SpaceXAI', 'SpaceXSI', 'Grok'], ['xai', 'spacexai', 'spacexsi', 'grok'], 'spacex'), aka: ['xAI', 'SpaceXSI'] },
  company('spacex', 'SpaceX', 'Q193701', d077('SpaceX'), ['SpaceX'], ['spacex']),
  company('higgsfield', 'Higgsfield', 'Q140561494', d077('Higgsfield'), ['Higgsfield'], ['higgsfield']),
  company('google-deepmind', 'Google DeepMind', 'Q15733006', d077('Google DeepMind'), ['DeepMind'], ['deepmind'], 'google'),
  company('amazon', 'Amazon', 'Q3884', d077('AWS'), ['Amazon', 'AWS'], ['amazon', 'aws', 'alexa']),
  company('deepseek', 'DeepSeek', 'Q131577453', d077('DeepSeek'), ['DeepSeek'], ['deepseek']),
  company('mistral', 'Mistral AI', 'Q119718658', d077('Mistral AI'), ['Mistral'], ['mistral']),
  company('perplexity', 'Perplexity', 'Q124333951', d077('Perplexity'), ['Perplexity'], ['perplexity']),
  company('palantir', 'Palantir', 'Q2047336', ['Palantir', 2], ['Palantir'], ['palantir']),

  // ── People the Jev questions name ──
  person('sam-altman', 'Sam Altman', d077('Sam Altman'), ['openai'], ['Altman'], ['sam altman']),
  person('elon-musk', 'Elon Musk', d077('Elon Musk'), ['xai', 'spacex', 'tesla'], ['Musk'], ['elon musk']),
  person('dario-amodei', 'Dario Amodei', d077('Dario Amodei'), ['anthropic'], ['Amodei'], ['dario amodei']),
  // Bezos counts as Amazon (Lucas, 2026-10-13), whatever else he runs.
  person('jeff-bezos', 'Jeff Bezos', d077('Jeff Bezos'), ['amazon'], ['Bezos'], ['jeff bezos']),
  person('mark-zuckerberg', 'Mark Zuckerberg', d077('Mark Zuckerberg'), ['meta'], ['Zuckerberg'], ['zuckerberg']),
  person('eric-schmidt', 'Eric Schmidt', d077('Eric Schmidt'), ['relativity-space'], ['Eric Schmidt']),
  person('alex-karp', 'Alex Karp', d077('Alex Karp'), ['palantir'], ['Alex Karp'], ['alex karp']),
  person('jensen-huang', 'Jensen Huang', d077('Jensen Huang'), ['nvidia'], ['Jensen Huang'], ['jensen huang']),
  person('john-ternus', 'John Ternus', d077('John Ternus'), ['apple'], ['Ternus'], ['john ternus']),
  person('donald-trump', 'Donald Trump', d077('Donald Trump'), [], ['Trump']),
  person('demis-hassabis', 'Demis Hassabis', d077('Demis Hassabis'), ['google-deepmind'], ['Hassabis'], ['demis hassabis']),
  person('ilya-sutskever', 'Ilya Sutskever', d077('Ilya Sutskever'), ['ssi'], ['Sutskever']),
  person('andrej-karpathy', 'Andrej Karpathy', d077('Andrej Karpathy'), ['eureka-labs'], ['Karpathy']),
  person('liang-wenfeng', 'Liang Wenfeng', d077('Liang Wenfeng'), ['deepseek'], ['Liang Wenfeng'], ['liang wenfeng']),
  person('satya-nadella', 'Satya Nadella', d077('Satya Nadella'), ['microsoft'], ['Nadella'], ['satya nadella']),

  // ── Players the headline matchers knew but the Jev questions do not name ──
  company('apple', 'Apple', 'Q312', null, ['Apple'], ['apple', 'siri']),
  company('tesla', 'Tesla', 'Q478214', null, ['Tesla']),
  company('alibaba', 'Alibaba', 'Q1359568', null, ['Alibaba', 'Qwen']),
  company('samsung', 'Samsung', 'Q20718', null, ['Samsung']),
  company('ibm', 'IBM', 'Q37156', null, ['IBM']),
  company('oracle', 'Oracle', 'Q19900', null, ['Oracle']),
  company('tsmc', 'TSMC', 'Q713418', null, ['TSMC']),
  company('amd', 'AMD', 'Q128896', null, ['AMD']),
  company('intel', 'Intel', 'Q248', null, ['Intel']),
  person('sundar-pichai', 'Sundar Pichai', null, ['google'], ['Pichai'], ['sundar pichai']),
  person('tim-cook', 'Tim Cook', null, ['apple'], ['Tim Cook'], ['tim cook']),
  person('andy-jassy', 'Andy Jassy', null, ['amazon'], ['Andy Jassy'], ['andy jassy']),
];

/** Metadata only: the companies of blue-chip people that are not blue-chip players (Lucas, 2026-10-13). */
export const AFFILIATED_COMPANIES: readonly AffiliatedCompany[] = [
  /** Eric Schmidt, CEO since 2025-03-10. */
  { id: 'relativity-space', name: 'Relativity Space', qid: 'Q54263821' },
  /** Ilya Sutskever, co-founder and CEO. */
  { id: 'ssi', name: 'Safe Superintelligence', qid: 'Q130302670' },
  /** Andrej Karpathy, founder (2024). */
  { id: 'eureka-labs', name: 'Eureka Labs', qid: 'Q131626224' },
];

const byId = new Map(BLUE_CHIP_PLAYERS.map((p) => [p.id, p]));
const affiliatedById = new Map(AFFILIATED_COMPANIES.map((c) => [c.id, c]));

export const bluePlayer = (id: string): BluePlayer | undefined => byId.get(id);

/** A company as a person's metadata or the logo bank sees it: blue-chip or affiliated. */
export type CompanyRef = { id: string; name: string; qid: string; blueChip: boolean };

const refOf = (id: string): CompanyRef | null => {
  const p = byId.get(id);
  if (p?.kind === 'company' && p.qid) return { id, name: p.name, qid: p.qid, blueChip: true };
  const a = affiliatedById.get(id);
  return a ? { ...a, blueChip: false } : null;
};

/** The companies a person leads or fronts, primary first. Empty for a company or a person with none. */
export const companiesOf = (p: BluePlayer): CompanyRef[] => p.companyIds.flatMap((id) => refOf(id) ?? []);

/** The people who lead or front a company (blue-chip or affiliated). */
export const peopleOf = (companyId: string): BluePlayer[] =>
  BLUE_CHIP_PLAYERS.filter((p) => p.kind === 'person' && p.companyIds.includes(companyId));

/** Every company with a logo in the bank: the blue-chip companies, then the affiliated ones. */
export const LOGO_COMPANIES: readonly CompanyRef[] = [
  ...BLUE_CHIP_PLAYERS.flatMap((p) => (p.kind === 'company' ? refOf(p.id) ?? [] : [])),
  ...AFFILIATED_COMPANIES.map((c) => ({ ...c, blueChip: false })),
];

// ── Jev question wording (frozen per roster: see the file header) ───────────

/** The names a question set on `roster` lists, in this list's order. */
export function jevBlueChips(roster: JevRoster): { companies: string[]; people: string[] } {
  const on = (kind: BluePlayerKind) =>
    BLUE_CHIP_PLAYERS.flatMap((p) => (p.kind === kind && p.jevLabel && p.jevRoster !== null && p.jevRoster <= roster ? [p.jevLabel] : []));
  return { companies: on('company'), people: on('person') };
}

// ── Headline matchers ───────────────────────────────────────────────────────

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Morning Download's "major player": the first blue-chip name in a headline, exact case. `match[0]` is the name shown on the hub. */
export const BLUE_CHIP_HEADLINE_MATCH = new RegExp(`\\b(?:${BLUE_CHIP_PLAYERS.flatMap((p) => p.tokens).map(escape).join('|')})\\b`);

/**
 * The company key a player's stories spread under: a company's own id (or the
 * one it rolls up to), a person's primary company's. Null for a person whose
 * primary company is affiliated or who has none: affiliated companies are not
 * blue chips, so they never hold a story back.
 */
export function spreadKeyOf(p: BluePlayer): string | null {
  if (p.kind === 'company') return p.rollsUpTo ?? p.id;
  const primary = p.companyIds[0] ? byId.get(p.companyIds[0]) : undefined;
  return primary ? spreadKeyOf(primary) : null;
}

/** One case-insensitive pattern per company key, in this list's order. */
export const BLUE_CHIP_SPREAD_KEYS: ReadonlyArray<[key: string, pattern: RegExp]> = (() => {
  const sources = new Map<string, string[]>();
  for (const p of BLUE_CHIP_PLAYERS) {
    const key = p.aliases.length > 0 ? spreadKeyOf(p) : null;
    if (key) sources.set(key, [...(sources.get(key) ?? []), ...p.aliases]);
  }
  return [...sources].map(([key, alias]): [string, RegExp] => [key, new RegExp(`\\b(${alias.join('|')})\\b`, 'i')]);
})();
