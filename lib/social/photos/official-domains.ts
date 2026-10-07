/**
 * Which domains belong to which company (photo spec §2, official
 * announcement images): a plain list. No approval column, no per-company
 * terms. A page on one of a company's domains, when that company is a
 * SUBJECTS entry, is the company's own page: its images are official
 * images, credited "Image: <Company>" (spec §3 rule 4: the page counts as
 * the caption).
 *
 * Plain data, reviewed by Tommy. A news site about a company is never its
 * own (9to5google.com is not Google's), and only the company's news and
 * blog sections count (support.google.com does not).
 */
/** A company's own news or blog section: a host (exact, "www." ignored) and, unless the whole host is news, a path prefix. */
export type NewsPath = { host: string; path?: string };

export type OfficialDomains = { company: string; names: string[]; paths: NewsPath[] };

/**
 * Each company's own news and blog sections only (Tommy, 2026-10-07): no fan
 * or news sites, no support, product or docs pages.
 */
export const OFFICIAL_DOMAINS: OfficialDomains[] = [
  { company: 'Anthropic', names: ['Anthropic'], paths: [{ host: 'anthropic.com', path: '/news/' }, { host: 'claude.com', path: '/blog/' }] },
  { company: 'OpenAI', names: ['OpenAI'], paths: [{ host: 'openai.com', path: '/index/' }, { host: 'openai.com', path: '/news/' }] },
  { company: 'Google', names: ['Google', 'Alphabet'], paths: [{ host: 'blog.google' }] },
  { company: 'Google DeepMind', names: ['Google DeepMind', 'DeepMind'], paths: [{ host: 'deepmind.google', path: '/discover/blog/' }, { host: 'blog.google', path: '/technology/google-deepmind/' }] },
  { company: 'Meta', names: ['Meta', 'Meta Platforms'], paths: [{ host: 'about.fb.com', path: '/news/' }, { host: 'ai.meta.com', path: '/blog/' }] },
  { company: 'Microsoft', names: ['Microsoft'], paths: [{ host: 'blogs.microsoft.com' }, { host: 'news.microsoft.com' }] },
  { company: 'Nvidia', names: ['Nvidia', 'NVIDIA'], paths: [{ host: 'nvidianews.nvidia.com' }, { host: 'blogs.nvidia.com' }] },
  { company: 'Mistral AI', names: ['Mistral AI', 'Mistral'], paths: [{ host: 'mistral.ai', path: '/news/' }] },
  { company: 'xAI', names: ['xAI'], paths: [{ host: 'x.ai', path: '/news/' }] },
];

const partsOf = (url: string): { host: string; path: string } | null => {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase().replace(/^www\./, ''), path: u.pathname };
  } catch {
    return null;
  }
};

const onPath = (at: { host: string; path: string }, p: NewsPath) => at.host === p.host && (!p.path || at.path.startsWith(p.path));

/** The SUBJECTS entry whose own page this is, or null. */
export function officialSubjectOf<S extends { id: string; name: string }>(pageUrl: string | null, subjects: S[], list: OfficialDomains[] = OFFICIAL_DOMAINS): { subject: S; company: OfficialDomains } | null {
  const at = pageUrl ? partsOf(pageUrl) : null;
  if (!at) return null;
  for (const company of list) {
    if (!company.paths.some((p) => onPath(at, p))) continue;
    const subject = subjects.find((s) => company.names.some((n) => n.toLowerCase() === s.name.trim().toLowerCase()));
    if (subject) return { subject, company };
  }
  return null;
}
