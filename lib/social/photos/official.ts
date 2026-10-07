/**
 * Official images (spec §5.1 image strategy (a); Tommy approved the build
 * 2026-10-07): images on a SUBJECTS company's own announcement page are the
 * company's own, credited by code "Image: <Company>".
 *
 * A page counts only when its host is one of the company's official
 * domains in this allow-list AND Tommy has approved the company's row
 * (domains + whether its press terms permit editorial use). Pages outside
 * the list, and rows not yet approved, stay "unknown" (not used).
 *
 * Rows are TBD until Tommy approves them: set `approved: true` only on his
 * say-so, after checking `domains` and `editorialUse`.
 */

export type EditorialUse = 'permitted' | 'not-permitted' | 'TBD';

export type OfficialCompany = {
  /** Display name, used in the credit ("Image: Google"). */
  company: string;
  /** Names a brief's SUBJECTS entry may use for this company (case-insensitive, exact). */
  names: string[];
  /** Official domains; a page matches its domain or any subdomain of it. */
  domains: string[];
  /** Do the company's press terms permit editorial use of its newsroom images? */
  editorialUse: EditorialUse;
  /** Where the terms were read (filled when checked). */
  termsUrl: string | null;
  /** Tommy's approval of this row. Never true without it. */
  approved: boolean;
};

/** Starting rows (2026-10-07): domains and terms are proposals, all TBD for Tommy's approval. */
export const OFFICIAL_COMPANIES: OfficialCompany[] = [
  { company: 'Anthropic', names: ['Anthropic'], domains: ['anthropic.com', 'claude.com'], editorialUse: 'TBD', termsUrl: null, approved: false },
  { company: 'OpenAI', names: ['OpenAI'], domains: ['openai.com'], editorialUse: 'TBD', termsUrl: null, approved: false },
  { company: 'Google', names: ['Google', 'Google DeepMind', 'Alphabet'], domains: ['google.com', 'blog.google', 'deepmind.google', 'googleblog.com', 'abc.xyz'], editorialUse: 'TBD', termsUrl: null, approved: false },
  { company: 'Meta', names: ['Meta', 'Meta Platforms'], domains: ['meta.com', 'about.fb.com', 'ai.meta.com'], editorialUse: 'TBD', termsUrl: null, approved: false },
  { company: 'Microsoft', names: ['Microsoft'], domains: ['microsoft.com', 'blogs.microsoft.com', 'news.microsoft.com'], editorialUse: 'TBD', termsUrl: null, approved: false },
  { company: 'Nvidia', names: ['Nvidia', 'NVIDIA'], domains: ['nvidia.com', 'nvidianews.nvidia.com', 'blogs.nvidia.com'], editorialUse: 'TBD', termsUrl: null, approved: false },
  { company: 'Mistral AI', names: ['Mistral AI', 'Mistral'], domains: ['mistral.ai'], editorialUse: 'TBD', termsUrl: null, approved: false },
  { company: 'xAI', names: ['xAI'], domains: ['x.ai'], editorialUse: 'TBD', termsUrl: null, approved: false },
];

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export type OfficialPage =
  | { status: 'official'; company: OfficialCompany }
  /** On a listed company's domain, but the row isn't approved (or terms don't permit editorial use). */
  | { status: 'not-approved'; company: OfficialCompany; reason: string }
  | { status: 'none' };

/**
 * Is `pageUrl` an official page of one of the story's SUBJECTS companies?
 * The company must be in SUBJECTS (a story about Google doesn't make a
 * Microsoft page official), the host must be on its listed domains, and the
 * row must be approved with editorial use permitted.
 */
export function officialPageOf(pageUrl: string | null, subjects: string[], list: OfficialCompany[] = OFFICIAL_COMPANIES): OfficialPage {
  const host = pageUrl ? hostOf(pageUrl) : null;
  if (!host) return { status: 'none' };
  const inStory = new Set(subjects.map((s) => s.toLowerCase()));
  const company = list.find((c) => c.names.some((n) => inStory.has(n.toLowerCase())) && c.domains.some((d) => onDomain(host, d)));
  if (!company) return { status: 'none' };
  if (!company.approved) return { status: 'not-approved', company, reason: `${company.company} row not approved yet` };
  if (company.editorialUse !== 'permitted') return { status: 'not-approved', company, reason: `${company.company} press terms: editorial use ${company.editorialUse}` };
  return { status: 'official', company };
}

/** The listed company a SUBJECTS name refers to, if any (for cover lookups). */
export function listedCompany(name: string, list: OfficialCompany[] = OFFICIAL_COMPANIES): OfficialCompany | null {
  return list.find((c) => c.names.some((n) => n.toLowerCase() === name.toLowerCase())) ?? null;
}

export const officialCredit = (c: OfficialCompany) => `Image: ${c.company}`;
