import {
  higgsfieldSessionPaths,
  newestLogin,
  storeLogin,
  usableAccessToken,
  type HiggsfieldLogin,
} from '@/lib/reels/visual/higgsfield/session';

const TOKEN_URL = 'https://mcp.higgsfield.ai/oauth2/token';

let cached: { token: string; expiresAt: number; refreshToken: string } | null = null;
let pending: Promise<string> | null = null;

function envLogin(): HiggsfieldLogin | null {
  const refreshToken = process.env.HIGGSFIELD_REFRESH_TOKEN?.trim() ?? '';
  const clientId = process.env.HIGGSFIELD_CLIENT_ID?.trim() ?? '';
  if (!refreshToken || !clientId) return null;
  const stamp = Number(process.env.HIGGSFIELD_TOKEN_UPDATED_AT);
  return { clientId, refreshToken, updatedAt: Number.isFinite(stamp) ? stamp : 0 };
}

function remember(login: HiggsfieldLogin): void {
  process.env.HIGGSFIELD_REFRESH_TOKEN = login.refreshToken;
  process.env.HIGGSFIELD_CLIENT_ID = login.clientId;
  process.env.HIGGSFIELD_TOKEN_UPDATED_AT = String(login.updatedAt);
  storeLogin(login, higgsfieldSessionPaths());
}

async function refreshOnce(login: HiggsfieldLogin): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: login.refreshToken,
    client_id: login.clientId,
  });
  const secret = process.env.HIGGSFIELD_CLIENT_SECRET?.trim();
  if (secret) body.set('client_secret', secret);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  } | null;
  if (!response.ok || !payload?.access_token) {
    const error = new Error(
      `Higgsfield token refresh failed (${response.status}): ${payload?.error ?? 'no access token'}.`,
    );
    (error as Error & { code?: string }).code = payload?.error;
    throw error;
  }
  const nextRefresh = payload.refresh_token?.trim() || login.refreshToken;
  const expiresAt = Date.now() + (payload.expires_in ?? 3600) * 1000;
  remember({
    clientId: login.clientId,
    refreshToken: nextRefresh,
    updatedAt: Date.now(),
    accessToken: payload.access_token,
    accessExpiresAt: expiresAt,
  });
  cached = {
    token: payload.access_token,
    expiresAt,
    refreshToken: nextRefresh,
  };
  return payload.access_token;
}

async function refresh(): Promise<string> {
  const files = higgsfieldSessionPaths();
  let login = newestLogin(files, envLogin());
  if (!login) {
    throw new Error(
      'Higgsfield is not signed in on this worker. Run npm run reels:higgsfield-login, then deploy the worker.',
    );
  }
  if (login.refreshToken !== process.env.HIGGSFIELD_REFRESH_TOKEN) remember(login);
  try {
    return await refreshOnce(login);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as { code?: string }).code : '';
    if (code !== 'invalid_grant') throw error;
    const newer = newestLogin(files, null);
    if (!newer || newer.refreshToken === login.refreshToken) throw error;
    remember(newer);
    return refreshOnce(newer);
  }
}

/**
 * Access token for the machine that is calling. A rotated refresh token is
 * written to this machine's session file before the access token is used.
 */
export async function higgsfieldAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const saved = usableAccessToken(newestLogin(higgsfieldSessionPaths(), envLogin()));
  if (saved) {
    cached = {
      token: saved,
      expiresAt: newestLogin(higgsfieldSessionPaths(), envLogin())?.accessExpiresAt ?? Date.now() + 60_000,
      refreshToken: process.env.HIGGSFIELD_REFRESH_TOKEN ?? '',
    };
    return saved;
  }
  if (!pending) {
    pending = refresh().finally(() => {
      pending = null;
    });
  }
  return pending;
}
