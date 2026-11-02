/**
 * A link to this machine or a private network is never fetched for a seed (the server would be reading it for the person).
 * No imports on purpose: a Vercel route that needs only this check must not load the page reader (jsdom), which does not
 * start on Vercel's Node runtime (ERR_REQUIRE_ESM from html-encoding-sniffer, 2026-10-28).
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === '::1' || h === '0.0.0.0') return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return h.includes(':') && (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80'));
}
