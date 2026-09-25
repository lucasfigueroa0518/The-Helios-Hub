import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

function parseServiceAccountJsonFrom(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> | null {
  const raw = env.GSC_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('GSC_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
}

const METADATA_TOKEN_URL =
  'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The auth library races 169.254.169.254 against metadata.google.internal and
 * treats the first failure as "not on GCE". On the worker that DNS failure
 * wins, so Application Default Credentials never loads. Ask the link-local
 * metadata server directly. A minted token is reused until it is near expiry.
 * A miss is not remembered on the VM: the next call tries the metadata server
 * again. The library fallback runs only when this machine has its own key.
 */
let cachedAccessToken: { value: string; expiresAt: number } | null = null;
let skipMetadataUntil = 0;

const TOKEN_SKEW_MS = 5 * 60 * 1000;

/** Tests only. */
export function resetSearchConsoleMetadataCache(): void {
  cachedAccessToken = null;
  skipMetadataUntil = 0;
}

function hasLocalCredentials(env: NodeJS.ProcessEnv): boolean {
  if (env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) return true;
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (!home) return false;
  return existsSync(join(home, '.config', 'gcloud', 'application_default_credentials.json'));
}

function rememberToken(token: string, expiresInSeconds: number): string {
  const lifetimeMs = Math.max(60, expiresInSeconds) * 1000;
  cachedAccessToken = { value: token, expiresAt: Date.now() + lifetimeMs };
  return token;
}

function reusableToken(): string | null {
  if (!cachedAccessToken) return null;
  if (Date.now() >= cachedAccessToken.expiresAt - TOKEN_SKEW_MS) return null;
  return cachedAccessToken.value;
}

async function tokenFromMetadata(
  scopes: string[],
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<{ token: string; expiresIn: number } | null> {
  const url = `${METADATA_TOKEN_URL}?scopes=${encodeURIComponent(scopes.join(','))}`;
  try {
    const response = await fetchImpl(url, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;
    return { token: body.access_token, expiresIn: body.expires_in ?? 3600 };
  } catch {
    return null;
  }
}

async function metadataTokenWithRetries(
  scopes: string[],
  fetchImpl: FetchLike,
): Promise<{ token: string; expiresIn: number } | null> {
  if (Date.now() < skipMetadataUntil) return null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const minted = await tokenFromMetadata(scopes, fetchImpl, 3000);
    if (minted) return minted;
  }
  return null;
}

async function impersonateAccessToken(
  sourceToken: string,
  target: string,
  fetchImpl: FetchLike,
): Promise<string> {
  const response = await fetchImpl(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(target)}:generateAccessToken`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sourceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ scope: [WEBMASTERS_SCOPE], lifetime: '3600s' }),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Could not impersonate ${target}: ${response.status} ${raw.slice(0, 300)}`);
  }
  const parsed = JSON.parse(raw) as { accessToken?: string; expireTime?: string };
  if (!parsed.accessToken) throw new Error(`Could not impersonate ${target}`);
  const expireMs = parsed.expireTime ? Date.parse(parsed.expireTime) - Date.now() : 3600 * 1000;
  return rememberToken(parsed.accessToken, Math.max(60, Math.floor(expireMs / 1000)));
}

export async function getSearchConsoleAccessToken(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const impersonate = env.GSC_IMPERSONATE_SERVICE_ACCOUNT?.trim() || '';
  const json = parseServiceAccountJsonFrom(env);
  const keyFile = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

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

  const reused = reusableToken();
  if (reused) return reused;

  const scopes = impersonate ? ['https://www.googleapis.com/auth/cloud-platform'] : [WEBMASTERS_SCOPE];
  const metadata = await metadataTokenWithRetries(scopes, fetchImpl);
  if (metadata) {
    if (!impersonate) return rememberToken(metadata.token, metadata.expiresIn);
    return impersonateAccessToken(metadata.token, impersonate, fetchImpl);
  }

  if (!hasLocalCredentials(env)) {
    throw new Error(
      'Search Console metadata server did not respond. The worker has no local Google credentials to fall back on.',
    );
  }
  skipMetadataUntil = Date.now() + 5 * 60 * 1000;

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
    const token = await getSearchConsoleAccessToken();
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
