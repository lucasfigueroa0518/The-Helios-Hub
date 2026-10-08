import { newAnthropic } from '@/lib/anthropic-client';

/** Server-only Claude client — do not import from client components. */
export const anthropic = newAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
