/**
 * Per-request SQL tracer for perf runs. Preload into the production server:
 *   PERF_PG_TRACE=perf/runs/trace.jsonl NODE_OPTIONS="--require ./perf/lib/pg-trace.cjs" next start
 * Each HTTP request runs in an AsyncLocalStorage scope; every pg query made in
 * that scope is timed and attributed to it. One JSON line per finished request:
 *   { url, status, ms, queryCount, queryMs, queries: [{ sql, ms, rows }] }
 * Inert unless PERF_PG_TRACE is set. Local measurement only; never in prod.
 */
const out = process.env.PERF_PG_TRACE;
if (out) {
  const fs = require('node:fs');
  const http = require('node:http');
  const { AsyncLocalStorage } = require('node:async_hooks');
  const { performance } = require('node:perf_hooks');
  const als = new AsyncLocalStorage();
  const squash = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400);

  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function emit(event, req, res) {
    if (event !== 'request') return originalEmit.apply(this, arguments);
    const scope = { url: req.url, method: req.method, started: performance.now(), queries: [] };
    res.once('finish', () => {
      const queryMs = scope.queries.reduce((sum, q) => sum + q.ms, 0);
      const line = {
        url: scope.url,
        method: scope.method,
        status: res.statusCode,
        ms: Math.round((performance.now() - scope.started) * 10) / 10,
        queryCount: scope.queries.length,
        queryMs: Math.round(queryMs * 10) / 10,
        queries: scope.queries,
      };
      fs.appendFile(out, JSON.stringify(line) + '\n', () => {});
    });
    return als.run(scope, () => originalEmit.apply(this, arguments));
  };

  const pg = require('pg');
  const original = pg.Client.prototype.query;
  pg.Client.prototype.query = function traced(...args) {
    const scope = als.getStore();
    if (!scope) return original.apply(this, args);
    const first = args[0];
    const text = typeof first === 'string' ? first : first && first.text;
    const started = performance.now();
    const record = (result) => {
      scope.queries.push({
        sql: squash(text),
        ms: Math.round((performance.now() - started) * 100) / 100,
        rows: result && typeof result.rowCount === 'number' ? result.rowCount : null,
      });
    };
    const cbIndex = args.findIndex((a) => typeof a === 'function');
    if (cbIndex >= 0) {
      const cb = args[cbIndex];
      args[cbIndex] = (err, res) => { record(res); cb(err, res); };
      return original.apply(this, args);
    }
    const result = original.apply(this, args);
    if (result && typeof result.then === 'function') {
      return result.then((value) => { record(value); return value; }, (error) => { record(null); throw error; });
    }
    return result;
  };
}
