/**
 * The one new adapter: vendor docs and help-center release-note pages, as HTML
 * or markdown. `fetchText` is injected so tests run on fixtures.
 *
 * A page with dated headings (a changelog) yields one item per dated section,
 * addressed by an anchor; with `split: 'entries'` each dated block instead yields
 * one item per top-level bullet, fixes and chores dropped, at
 * `pageUrl#block-anchor-<entryHash>` (see `entryItems`). A page without them yields one item for the page,
 * unless `split: 'sections'` is set (single-page guides): then it yields one
 * undated item per `##` / `<h2>` section, at `pageUrl#section-slug`, so a guide
 * gives many tips over time instead of one. A section too long for one
 * candidate is split again at its `###` / `<h3>` subsections; navigation
 * sections ("Next steps") and stubs are dropped.
 *
 * Date shapes read: "October 28, 2026", "2026-10-13", "2026.10.13", a trailing
 * " - 2026-10-13" ("Announcements: v0.64.0 - 2026-10-13"); in markdown also a
 * bold version line followed by a date line ("**2.1.318**" then "November 4,
 * 2026"); in HTML also list entries whose id carries an ISO date
 * (`<li id="codex-2026-10-29-cli">`) or whose header holds a `<time>` date
 * (`<li id="github-release-435979892">`). Items come newest first as the page
 * lists them, capped at `maxItems` so a 1 MB changelog is not 300 candidates.
 * The fetch itself is injected: registry pages are fixed public URLs; a
 * person-supplied link goes through `fetchPageFollowingRedirects` with
 * `blockPrivate` in `live.ts`, which then calls `parseDocsPage`.
 */
import { htmlToText, markdownToText, parsePage } from '@/lib/reels/net/html';
import { parseUtcDateHeading } from '@/lib/reels/net/published';
import { slugifyHeading } from '@/lib/reels/adapters/markdown-changelog';
import type { AdapterItem } from '@/lib/reels/types';
import { UNTRUSTED_MAX_CHARS } from './candidate';

export type FetchText = (url: string) => Promise<string>;

export type DocsAdapterConfig = {
  id: string;
  name: string;
  /** Human-facing page; anchors and the single-page URL are built on it. */
  pageUrl: string;
  /** Where to fetch from (defaults to pageUrl); a `.md` twin is fine. */
  fetchUrl?: string;
  format?: 'html' | 'markdown' | 'auto';
  /** Most items kept from one page (default 25), newest first. */
  maxItems?: number;
  /**
   * 'sections': an undated page becomes one item per section instead of one page item.
   * 'entries': a dated changelog becomes one item per top-level entry of each dated block (fixes and chores
   * dropped); `maxItems` then caps the blocks read and `maxEntries` the items kept.
   */
  split?: 'sections' | 'entries';
  /** Most entry items kept from one page with `split: 'entries'` (default 60), newest block first. */
  maxEntries?: number;
  fetchText: FetchText;
};

export const DOCS_MAX_ITEMS = 25;

const LONG_DATE = /([A-Z][a-z]+ \d{1,2},? \d{4})/;
const NUM_DATE = /(\d{4})[-.](\d{2})[-.](\d{2})/;
const DATE_TEXT = /^(?:[A-Z][a-z]+ \d{1,2},? \d{4}|\d{4}[-.]\d{2}[-.]\d{2}|.{1,60} - \d{4}-\d{2}-\d{2})$/;

function numericDate(y: string, m: string, d: string): Date | null {
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d) ? date : null;
}

/** The date a heading or date line names, as UTC midnight; null when it is not a date heading. */
export function headingDate(text: string): Date | null {
  if (!DATE_TEXT.test(text)) return null;
  const long = text.match(LONG_DATE);
  if (long) return parseUtcDateHeading(long[1]);
  const num = text.match(NUM_DATE);
  return num ? numericDate(num[1], num[2], num[3]) : null;
}
const HEADING_HTML = /<h([2-4])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;

type Section = { heading: string; date: Date | null; id: string | null; bodyHtml: string };

function attrId(attrs: string): string | null {
  return attrs.match(/\bid=["']([^"']+)["']/i)?.[1] ?? null;
}

/** Split HTML on date-titled headings. Returns [] when the page has none. */
export function splitHtmlSections(html: string): Section[] {
  const main = html.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? html;
  const marks: { heading: string; date: Date; id: string | null; start: number; end: number }[] = [];
  for (const m of main.matchAll(HEADING_HTML)) {
    const heading = htmlToText(m[3]).replace(/\s+/g, ' ').trim();
    const date = headingDate(heading);
    if (!date) continue;
    marks.push({ heading, date, id: attrId(m[2]), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  if (marks.length === 0) return splitDatedEntries(main);
  return marks.map((mark, i) => ({
    heading: mark.heading,
    date: mark.date,
    id: mark.id,
    bodyHtml: main.slice(mark.end, marks[i + 1]?.start ?? main.length),
  }));
}

const ENTRY_LI = /<li\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi;
const ENTRY_TIME = /<time\b[^>]*>\s*(\d{4})-(\d{2})-(\d{2})\s*<\/time>/i;

/** An entry's date: an ISO date in its id, else a `<time>YYYY-MM-DD</time>` in its header (before its first heading). */
function entryDate(id: string, after: string): Date | null {
  const num = id.match(NUM_DATE);
  if (num) return numericDate(num[1], num[2], num[3]);
  const head = after.slice(0, 1500);
  const firstHeading = head.search(/<h[1-6]\b/i);
  const t = (firstHeading >= 0 ? head.slice(0, firstHeading) : head).match(ENTRY_TIME);
  return t ? numericDate(t[1], t[2], t[3]) : null;
}

/**
 * Changelog entries as `<li id="...">` holding a title heading, dated by an ISO date in the id
 * (`codex-2026-10-29-cli`) or by a `<time>` in the entry header (`github-release-435979892`). An entry
 * that wraps its text in `<article>` ends at that article's close, so the next month's header is not in it.
 */
function splitDatedEntries(main: string): Section[] {
  const marks: { id: string; date: Date; start: number; end: number }[] = [];
  for (const m of main.matchAll(ENTRY_LI)) {
    const end = (m.index ?? 0) + m[0].length;
    const date = entryDate(m[1], main.slice(end));
    if (date) marks.push({ id: m[1], date, start: m.index ?? 0, end });
  }
  return marks
    .map((mark, i): Section | null => {
      let bodyHtml = main.slice(mark.end, marks[i + 1]?.start ?? main.length);
      const open = bodyHtml.search(/<article\b/i);
      const close = bodyHtml.indexOf('</article>');
      if (open >= 0 && close > open) bodyHtml = bodyHtml.slice(0, close);
      const title = bodyHtml.match(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/i)?.[1];
      const heading = title ? htmlToText(title).replace(/\s+/g, ' ').trim() : '';
      return heading ? { heading, date: mark.date, id: mark.id, bodyHtml } : null;
    })
    .filter((x): x is Section => x !== null);
}

function splitMarkdownSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let current: { heading: string; date: Date; lines: string[] } | null = null;
  const flush = () => {
    if (current) sections.push({ heading: current.heading, date: current.date, id: null, bodyHtml: current.lines.join('\n') });
  };
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(/^#{2,4}\s+(.+?)\s*$/);
    const date = m ? headingDate(m[1]) : null;
    if (m && date) {
      flush();
      current = { heading: m[1], date, lines: [] };
      continue;
    }
    // "**2.1.318**" then a blank line then "November 4, 2026": a version block.
    const bold = line.match(/^\*\*([^*]+)\*\*\s*$/);
    if (bold) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      const versionDate = j < lines.length && j - i <= 3 ? headingDate(lines[j].trim()) : null;
      if (versionDate) {
        flush();
        current = { heading: `${bold[1]} (${lines[j].trim()})`, date: versionDate, lines: [] };
        i = j;
        continue;
      }
    }
    current?.lines.push(line);
  }
  flush();
  return sections;
}

// ── Undated guides split by section ─────────────────────────────────────────

/** A section shorter than this (as text) is a stub or a link list, not a tip. */
export const GUIDE_SECTION_MIN_CHARS = 400;
/** A section longer than this is split again at its subsections (the candidate text cap). */
export const GUIDE_SECTION_MAX_CHARS = UNTRUSTED_MAX_CHARS;
const NAV_HEADING = /^(next steps|see also|related|resources|other resources|further reading|overview|introduction|topic-specific prompt guides)$/i;

type GuideSection = { heading: string; anchor: string; text: string };
type RawSection = { level: 2 | 3; heading: string; anchor: string | null; body: string };

/** `## Title  {% id="x" %}` -> title and its explicit anchor. */
function markdownHeading(raw: string): { heading: string; anchor: string | null } {
  const anchor = raw.match(/\{%\s*id=["']([^"']+)["']\s*%\}/)?.[1] ?? null;
  return { heading: raw.replace(/\{%[^%]*%\}/g, '').replace(/\s+/g, ' ').trim(), anchor };
}

function rawMarkdownSections(markdown: string): RawSection[] {
  const out: RawSection[] = [];
  let current: RawSection | null = null;
  // The open code fence (its character run), so a `## ` line inside code is not a heading. A heading that
  // carries a template id (`{% id="x" %}`) is never code: it also closes a fence a malformed page left open.
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    const m = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (m && /\{%\s*id=/.test(m[2])) fence = null;
    else if (marker && fence === null) fence = marker[1];
    else if (marker && fence && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === '') fence = null;
    if (m && fence === null) {
      if (current) out.push(current);
      const { heading, anchor } = markdownHeading(m[2]);
      current = { level: m[1].length as 2 | 3, heading, anchor, body: '' };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) out.push(current);
  return out;
}

function rawHtmlSections(html: string): RawSection[] {
  const main = html.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? html;
  const marks = [...main.matchAll(/<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)];
  return marks.map((m, i) => ({
    level: Number(m[1]) as 2 | 3,
    heading: htmlToText(m[3]).replace(/\s+/g, ' ').trim(),
    anchor: attrId(m[2]),
    body: main.slice((m.index ?? 0) + m[0].length, marks[i + 1]?.index ?? main.length),
  }));
}

/**
 * One section per `##` (with its `###` text folded in); a section longer than
 * GUIDE_SECTION_MAX_CHARS that has subsections becomes one section per `###`.
 * Anchors: the page's own id when it gives one, else the slug; repeats get `-2`.
 */
export function splitGuideSections(content: string, format: 'html' | 'markdown'): GuideSection[] {
  const raw = format === 'html' ? rawHtmlSections(content) : rawMarkdownSections(content);
  const toText = (body: string) => (format === 'html' ? htmlToText(body) : markdownToText(body));
  const used = new Map<string, number>();
  const anchorOf = (r: RawSection) => {
    const base = r.anchor ?? slugifyHeading(r.heading);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  const out: GuideSection[] = [];
  const keep = (heading: string, anchor: string, text: string) => {
    if (text.length >= GUIDE_SECTION_MIN_CHARS) out.push({ heading, anchor, text });
  };
  for (let i = 0; i < raw.length; i += 1) {
    const top = raw[i];
    if (top.level !== 2) continue;
    const subs: RawSection[] = [];
    while (raw[i + 1]?.level === 3) subs.push(raw[(i += 1)]);
    if (!top.heading || NAV_HEADING.test(top.heading)) continue;
    const intro = toText(top.body);
    const whole = [intro, ...subs.map((s) => `${s.heading}\n${toText(s.body)}`)].filter(Boolean).join('\n\n');
    const topAnchor = anchorOf(top);
    if (whole.length <= GUIDE_SECTION_MAX_CHARS || subs.length === 0) {
      keep(top.heading, topAnchor, whole);
      continue;
    }
    keep(top.heading, topAnchor, intro);
    for (const sub of subs) keep(`${top.heading} / ${sub.heading}`, anchorOf(sub), toText(sub.body));
  }
  return out;
}

// ── Dated changelogs split by entry ─────────────────────────────────────────

/** Most entry items kept from one page across its dated blocks (newest first), when `split: 'entries'`. */
export const DOCS_MAX_ENTRIES = 60;

/**
 * A group heading whose entries are only fixes or chores ("Bug fixes", "90 bug fixes", "Improvements and bug fixes",
 * "Fixes & improvements", "Chores", "Documentation", a GitHub release's PR list "Changelog"). Code rule, no model.
 */
// "Changed" and "improvements" groups are dropped too (Tommy, 2026-11-08): new features ("Added"/"New") make the tips.
const FIX_GROUP = /\bfix(es|ed)?\b|\bbug ?fix(es)?\b|\bimprovements?\b|^(changed|changes|chores?|changelog|full changelog|documentation|docs|internal( changes)?|maintenance|dependencies|dependency updates)$/i;
/** An entry that is only a fix or chore, read after any `[Label]` / `Label:` prefix ("Gateway: Fixed ..."). */
const FIX_LEAD = /^(fix(es|ed)?|bug ?fix(es)?|bugs?|improved|improves?|changed|internal|chores?)\b/i;
const LABEL_PREFIX = /^(?:\[[^\]]{1,40}\]\s*|(?:[A-Z][\w.+-]*)(?:\s+[\w.+-]+){0,3}:\s+)/;

export function isFixGroup(heading: string | null): boolean {
  return !!heading && FIX_GROUP.test(heading.replace(/[*_`]/g, '').trim());
}

export function isFixEntry(text: string): boolean {
  let t = text.replace(/^[-*+]\s+/, '').trim();
  for (let i = 0; i < 3; i += 1) {
    if (FIX_LEAD.test(t)) return true;
    const next = t.replace(LABEL_PREFIX, '');
    if (next === t) break;
    t = next;
  }
  return FIX_LEAD.test(t);
}

/** FNV-1a 32-bit, 8 hex chars: a short id for an entry that does not change between runs while its text does not. */
export function entryHash(text: string): string {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i += 1) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

type RawEntry = { group: string | null; text: string };

/** Top-level `<li>` items of an HTML block (nested lists stay inside their item), each with the heading above it. */
function htmlEntries(html: string): RawEntry[] {
  const out: RawEntry[] = [];
  let depth = 0;
  let group: string | null = null;
  let open: number | null = null;
  const close = (at: number) => {
    if (open === null) return;
    const text = tidyEntry(htmlToText(html.slice(open, at)));
    if (text) out.push({ group, text });
    open = null;
  };
  const tags = /<(\/?)(ul|ol|li|h[1-6])\b[^>]*>/gi;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      if (closing) {
        depth = Math.max(0, depth - 1);
        if (depth === 0) close(m.index);
      } else depth += 1;
    } else if (tag === 'li') {
      if (depth !== 1) continue;
      if (closing) close(m.index);
      else {
        close(m.index);
        open = m.index + m[0].length;
      }
    } else if (!closing && depth === 0) {
      const end = html.indexOf(`</${tag}>`, m.index);
      if (end > 0) {
        group = htmlToText(html.slice(m.index + m[0].length, end)).replace(/\s+/g, ' ').trim() || group;
        tags.lastIndex = end;
      }
    }
  }
  close(html.length);
  return out;
}

/**
 * Markdown entry text: links and emphasis dropped, inline code kept as written (markdownToText also strips every
 * `_`, which breaks names like `CLAUDE_CODE_DISABLE_FEATURE_FLAGS`), `\\[` unescaped, lines joined.
 */
function entryMarkdownText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\\([[\]*_`])/g, '$1')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[*+-]|\d+[.)])\s+/, '- ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** "( #58238 , #58239 )" pull-request lists and the space htmlToText leaves before punctuation. */
const tidyEntry = (text: string) =>
  text.replace(/\s*\(\s*#\d+(?:\s*,\s*#\d+)*\s*\)/g, '').replace(/\s+([.,;:!?)])/g, '$1').replace(/\(\s+/g, '(').trim();

/** Top-level `*` / `-` / `1.` items of a markdown block (indented lines stay with their item), each with its group line. */
function markdownEntries(markdown: string): RawEntry[] {
  const out: RawEntry[] = [];
  let group: string | null = null;
  let current: string[] | null = null;
  const flush = () => {
    if (current) {
      const text = entryMarkdownText(current.join('\n'));
      if (text) out.push({ group, text });
    }
    current = null;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const item = line.match(/^(?:[*+-]|\d+[.)])\s+(.*)$/);
    if (item) {
      flush();
      current = [item[1]];
      continue;
    }
    if (line.trim() === '') continue;
    if (/^\s{2,}\S/.test(line) && current) {
      current.push(line);
      continue;
    }
    flush();
    const heading = line.match(/^\*\*([^*]+)\*\*\s*:?\s*$/) ?? line.match(/^#{2,6}\s+(.+?)\s*$/);
    if (heading) group = heading[1].trim();
  }
  flush();
  return out;
}

const PRODUCT_SUFFIX = /\s+(changelog|release notes|releases|updates)$/i;
const DATE_IN_TEXT = new RegExp(`${LONG_DATE.source}|${NUM_DATE.source}`);
const longDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "Claude Code 2.1.319 (November 6, 2026)", "Codex CLI 0.167.0 (November 6, 2026)": what the entry belongs to. */
function blockContext(name: string, s: Section): string {
  const product = name.replace(PRODUCT_SUFFIX, '').trim() || name;
  const heading = s.heading.replace(/\s+/g, ' ').trim();
  const named = heading.toLowerCase().includes(product.toLowerCase())
    ? heading
    : /^v?\d/.test(heading) ? `${product} ${heading}` : `${product}: ${heading}`;
  return DATE_IN_TEXT.test(heading) || !s.date ? named : `${named} (${longDate(s.date)})`;
}

const firstLine = (text: string, max: number) => {
  const line = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 3).trimEnd()}...` : line;
};

/**
 * Each dated block as one item per top-level entry (bullet), so a release that bundles many changes becomes one
 * candidate per change. Fix/chore entries and groups are dropped (isFixEntry, isFixGroup). Each item keeps the
 * block's date, names the product and version/date in its headline and body so it reads alone, and is addressed
 * `pageUrl#<block-anchor>-<entryHash>` (same text, same link, every run). A block with no list entries stays one
 * item, as before.
 */
function entryItems(sections: readonly Section[], format: 'html' | 'markdown', name: string, pageUrl: string, max: number): AdapterItem[] {
  const out: AdapterItem[] = [];
  for (const s of sections) {
    if (out.length >= max) break;
    const anchor = s.id ?? slugifyHeading(s.heading);
    const context = blockContext(name, s);
    const entries = format === 'html' ? htmlEntries(s.bodyHtml) : markdownEntries(s.bodyHtml);
    if (entries.length === 0) {
      const body = format === 'html' ? htmlToText(s.bodyHtml) : markdownToText(s.bodyHtml);
      if (body) out.push({ canonicalUrl: `${pageUrl}#${anchor}`, headline: `${name}: ${s.heading}`, body, author: null, byline: name, publishTime: s.date, textIsComplete: true });
      continue;
    }
    const seen = new Set<string>();
    for (const e of entries) {
      if (out.length >= max) break;
      if (isFixGroup(e.group) || isFixEntry(e.text)) continue;
      const hash = entryHash(e.text);
      if (seen.has(hash)) continue;
      seen.add(hash);
      const where = e.group && e.group !== s.heading ? `${context}, ${e.group}` : context;
      out.push({
        canonicalUrl: `${pageUrl}#${anchor}-${hash}`,
        headline: `${context}: ${firstLine(e.text, 200)}`,
        body: `${e.text}\n\nFrom the ${name}: ${where}.`,
        author: null,
        byline: name,
        publishTime: s.date,
        textIsComplete: true,
      });
    }
  }
  return out;
}

export function parseDocsPage(
  content: string,
  config: Pick<DocsAdapterConfig, 'name' | 'pageUrl' | 'format' | 'maxItems' | 'maxEntries' | 'split'>,
): AdapterItem[] {
  const looksHtml = /<\s*(html|body|article|main|h[1-6]|div|p)\b/i.test(content);
  const format = config.format && config.format !== 'auto' ? config.format : looksHtml ? 'html' : 'markdown';

  const sections = format === 'html' ? splitHtmlSections(content) : splitMarkdownSections(content);
  if (sections.length > 0 && config.split === 'entries') {
    return entryItems(sections.slice(0, config.maxItems ?? DOCS_MAX_ITEMS), format, config.name, config.pageUrl, config.maxEntries ?? DOCS_MAX_ENTRIES);
  }
  if (sections.length > 0) {
    return sections
      .slice(0, config.maxItems ?? DOCS_MAX_ITEMS)
      .map((s): AdapterItem | null => {
        const body = format === 'html' ? htmlToText(s.bodyHtml) : markdownToText(s.bodyHtml);
        if (!body) return null;
        return {
          canonicalUrl: `${config.pageUrl}#${s.id ?? slugifyHeading(s.heading)}`,
          headline: `${config.name}: ${s.heading}`,
          body,
          author: null,
          byline: config.name,
          publishTime: s.date,
          textIsComplete: true,
        };
      })
      .filter((x): x is AdapterItem => x !== null);
  }

  // No dated sections: a guide becomes one undated item per section.
  if (config.split === 'sections') {
    const parts = splitGuideSections(content, format);
    if (parts.length > 0) {
      return parts.slice(0, config.maxItems ?? DOCS_MAX_ITEMS).map((p) => ({
        canonicalUrl: `${config.pageUrl}#${p.anchor}`,
        headline: `${config.name}: ${p.heading}`,
        body: p.text,
        author: null,
        byline: config.name,
        publishTime: null,
        textIsComplete: true,
      }));
    }
  }

  // No dated sections: the whole page is one item.
  if (format === 'html') {
    const page = parsePage(content);
    if (page.paywalled || !page.text) return [];
    return [{
      canonicalUrl: config.pageUrl,
      headline: page.title ?? config.name,
      body: page.text,
      author: page.author,
      byline: config.name,
      publishTime: page.publishedAt,
      textIsComplete: true,
    }];
  }
  const text = markdownToText(content);
  if (!text) return [];
  // Some docs twins tag headings with template attributes (`# Title {% id="x" %}`); the title drops them.
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.replace(/\{%[^%]*%\}/g, '').trim() || config.name;
  return [{ canonicalUrl: config.pageUrl, headline: title, body: text, byline: config.name, publishTime: null, textIsComplete: true }];
}

export async function fetchDocsItems(config: DocsAdapterConfig, since?: Date): Promise<AdapterItem[]> {
  const content = await config.fetchText(config.fetchUrl ?? config.pageUrl);
  const items = parseDocsPage(content, config);
  return since ? items.filter((i) => !i.publishTime || i.publishTime >= since) : items;
}
