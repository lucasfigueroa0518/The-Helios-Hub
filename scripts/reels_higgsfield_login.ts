/**
 * One human sign-in for the reels worker.
 *
 * Higgsfield's device-code endpoint rejects a dynamically registered client
 * (Clerk returns invalid_grant), so this uses authorization-code PKCE on
 * localhost. The refresh token is written into scripts/gcp/worker.env and is
 * not printed. Deploy the worker afterward so the VM can refresh it with the
 * laptop off.
 *
 *   npm run reels:higgsfield-login
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { storeLogin } from '@/lib/reels/visual/higgsfield/session';

const REGISTER_URL = 'https://mcp.higgsfield.ai/oauth2/register';
const AUTHORIZE_URL = 'https://mcp.higgsfield.ai/oauth2/authorize';
const TOKEN_URL = 'https://mcp.higgsfield.ai/oauth2/token';
const REDIRECT = 'http://127.0.0.1:8787/callback';
const ENV_PATH = path.join(process.cwd(), 'scripts/gcp/worker.env');

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function upsertEnv(key: string, value: string, text: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^#?\\s*${key}=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${text.trimEnd()}\n${line}\n`;
}

async function registerClient(): Promise<string> {
  const response = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'helios-reels-worker',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      scope: 'openid email offline_access',
    }),
  });
  const body = (await response.json().catch(() => null)) as { client_id?: string; error?: string; error_description?: string } | null;
  if (!response.ok || !body?.client_id) {
    throw new Error(
      `Higgsfield client registration failed (${response.status}): ${body?.error_description || body?.error || 'no client id'}`,
    );
  }
  return body.client_id;
}

function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url || '/', REDIRECT);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error_description') || url.searchParams.get('error');
      response.setHeader('content-type', 'text/html; charset=utf-8');
      if (!code) {
        response.end(`<p>Higgsfield did not return a code. ${error ?? ''}</p>`);
        server.close();
        reject(new Error(error || 'Higgsfield login was cancelled.'));
        return;
      }
      response.end('<p>Signed in. You can close this tab.</p>');
      server.close();
      resolve(code);
    });
    server.listen(8787, '127.0.0.1');
    setTimeout(() => {
      server.close();
      reject(new Error('Login timed out before Higgsfield redirected back.'));
    }, 10 * 60_000).unref();
  });
}

async function main(): Promise<void> {
  const clientId = await registerClient();
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  const authorize = new URL(AUTHORIZE_URL);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', REDIRECT);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('scope', 'openid email offline_access');
  authorize.searchParams.set('state', state);

  console.log('Open this URL and approve the Helios reels worker:');
  console.log(authorize.toString());
  const code = await waitForCode();

  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  const tokens = (await tokenResponse.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;
  if (!tokenResponse.ok || !tokens?.refresh_token) {
    throw new Error(
      `Higgsfield token exchange failed (${tokenResponse.status}): ${tokens?.error_description || tokens?.error || 'no refresh token'}. If the issuer does not match, the blocker is their OAuth, not the prompt.`,
    );
  }
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error('scripts/gcp/worker.env is missing. Copy worker.env.example there, then run this again.');
  }
  let text = fs.readFileSync(ENV_PATH, 'utf8');
  text = upsertEnv('HIGGSFIELD_CLIENT_ID', clientId, text);
  text = upsertEnv('HIGGSFIELD_REFRESH_TOKEN', tokens.refresh_token, text);
  const updatedAt = Date.now();
  text = upsertEnv('HIGGSFIELD_TOKEN_UPDATED_AT', String(updatedAt), text);
  fs.writeFileSync(ENV_PATH, text);
  storeLogin(
    {
      clientId,
      refreshToken: tokens.refresh_token,
      updatedAt,
      accessToken: tokens.access_token,
      accessExpiresAt: tokens.expires_in ? updatedAt + tokens.expires_in * 1000 : undefined,
    },
    [path.join(process.cwd(), 'scripts/gcp/higgsfield-session.json')],
  );
  console.log('Saved the Higgsfield refresh token to scripts/gcp/worker.env. Deploy the worker to copy it to the VM.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});