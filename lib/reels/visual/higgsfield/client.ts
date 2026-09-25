import { higgsfieldAccessToken } from '@/lib/reels/visual/higgsfield/auth';
import { klingArguments, pickKlingTool, type McpTool } from '@/lib/reels/visual/higgsfield/kling';

const MCP_URL = 'https://mcp.higgsfield.ai/mcp';
const PROTOCOL = '2025-03-26';
const POLL_MS = 5_000;
const POLL_DEADLINE_MS = 8 * 60_000;

type RpcResult = { result?: unknown; error?: { message?: string } };

function parseSse(body: string, id: number): RpcResult {
  for (const event of body.split('\n\n')) {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data || data === '[DONE]') continue;
    const message = JSON.parse(data) as RpcResult & { id?: number };
    if (message.id === id || message.result || message.error) return message;
  }
  throw new Error('Higgsfield MCP stream ended without a response.');
}

export type HiggsfieldClip = {
  bytes: Buffer;
  jobId: string | null;
};

type FetchLike = typeof fetch;

export class HiggsfieldClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private fetchImpl: FetchLike;

  constructor(fetchImpl: FetchLike = fetch) {
    this.fetchImpl = fetchImpl;
  }

  private async rpc(method: string, params: unknown, notify = false): Promise<unknown> {
    const id = this.nextId++;
    const token = await higgsfieldAccessToken();
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    const response = await this.fetchImpl(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }),
    });
    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    const text = await response.text();
    if (response.status === 401) {
      throw new Error(
        'Higgsfield rejected the worker login. This is the known issuer mismatch between Clerk and mcp.higgsfield.ai. The blocker is their OAuth, not the prompt.',
      );
    }
    if (!response.ok) {
      throw new Error(`Higgsfield MCP ${method} failed (${response.status}): ${text.slice(0, 300)}`);
    }
    if (notify || !text.trim()) return null;
    const contentType = response.headers.get('content-type') ?? '';
    const message = contentType.includes('text/event-stream')
      ? parseSse(text, id ?? 0)
      : (JSON.parse(text) as RpcResult);
    if (message.error) throw new Error(message.error.message || `Higgsfield MCP ${method} failed.`);
    return message.result;
  }

  async connect(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'helios-reels', version: '1.0.0' },
    });
    await this.rpc('notifications/initialized', {}, true);
  }

  async listTools(): Promise<McpTool[]> {
    const result = (await this.rpc('tools/list', {})) as { tools?: McpTool[] } | null;
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.rpc('tools/call', { name, arguments: args });
  }
}

function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  const record = value as Record<string, unknown>;
  visit(record);
  for (const nested of Object.values(record)) walk(nested, visit);
}

const URL_IN_TEXT = /https?:\/\/[^\s)"']+/g;
const JOB_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function isVideoUrl(value: string): boolean {
  if (!/^https?:\/\//.test(value)) return false;
  if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(value)) return false;
  return /\.(mp4|webm|mov)(\?|$)/i.test(value) || /video|cdn\.|higgsfield/i.test(value);
}

export function extractVideoUrl(result: unknown): string | null {
  let found: string | null = null;
  const consider = (value: string) => {
    const clean = value.replace(/[),.;]+$/, '');
    if (!found && isVideoUrl(clean)) found = clean;
  };
  walk(result, (node) => {
    if (found) return;
    for (const key of ['video_url', 'videoUrl', 'url', 'download_url', 'src']) {
      const value = node[key];
      if (typeof value === 'string') consider(value);
    }
    for (const value of Object.values(node)) {
      if (typeof value !== 'string') continue;
      consider(value);
      for (const match of value.match(URL_IN_TEXT) ?? []) consider(match);
    }
  });
  return found;
}

export function extractJobId(result: unknown): string | null {
  let found: string | null = null;
  walk(result, (node) => {
    if (found) return;
    for (const key of ['job_id', 'jobId', 'request_id', 'id']) {
      const value = node[key];
      if (typeof value === 'string' && JOB_UUID.test(value)) {
        found = value.match(JOB_UUID)?.[0] ?? value;
        return;
      }
    }
    for (const value of Object.values(node)) {
      if (typeof value === 'string' && JOB_UUID.test(value)) {
        found = value.match(JOB_UUID)?.[0] ?? null;
        return;
      }
    }
  });
  return found;
}

export function videoResultNote(result: unknown): string {
  const chunks: string[] = [];
  walk(result, (node) => {
    if (typeof node.text === 'string') chunks.push(node.text);
    if (typeof node.message === 'string') chunks.push(node.message);
  });
  const text = chunks.join(' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 240);
}

async function downloadClip(url: string, fetchImpl: FetchLike): Promise<Buffer> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Video download failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * One pinned Kling 3.0 image-to-video call. The motion prompt is the only
 * free text. Sound, multi-shot, and prompt enhancement are forced off.
 */
export async function generateKlingClip(input: {
  prompt: string;
  imageUrl: string;
  client?: HiggsfieldClient;
}): Promise<HiggsfieldClip> {
  const client = input.client ?? new HiggsfieldClient();
  await client.connect();
  const tool = pickKlingTool(await client.listTools());
  const args = klingArguments(tool, { prompt: input.prompt, imageUrl: input.imageUrl });
  let result = await client.callTool(tool.name, args);
  const started = Date.now();
  let jobId = extractJobId(result);
  let url = extractVideoUrl(result);
  const statusTool = (await client.listTools()).find((item) => item.name === 'job_status');
  while (!url && jobId && statusTool && Date.now() - started < POLL_DEADLINE_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    result = await client.callTool(statusTool.name, { job_id: jobId, id: jobId, sync: true });
    url = extractVideoUrl(result);
    jobId = extractJobId(result) ?? jobId;
  }
  if (!url) {
    const note = videoResultNote(result);
    throw new Error(note ? `Higgsfield returned no video URL. ${note}` : 'Higgsfield returned no video URL.');
  }
  const bytes = await downloadClip(url, fetch);
  return { bytes, jobId };
}
