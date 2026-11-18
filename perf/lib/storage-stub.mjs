#!/usr/bin/env node
/**
 * A stand-in for Supabase Storage's sign and signed-object endpoints, so story frames
 * load locally the way they do in production: the page signs visible frames, the
 * browser fetches the signed URL (served here as a small JPEG with Supabase's cache
 * header after --latency ms). No real Storage, no keys.
 *   node perf/lib/storage-stub.mjs --port 54400 --latency 40
 * Then run the app with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54400 SUPABASE_SERVICE_ROLE_KEY=perf-stub.
 */
import http from 'node:http';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []));
const PORT = Number(args.port ?? 54400);
const LATENCY = Number(args.latency ?? 40);
// 1x1 grey JPEG.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    // Sign many: POST /storage/v1/object/sign/<bucket> {paths}
    const many = url.pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/?$/);
    if (req.method === 'POST' && many) {
      const { paths = [] } = JSON.parse(body || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(paths.map((p) => ({ path: p, error: null, signedURL: `/object/sign/${many[1]}/${p}?token=stub` }))));
      return;
    }
    // Sign one: POST /storage/v1/object/sign/<bucket>/<path>
    if (req.method === 'POST' && url.pathname.startsWith('/storage/v1/object/sign/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ signedURL: `${url.pathname.replace('/storage/v1', '')}?token=stub` }));
      return;
    }
    // The signed object itself.
    if (req.method === 'GET' && url.pathname.startsWith('/storage/v1/object/sign/')) {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600', 'access-control-allow-origin': '*' });
        res.end(JPEG);
      }, LATENCY);
      return;
    }
    res.writeHead(404);
    res.end();
  });
}).listen(PORT, '127.0.0.1');
