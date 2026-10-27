import path from 'path';
import type { NextConfig } from 'next';

const hubRoot = __dirname;

const nextConfig: NextConfig = {
  // The Helios Hub can sit next to other repos with their own lockfiles.
  // Pin tracing to this root so Next does not pick a parent node_modules.
  outputFileTracingRoot: hubRoot,
  experimental: {
    // Next compiles `unstable_dynamicOnHover` out unless this is on. Viewport
    // prefetch stays partial; hover then loads the full route.
    dynamicOnHover: true,
  },
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

export default nextConfig;
