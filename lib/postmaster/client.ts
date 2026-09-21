/**
 * Gmail Postmaster Tools — the independent, recipient-side audit of how our
 * mail is received, as opposed to what Smartlead thinks it sent.
 *
 * Authenticates with an installed-app OAuth refresh token rather than a service
 * account, because Postmaster scopes are granted to the Google account that
 * verified the domains.
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://gmailpostmastertools.googleapis.com/v1';
const TIMEOUT_MS = 20_000;

export type PostmasterCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export function postmasterCredentials(): PostmasterCredentials | null {
  const clientId = process.env.POSTMASTER_CLIENT_ID?.trim();
  const clientSecret = process.env.POSTMASTER_CLIENT_SECRET?.trim();
  const refreshToken = process.env.POSTMASTER_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

/** Reputation grades, worst to best. `no_data` is absence, not a grade. */
export type PostmasterReputation =
  | 'BAD'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'REPUTATION_CATEGORY_UNSPECIFIED';

export type PostmasterTrafficStats = {
  name?: string;
  userReportedSpamRatio?: number;
  ipReputations?: Array<{
    reputation?: PostmasterReputation;
    ipCount?: string;
    sampleIps?: string[];
  }>;
  domainReputation?: PostmasterReputation;
  spammyFeedbackLoops?: Array<{ id?: string; spamRatio?: number }>;
  spfSuccessRatio?: number;
  dkimSuccessRatio?: number;
  dmarcSuccessRatio?: number;
  outboundEncryptionRatio?: number;
  inboundEncryptionRatio?: number;
  deliveryErrors?: Array<{
    errorClass?: string;
    errorType?: string;
    errorRatio?: number;
  }>;
};

type CachedToken = { token: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

/** Exchanges the refresh token, reusing the access token until it nears expiry. */
export async function postmasterAccessToken(
  credentials: PostmasterCredentials,
): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) {
    // The body can echo the client secret back; never log it verbatim.
    throw new Error(`Postmaster token exchange failed with ${response.status}`);
  }
  const payload = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error('Postmaster token exchange returned no access_token');

  cachedToken = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

export type TrafficStatsResult =
  | { status: 'ok'; stats: PostmasterTrafficStats[] }
  | { status: 'no_data' }
  | { status: 'error'; detail: string };

/**
 * Traffic stats for a domain over a date range.
 *
 * Google publishes nothing below an undisclosed daily volume of mail to
 * Gmail-hosted recipients, so an empty list and a 404 both mean "below the
 * reporting threshold" — a first-class expected state, not a failure.
 */
export async function fetchTrafficStats(
  credentials: PostmasterCredentials,
  domain: string,
  startDate: string,
  endDate: string,
): Promise<TrafficStatsResult> {
  let token: string;
  try {
    token = await postmasterAccessToken(credentials);
  } catch (error) {
    return { status: 'error', detail: error instanceof Error ? error.message : String(error) };
  }

  const url = new URL(`${API_BASE}/domains/${encodeURIComponent(domain)}/trafficStats`);
  url.searchParams.set('startDate.year', startDate.slice(0, 4));
  url.searchParams.set('startDate.month', String(Number(startDate.slice(5, 7))));
  url.searchParams.set('startDate.day', String(Number(startDate.slice(8, 10))));
  url.searchParams.set('endDate.year', endDate.slice(0, 4));
  url.searchParams.set('endDate.month', String(Number(endDate.slice(5, 7))));
  url.searchParams.set('endDate.day', String(Number(endDate.slice(8, 10))));

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { status: 'error', detail: error instanceof Error ? error.message : String(error) };
  }

  if (response.status === 404) return { status: 'no_data' };
  const text = await response.text();
  if (!response.ok) return { status: 'error', detail: `${response.status}: ${text.slice(0, 300)}` };

  try {
    const payload = JSON.parse(text) as { trafficStats?: PostmasterTrafficStats[] };
    const stats = payload.trafficStats ?? [];
    return stats.length ? { status: 'ok', stats } : { status: 'no_data' };
  } catch {
    return { status: 'error', detail: 'unparseable JSON' };
  }
}

/** `.../trafficStats/20260916` → `2026-09-16`. */
export function trafficStatDay(name: string | undefined, fallback: string): string {
  const match = name?.match(/(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : fallback;
}

/** Test seam. */
export function resetPostmasterTokenCache(): void {
  cachedToken = null;
}
