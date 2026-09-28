/**
 * Client-side tool given to the Reporter: fetch a URL and return the cleaned
 * page text. Reuses `extractArticleBody` from ingest, which runs Firefox's
 * Readability against the HTML — the same code path the ingest layer uses.
 *
 * The Reporter calls this both while researching (following links found by
 * `web_search`) and, less directly, to preview candidate sources before
 * putting them in the brief's SOURCES list. After the brief is written, the
 * orchestrator calls `fetchPage` in code (not through the tool) on every URL
 * in SOURCES so the source texts can be passed to Writer/Editor/Fact-checker.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { extractArticleBody } from '@/lib/social/ingest/extract-article-body';

/** Max characters returned to the model per fetch — keeps tokens sane. */
const MAX_RETURN_CHARS = 50_000;

export type FetchPageResult =
  | { ok: true; url: string; resolvedUrl: string; title: string | null; byline: string | null; text: string }
  | { ok: false; url: string; error: string };

export async function fetchPage(url: string): Promise<FetchPageResult> {
  try {
    const body = await extractArticleBody(url, { minTextLength: 200 });
    if (!body) {
      return { ok: false, url, error: 'fetch or extraction failed' };
    }
    return {
      ok: true,
      url,
      resolvedUrl: body.resolvedUrl,
      title: body.title,
      byline: body.byline,
      text: body.text.slice(0, MAX_RETURN_CHARS),
    };
  } catch (err) {
    return { ok: false, url, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Tool definition given to Reporter's messages.create call. */
export const FETCH_PAGE_TOOL: Anthropic.Tool = {
  name: 'fetch_page',
  description:
    'Fetch the full text of one web page by URL. Returns the cleaned article body (headers/footers stripped) or an error. Use to read a source you found via web_search before citing it.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The absolute URL of the page to fetch.',
      },
    },
    required: ['url'],
  },
};

/** Stringify a fetch result for the tool_result block the model receives. */
export function fetchResultToToolContent(result: FetchPageResult): string {
  if (!result.ok) return `ERROR fetching ${result.url}: ${result.error}`;
  const header = [
    `URL: ${result.url}`,
    result.resolvedUrl !== result.url ? `RESOLVED URL: ${result.resolvedUrl}` : null,
    result.title ? `TITLE: ${result.title}` : null,
    result.byline ? `BYLINE: ${result.byline}` : null,
  ].filter(Boolean).join('\n');
  return `${header}\n\n${result.text}`;
}
