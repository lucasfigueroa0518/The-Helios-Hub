import fs from 'node:fs';
import path from 'node:path';

export type HiggsfieldLogin = {
  clientId: string;
  refreshToken: string;
  updatedAt: number;
  /** Kept in the session file only. A restart reuses it instead of refreshing again. */
  accessToken?: string;
  accessExpiresAt?: number;
};

/** An access token still valid for at least a minute. Refreshing before then burns the grant. */
export function usableAccessToken(login: HiggsfieldLogin | null, now = Date.now()): string | null {
  if (!login?.accessToken || !login.accessExpiresAt) return null;
  if (login.accessExpiresAt < now + 60_000) return null;
  return login.accessToken;
}

const SESSION_NAMES = ['higgsfield-session.json'];

/** Files a refresh may read or write. Deploy never replaces the session JSON. */
export function higgsfieldSessionPaths(cwd = process.cwd()): string[] {
  const paths = [
    process.env.HIGGSFIELD_ENV_FILE,
    '/opt/helios-worker/higgsfield-session.json',
    path.join(cwd, 'scripts/gcp/higgsfield-session.json'),
    '/opt/helios-worker/worker.env',
    path.join(cwd, 'scripts/gcp/worker.env'),
    path.join(cwd, '.env.local'),
  ];
  return [...new Set(paths.filter((item): item is string => Boolean(item)))];
}

export function readEnvValue(text: string, key: string): string {
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

export function upsertEnvValue(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  if (new RegExp(`^#?\\s*${key}=.*$`, 'm').test(text)) {
    return text.replace(new RegExp(`^#?\\s*${key}=.*$`, 'm'), line);
  }
  return `${text.trimEnd()}\n${line}\n`;
}

function loginFromEnvText(text: string): HiggsfieldLogin | null {
  const refreshToken = readEnvValue(text, 'HIGGSFIELD_REFRESH_TOKEN');
  const clientId = readEnvValue(text, 'HIGGSFIELD_CLIENT_ID');
  if (!refreshToken || !clientId) return null;
  const stamp = Number(readEnvValue(text, 'HIGGSFIELD_TOKEN_UPDATED_AT'));
  return { clientId, refreshToken, updatedAt: Number.isFinite(stamp) ? stamp : 0 };
}

function loginFromSession(text: string): HiggsfieldLogin | null {
  try {
    const parsed = JSON.parse(text) as Partial<HiggsfieldLogin>;
    if (!parsed.refreshToken || !parsed.clientId) return null;
    return {
      clientId: parsed.clientId,
      refreshToken: parsed.refreshToken,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : undefined,
      accessExpiresAt: typeof parsed.accessExpiresAt === 'number' ? parsed.accessExpiresAt : undefined,
    };
  } catch {
    return null;
  }
}

export function readLoginFile(file: string): HiggsfieldLogin | null {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  return file.endsWith('.json') ? loginFromSession(text) : loginFromEnvText(text);
}

/** The newest saved login. A rotated token on disk beats the copy still in the process env. */
export function newestLogin(files: string[], fromEnv?: HiggsfieldLogin | null): HiggsfieldLogin | null {
  const found = files.map(readLoginFile).filter((item): item is HiggsfieldLogin => item !== null);
  if (fromEnv?.refreshToken && fromEnv.clientId) found.push(fromEnv);
  return found.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function canWrite(file: string): boolean {
  if (file.endsWith('.json')) return fs.existsSync(path.dirname(file));
  return fs.existsSync(file);
}

/** Write the rotated login everywhere this machine will read it next time. */
export function storeLogin(login: HiggsfieldLogin, files: string[]): void {
  let saved = false;
  for (const file of files) {
    if (!canWrite(file)) continue;
    if (file.endsWith('.json')) {
      writeAtomic(file, `${JSON.stringify(login)}\n`);
      saved = true;
      continue;
    }
    if (!fs.existsSync(file)) continue;
    let text = fs.readFileSync(file, 'utf8');
    text = upsertEnvValue(text, 'HIGGSFIELD_CLIENT_ID', login.clientId);
    text = upsertEnvValue(text, 'HIGGSFIELD_REFRESH_TOKEN', login.refreshToken);
    text = upsertEnvValue(text, 'HIGGSFIELD_TOKEN_UPDATED_AT', String(login.updatedAt));
    writeAtomic(file, text.endsWith('\n') ? text : `${text}\n`);
    saved = true;
  }
  if (!saved) {
    throw new Error('Higgsfield rotated the refresh token, and no session file was available to store it.');
  }
}

export { SESSION_NAMES };
