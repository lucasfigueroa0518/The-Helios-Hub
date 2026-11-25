#!/usr/bin/env node
/**
 * TCP proxy that adds a fixed one-way delay to every chunk in each direction,
 * so a local Postgres behaves like a database a few milliseconds away.
 * Round-trip count then costs what it costs in production (N+1, serial awaits).
 *
 *   node perf/lib/latency-proxy.mjs --listen 54330 --target 127.0.0.1:54329 --one-way-ms 2.5
 */
import net from 'node:net';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []),
);
const listen = Number(args.listen ?? 54330);
const [host, port] = String(args.target ?? '127.0.0.1:54329').split(':');
const delay = Number(args['one-way-ms'] ?? 2.5);

function pipeDelayed(from, to) {
  from.on('data', (chunk) => {
    if (delay <= 0) { to.write(chunk); return; }
    setTimeout(() => { if (!to.destroyed) to.write(chunk); }, delay);
  });
  from.on('end', () => setTimeout(() => to.end(), delay));
  from.on('error', () => to.destroy());
}

const server = net.createServer((client) => {
  client.setNoDelay(true);
  const upstream = net.connect({ host, port: Number(port) }, () => upstream.setNoDelay(true));
  pipeDelayed(client, upstream);
  pipeDelayed(upstream, client);
  upstream.on('close', () => client.destroy());
  client.on('close', () => upstream.destroy());
});
server.listen(listen, '127.0.0.1', () => {
  console.log(`latency-proxy :${listen} -> ${host}:${port} (+${delay} ms each way)`);
});
