import { ServerResponse, type IncomingMessage } from 'node:http';

import { isTimedHubPath, HUB_TIMING_HEADER } from '@/lib/social-hub/server-timing-path';
import { hubTimingValue, onHubTimingSealed } from '@/lib/social-hub/server-timing-store';

const INSTALLED = Symbol.for('helios.hubTimingHook');

type Chunk = { chunk: unknown; encoding?: BufferEncoding; cb?: () => void };
type Gate = {
  hold: boolean;
  id: string;
  chunks: Chunk[];
  ending: boolean;
  endCb?: () => void;
  writeHead?: unknown[];
  timer?: ReturnType<typeof setTimeout>;
};

const gates = new WeakMap<ServerResponse, Gate | null>();

type WriteHead = ServerResponse['writeHead'];
type Write = ServerResponse['write'];
type End = ServerResponse['end'];

let originalWriteHead: WriteHead;
let originalWrite: Write;
let originalEnd: End;
let originalFlush: ServerResponse['flushHeaders'];

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function shouldHold(req: IncomingMessage): boolean {
  if (header(req, 'rsc') !== '1') return false;
  // A partial prefetch stops at the loading shell and must not wait for the page.
  if (header(req, 'next-router-prefetch')) return false;
  if (header(req, 'next-router-segment-prefetch')) return false;
  const path = (req.url ?? '').split('?')[0]?.replace(/\/$/, '') || '/';
  return isTimedHubPath(path);
}

function stamp(res: ServerResponse, id: string): void {
  if (res.headersSent) return;
  const value = hubTimingValue(id);
  if (!value) return;
  const prev = res.getHeader('Server-Timing');
  res.setHeader('Server-Timing', prev ? `${prev}, ${value}` : value);
}

function release(res: ServerResponse): void {
  const gate = gates.get(res);
  if (!gate?.hold) return;
  gate.hold = false;
  if (gate.timer) clearTimeout(gate.timer);
  if (res.writableEnded || res.destroyed) return;
  stamp(res, gate.id);
  if (gate.writeHead) originalWriteHead.apply(res, gate.writeHead as Parameters<WriteHead>);
  for (const chunk of gate.chunks) originalWrite.call(res, chunk.chunk as never, chunk.encoding as never, chunk.cb as never);
  gate.chunks = [];
  if (gate.ending) {
    const end = originalEnd as (this: ServerResponse, ...args: unknown[]) => ServerResponse;
    end.apply(res, gate.endCb ? [gate.endCb] : []);
  }
}

function gateFor(res: ServerResponse): Gate | null {
  if (gates.has(res)) return gates.get(res) ?? null;
  const req = res.req;
  if (!req || !shouldHold(req)) {
    gates.set(res, null);
    return null;
  }
  const id = header(req, HUB_TIMING_HEADER);
  if (!id) {
    gates.set(res, null);
    return null;
  }
  if (hubTimingValue(id) !== undefined) {
    gates.set(res, null);
    return null;
  }
  const gate: Gate = { hold: true, id, chunks: [], ending: false };
  gates.set(res, gate);
  gate.timer = setTimeout(() => release(res), 8_000);
  gate.timer.unref?.();
  onHubTimingSealed(id, () => release(res));
  return gate;
}

/**
 * Attach Server-Timing on a full Social Hub RSC response. Next flushes the
 * loading shell before the page's awaits finish, so those first chunks wait
 * until the page seals. A partial prefetch is not held.
 */
export function installHubServerTiming(): void {
  const g = globalThis as typeof globalThis & { [INSTALLED]?: boolean };
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;
  originalWriteHead = ServerResponse.prototype.writeHead;
  originalWrite = ServerResponse.prototype.write;
  originalEnd = ServerResponse.prototype.end;
  originalFlush = ServerResponse.prototype.flushHeaders;
  ServerResponse.prototype.writeHead = function writeHead(this: ServerResponse, ...args: unknown[]) {
    const gate = gateFor(this);
    if (gate?.hold) {
      gate.writeHead = args;
      return this;
    }
    const id = this.req ? header(this.req, HUB_TIMING_HEADER) : undefined;
    if (id) stamp(this, id);
    return originalWriteHead.apply(this, args as Parameters<WriteHead>);
  } as WriteHead;
  ServerResponse.prototype.flushHeaders = function flushHeaders(this: ServerResponse) {
    const gate = gateFor(this);
    if (gate?.hold) return;
    const id = this.req ? header(this.req, HUB_TIMING_HEADER) : undefined;
    if (id) stamp(this, id);
    return originalFlush.call(this);
  };
  ServerResponse.prototype.write = function write(this: ServerResponse, chunk: unknown, encoding?: unknown, cb?: unknown) {
    const enc = typeof encoding === 'string' ? encoding as BufferEncoding : undefined;
    const callback = (typeof encoding === 'function' ? encoding : typeof cb === 'function' ? cb : undefined) as (() => void) | undefined;
    const gate = gateFor(this);
    if (!gate?.hold) return originalWrite.call(this, chunk as never, enc as never, callback as never);
    gate.chunks.push({ chunk, encoding: enc, cb: callback });
    return true;
  } as Write;
  ServerResponse.prototype.end = function end(this: ServerResponse, ...args: unknown[]) {
    const gate = gateFor(this);
    if (!gate?.hold) return originalEnd.apply(this, args as Parameters<End>);
    if (args.length && typeof args[0] !== 'function' && args[0] != null) {
      const encoding = typeof args[1] === 'string' ? args[1] as BufferEncoding : undefined;
      gate.chunks.push({ chunk: args[0], encoding });
    }
    const callback = args.find((arg) => typeof arg === 'function') as (() => void) | undefined;
    gate.ending = true;
    gate.endCb = callback;
    return this;
  } as End;
}
