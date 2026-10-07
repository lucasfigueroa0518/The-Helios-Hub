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
 * say-so, after checking `domains` and `editorialUse`. Each row also carries
 * the company's credit text and its logo permission (logo cards).
 */

export type EditorialUse = 'permitted' | 'not-permitted' | 'TBD';

/**
 * Logo cards (spec §5.1 (b); Tommy, 2026-10-07): `allowed`; `needs-permission`
 * (the company's brand guidelines require prior approval); `off` (not for now).
 */
export type LogoPermission = 'allowed' | 'needs-permission' | 'off';

export type OfficialCompany = {
  /** Display name, used in the credit ("Image: Google"). */
  company: string;
  /** Names a brief's SUBJECTS entry may use for this company (case-insensitive, exact). */
  names: string[];
  /** Official domains; a page matches its domain or any subdomain of it. */
  domains: string[];
  /** Only pages whose path starts with one of these (e.g. an image gallery). Absent: any path. */
  pathPrefixes?: string[];
  /** The on-slide credit for its official images, exactly as the company asks (Tommy, 2026-10-07). */
  credit: string;
  /** May its logo be used on a logo cover card? */
  logo: LogoPermission;
  /** Do the company's press terms permit editorial use of its newsroom images? */
  editorialUse: EditorialUse;
  /** Where the terms were read (filled when checked). */
  termsUrl: string | null;
  /** Tommy's approval of this row. Never true without it. */
  approved: boolean;
};

/**
 * Rows (Tommy, 2026-10-07). Official images: Google and Microsoft approved;
 * every other row TBD (off). Logos: allowed for Mistral AI, OpenAI, Google;
 * needs permission for Anthropic, Nvidia, xAI; off for Meta, Microsoft.
 */
export const OFFICIAL_COMPANIES: OfficialCompany[] = [
  { company: 'Anthropic', names: ['Anthropic'], domains: ['anthropic.com', 'claude.com'], credit: 'Image: Anthropic', logo: 'needs-permission', editorialUse: 'TBD', termsUrl: null, approved: false },
  { company: 'OpenAI', names: ['OpenAI'], domains: ['openai.com'], credit: 'Image: OpenAI', logo: 'allowed', editorialUse: 'TBD', termsUrl: null, approved: false },
  { company: 'Google', names: ['Google', 'Google DeepMind', 'Alphabet'], domains: ['blog.google', 'google.com', 'deepmind.google'], credit: 'Source: Google', logo: 'allowed', editorialUse: 'permitted', termsUrl: null, approved: true },
  { company: 'Meta', names: ['Meta', 'Meta Platforms'], domains: ['meta.com', 'about.fb.com', 'ai.meta.com'], credit: 'Image: Meta', logo: 'off', editorialUse: 'TBD', termsUrl: null, approved: false },
  // Image gallery only. The gallery's exact path on news.microsoft.com is TO CONFIRM (the site refuses scripted requests);
  // until it matches, no Microsoft page counts.
  { company: 'Microsoft', names: ['Microsoft'], domains: ['news.microsoft.com'], pathPrefixes: ['/imagegallery', '/image-gallery'], credit: 'Used with permission from Microsoft', logo: 'off', editorialUse: 'permitted', termsUrl: null, approved: true },
  { company: 'Nvidia', names: ['Nvidia', 'NVIDIA'], domains: ['nvidia.com', 'nvidianews.nvidia.com', 'blogs.nvidia.com'], credit: 'Image: Nvidia', logo: 'needs-permission', editorialUse: 'TBD', termsUrl: null, approved: false },
  { company: 'Mistral AI', names: ['Mistral AI', 'Mistral'], domains: ['mistral.ai'], credit: 'Image: Mistral AI', logo: 'allowed', editorialUse: 'TBD', termsUrl: null, approved: false },
  { company: 'xAI', names: ['xAI'], domains: ['x.ai'], credit: 'Image: xAI', logo: 'needs-permission', editorialUse: 'TBD', termsUrl: null, approved: false },
];

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const pathOf = (url: string) => {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
};

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
  const path = pathOf(pageUrl!);
  const company = list.find((c) => c.names.some((n) => inStory.has(n.toLowerCase())) && c.domains.some((d) => onDomain(host, d)) && (!c.pathPrefixes || c.pathPrefixes.some((p) => path.startsWith(p))));
  if (!company) return { status: 'none' };
  if (!company.approved) return { status: 'not-approved', company, reason: `${company.company} row not approved yet` };
  if (company.editorialUse !== 'permitted') return { status: 'not-approved', company, reason: `${company.company} press terms: editorial use ${company.editorialUse}` };
  return { status: 'official', company };
}

/** The listed company a SUBJECTS name refers to, if any (for cover lookups). */
export function listedCompany(name: string, list: OfficialCompany[] = OFFICIAL_COMPANIES): OfficialCompany | null {
  return list.find((c) => c.names.some((n) => n.toLowerCase() === name.toLowerCase())) ?? null;
}

/** The per-company credit (Tommy, 2026-10-07: e.g. "Source: Google", "Used with permission from Microsoft"). */
export const officialCredit = (c: OfficialCompany) => c.credit;

/** May this company's logo go on a logo card? Unlisted organizations have no permission record, so no. */
export function logoPermission(name: string, list: OfficialCompany[] = OFFICIAL_COMPANIES): { ok: true; company: OfficialCompany } | { ok: false; reason: string } {
  const c = listedCompany(name, list);
  if (!c) return { ok: false, reason: `${name} is not on the allow-list (no logo permission on record)` };
  if (c.logo === 'allowed') return { ok: true, company: c };
  return { ok: false, reason: c.logo === 'needs-permission' ? `${c.company}'s brand guidelines require prior approval for logo use` : `${c.company} logo cards are off for now` };
}
