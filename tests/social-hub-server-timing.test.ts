import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { installHubServerTiming } from '@/lib/server-timing-hook';
import { isTimedHubPath } from '@/lib/social-hub/server-timing-path';
import { addHubSpan, enterHubTiming, hubTimingValue, leaveHubTiming } from '@/lib/social-hub/server-timing-store';

installHubServerTiming();

function listen(handler: (req: import('node:http').IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  return new Promise<{ server: typeof server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

test('timed hub paths are the pages that seal a header', () => {
  assert.equal(isTimedHubPath('/social'), true);
  assert.equal(isTimedHubPath('/social/calendar'), true);
  assert.equal(isTimedHubPath('/social/analytics/stories'), true);
  assert.equal(isTimedHubPath('/social/post/stories%3Aset%3Aa'), true);
  assert.equal(isTimedHubPath('/social/content/pools/stories'), true);
  assert.equal(isTimedHubPath('/social/render'), false);
  assert.equal(isTimedHubPath('/social/preview/analytics'), false);
  assert.equal(isTimedHubPath('/dashboards'), false);
});

test('spans seal in a stable order, and a second render on the same request waits', () => {
  const id = 'seal-order';
  assert.equal(enterHubTiming(id), true);
  assert.equal(enterHubTiming(id), true);
  addHubSpan(id, 'sign', 4);
  addHubSpan(id, 'dataset', 12.34);
  addHubSpan(id, 'extras', 3);
  leaveHubTiming(id);
  assert.equal(hubTimingValue(id), undefined);
  leaveHubTiming(id);
  assert.equal(hubTimingValue(id), 'dataset;dur=12.3, extras;dur=3.0, sign;dur=4.0');
});

test('a full hub RSC response keeps its header until the page seals', async () => {
  const id = `hold-${Date.now()}`;
  enterHubTiming(id);
  addHubSpan(id, 'dataset', 20);
  addHubSpan(id, 'week', 8.5);
  const { server, port } = await listen((_req, res) => {
    res.flushHeaders();
    res.end('ready');
  });
  try {
    const pending = fetch(`http://127.0.0.1:${port}/social/calendar`, {
      headers: { rsc: '1', 'x-hub-timing': id },
      signal: AbortSignal.timeout(2000),
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    let settled = false;
    const raced = pending.then((res) => {
      settled = true;
      return res;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(settled, false);
    leaveHubTiming(id);
    const res = await raced;
    assert.match(res.headers.get('server-timing') ?? '', /dataset;dur=20\.0/);
    assert.match(res.headers.get('server-timing') ?? '', /week;dur=8\.5/);
    assert.equal(await res.text(), 'ready');
  } finally {
    leaveHubTiming(id);
    server.close();
  }
});

test('a partial prefetch is not held for the seal', async () => {
  const id = `partial-${Date.now()}`;
  const { server, port } = await listen((_req, res) => {
    res.end('shell');
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/social`, {
      headers: { rsc: '1', 'next-router-prefetch': '1', 'x-hub-timing': id },
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(res.headers.get('server-timing'), null);
    assert.equal(await res.text(), 'shell');
  } finally {
    server.close();
  }
});
