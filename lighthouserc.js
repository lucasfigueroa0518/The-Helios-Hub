// Lighthouse CI against the local production build (perf/README.md, perf/PROFILE.md).
// The page budget is server response <= 150 ms; LCP/TBT are reported, not gated
// (the 500 ms budget is TTFB + network + render, not a throttled-mobile LCP).
const base = `http://127.0.0.1:${process.env.PERF_APP_PORT ?? 3100}`;
// /hub/queue is left out: locally it receives the 9.4 MB queue JSON uncompressed (next start does not
// compress route handlers; Vercel does) and Lighthouse marks it PAGE_HUNG. Its API is in the latency budget.
const pages = ['/', '/hub', '/social', '/social/calendar', '/carousels', '/dashboards', '/trello', '/seo'];

module.exports = {
  ci: {
    collect: {
      url: pages.map((p) => base + p),
      numberOfRuns: 1,
      settings: {
        onlyCategories: ['performance'],
        formFactor: 'mobile',
        throttlingMethod: 'devtools',
        // Chrome "Fast 4G" + 4x CPU, the same profile as perf/measure.mjs.
        throttling: { requestLatencyMs: 165, downloadThroughputKbps: 8100, uploadThroughputKbps: 1350, cpuSlowdownMultiplier: 4, rttMs: 165, throughputKbps: 8100 },
        screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
        extraHeaders: process.env.PERF_COOKIE ? { Cookie: process.env.PERF_COOKIE } : {},
        maxWaitForLoad: 15000,
        chromeFlags: '--headless=new --no-sandbox --disable-dev-shm-usage',
      },
    },
    assert: {
      assertions: {
        'server-response-time': ['error', { maxNumericValue: 150 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        'total-blocking-time': ['warn', { maxNumericValue: 300 }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.1 }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
};
