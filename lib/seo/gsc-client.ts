import { GoogleAuth, Impersonated, JWT } from 'google-auth-library';

import type { GscAnalyticsRow, GscSitemap, GscSite, SeoSearchType } from '@/lib/seo/types';

const WEBMASTERS_SCOPE = 'https://www.googleapis.com/auth/webmasters';
const ANALYTICS_URL = 'https://www.googleapis.com/webmasters/v3/sites';
const INSPECT_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

export type SearchAnalyticsQuery = {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  searchType?: SeoSearchType;
  rowLimit?: number;
  startRow?: number;
  dataState?: 'final' | 'all';
};

function parseServiceAccountJson(): Record<string, unknown> | null {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('GSC_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
}

async function getAccessToken(): Promise<string> {
  const impersonate = process.env.GSC_IMPERSONATE_SERVICE_ACCOUNT?.trim() || '';
  const json = parseServiceAccountJson();
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

  if (json) {
    const email = typeof json.client_email === 'string' ? json.client_email : '';
    if (impersonate && email && email !== impersonate) {
      const source = new JWT({
        email,
        key: typeof json.private_key === 'string' ? json.private_key : undefined,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const impersonated = new Impersonated({
        sourceClient: source,
        targetPrincipal: impersonate,
        targetScopes: [WEBMASTERS_SCOPE],
      });
      const token = await impersonated.getAccessToken();
      if (!token.token) throw new Error('Failed to impersonate Search Console service account');
      return token.token;
    }
    const jwt = new JWT({
      email,
      key: typeof json.private_key === 'string' ? json.private_key : undefined,
      scopes: [WEBMASTERS_SCOPE],
    });
    const token = await jwt.getAccessToken();
    if (!token.token) throw new Error('Failed to mint Search Console access token');
    return token.token;
  }

  const auth = new GoogleAuth({
    keyFile: keyFile || undefined,
    scopes: impersonate
      ? ['https://www.googleapis.com/auth/cloud-platform']
      : [WEBMASTERS_SCOPE],
  });
  const client = await auth.getClient();

  if (impersonate) {
    const impersonated = new Impersonated({
      sourceClient: client,
      targetPrincipal: impersonate,
      targetScopes: [WEBMASTERS_SCOPE],
    });
    const token = await impersonated.getAccessToken();
    if (!token.token) throw new Error('Failed to impersonate Search Console service account');
    return token.token;
  }

  const token = await client.getAccessToken();
  const value = typeof token === 'string' ? token : token?.token;
  if (!value) throw new Error('Failed to mint Search Console access token from ADC');
  return value;
}

async function gscFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const maxAttempts = 5;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const token = await getAccessToken();
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`Search Console API ${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, 400 * (2 ** (attempt - 1))));
      continue;
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Search Console API ${response.status}: ${body.slice(0, 400)}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
  throw lastError ?? new Error('Search Console API request failed');
}

function encodeSite(siteUrl: string): string {
  return encodeURIComponent(siteUrl);
}

export async function listSites(): Promise<GscSite[]> {
  const data = await gscFetch<{ siteEntry?: GscSite[] }>(ANALYTICS_URL);
  return data.siteEntry ?? [];
}

export async function querySearchAnalytics(input: SearchAnalyticsQuery): Promise<GscAnalyticsRow[]> {
  const rows: GscAnalyticsRow[] = [];
  const pageSize = Math.min(input.rowLimit ?? 25_000, 25_000);
  let startRow = input.startRow ?? 0;
  for (;;) {
    const data = await gscFetch<{ rows?: Array<{
      keys?: string[];
      clicks?: number;
      impressions?: number;
      ctr?: number;
      position?: number;
    }> }>(
      `${ANALYTICS_URL}/${encodeSite(input.siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        body: JSON.stringify({
          startDate: input.startDate,
          endDate: input.endDate,
          dimensions: input.dimensions ?? [],
          type: input.searchType ?? 'web',
          rowLimit: pageSize,
          startRow,
          dataState: input.dataState ?? 'final',
        }),
      },
    );
    const page = (data.rows ?? []).map((row) => ({
      keys: row.keys ?? [],
      clicks: Number(row.clicks ?? 0),
      impressions: Number(row.impressions ?? 0),
      ctr: Number(row.ctr ?? 0),
      position: Number(row.position ?? 0),
    }));
    rows.push(...page);
    if (page.length < pageSize) break;
    startRow += pageSize;
    if (startRow >= 50_000) break;
  }
  return rows;
}

export async function listSitemaps(siteUrl: string): Promise<GscSitemap[]> {
  const data = await gscFetch<{ sitemap?: Array<{
    path?: string;
    lastSubmitted?: string;
    lastDownloaded?: string;
    isPending?: boolean;
    isSitemapsIndex?: boolean;
    errors?: string | number;
    warnings?: string | number;
    contents?: unknown;
  }> }>(`${ANALYTICS_URL}/${encodeSite(siteUrl)}/sitemaps`);
  return (data.sitemap ?? []).map((item) => ({
    path: item.path ?? '',
    lastSubmitted: item.lastSubmitted ?? null,
    lastDownloaded: item.lastDownloaded ?? null,
    isPending: Boolean(item.isPending),
    isSitemapsIndex: Boolean(item.isSitemapsIndex),
    errors: Number(item.errors ?? 0),
    warnings: Number(item.warnings ?? 0),
    contents: item.contents ?? [],
  })).filter((item) => item.path);
}

export async function submitSitemap(siteUrl: string, feedpath: string): Promise<void> {
  await gscFetch(
    `${ANALYTICS_URL}/${encodeSite(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
    { method: 'PUT' },
  );
}

export async function deleteSitemap(siteUrl: string, feedpath: string): Promise<void> {
  await gscFetch(
    `${ANALYTICS_URL}/${encodeSite(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
    { method: 'DELETE' },
  );
}

export async function inspectUrl(siteUrl: string, inspectionUrl: string): Promise<unknown> {
  return gscFetch(INSPECT_URL, {
    method: 'POST',
    body: JSON.stringify({ inspectionUrl, siteUrl }),
  });
}
