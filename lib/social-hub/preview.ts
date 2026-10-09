import { notFound } from 'next/navigation';

/**
 * The fixture mirror at /social/preview exists only in development
 * (DECISIONS_LOG D10). In a production build every preview page 404s.
 */
export function assertPreviewAllowed(): void {
  if (process.env.NODE_ENV === 'production') notFound();
}
