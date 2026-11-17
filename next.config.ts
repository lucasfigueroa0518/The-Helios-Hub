import path from 'path';
import type { NextConfig } from 'next';

const hubRoot = __dirname;

const nextConfig: NextConfig = {
  // The Helios Hub can sit next to other repos with their own lockfiles.
  // Pin tracing to this root so Next does not pick a parent node_modules.
  outputFileTracingRoot: hubRoot,
  serverExternalPackages: [
    'tesseract.js',
    '@tesseract.js-data/eng',
    '@electric-sql/pglite',
  ],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@opentelemetry/api': path.join(
        hubRoot,
        'node_modules/next/dist/compiled/@opentelemetry/api',
      ),
    };
    return config;
  },
};

// `ANALYZE=true npm run build` writes bundle reports to .next/analyze/ (perf/README.md).
function withBundleAnalyzer(config: NextConfig): NextConfig {
  if (process.env.ANALYZE !== 'true') return config;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const analyzer = require('@next/bundle-analyzer') as (opts: { enabled: boolean; openAnalyzer: boolean }) => (c: NextConfig) => NextConfig;
  return analyzer({ enabled: true, openAnalyzer: false })(config);
}

export default withBundleAnalyzer(nextConfig);
