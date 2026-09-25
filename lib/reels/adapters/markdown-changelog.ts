import { markdownToText } from '@/lib/reels/net/html';
import { fetchText } from '@/lib/reels/net/http';
import type { Adapter, AdapterItem, Bucket, SourceType } from '@/lib/reels/types';

export type MarkdownChangelogConfig = {
  id: string;
  name: string;
  type: SourceType;
  bucket: Bucket;
  /** Markdown source, e.g. a docs page served with `.md` appended. */
  sourceUrl: string;
  /** Human-facing page the anchors belong to. */
  pageUrl: string;
};

export type ChangelogSection = { date: Date; heading: string; body: string };

const DATE_HEADING = /^#{2,4}\s+([A-Z][a-z]+ \d{1,2},? \d{4})\s*$/;

export function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Vendor release notes published as one long dated page. The unit is the dated
 * release rather than each bullet: a release is the thing that happened, and it
 * is the only level with a real, linkable URL.
 */
export function parseChangelog(markdown: string): ChangelogSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: ChangelogSection[] = [];
  let current: { heading: string; date: Date; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = markdownToText(current.lines.join('\n'));
    if (body.length > 0) {
      sections.push({ date: current.date, heading: current.heading, body });
    }
  };

  for (const line of lines) {
    const match = line.match(DATE_HEADING);
    if (match) {
      flush();
      const parsed = new Date(match[1].replace(',', ''));
      current = Number.isNaN(parsed.getTime())
        ? null
        : { heading: match[1], date: parsed, lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  flush();

  return sections;
}

export function markdownChangelogAdapter(config: MarkdownChangelogConfig): Adapter {
  return {
    id: config.id,
    name: config.name,
    type: config.type,
    bucket: config.bucket,
    kind: 'dated',

    async fetchItems({ since, signal }) {
      const markdown = await fetchText(config.sourceUrl, { accept: 'text/markdown, text/plain, */*', signal });

      return parseChangelog(markdown)
        .filter((section) => section.date >= since)
        .map((section): AdapterItem => ({
          // The anchor is what makes each dated release its own item; canonical
          // URLs keep fragments for exactly this case.
          canonicalUrl: `${config.pageUrl}#${slugifyHeading(section.heading)}`,
          headline: `${config.name}: ${section.heading}`,
          body: section.body,
          author: null,
          byline: config.name,
          publishTime: section.date,
          textIsComplete: true,
          rawPayload: { heading: section.heading, sourceUrl: config.sourceUrl },
        }));
    },
  };
}
