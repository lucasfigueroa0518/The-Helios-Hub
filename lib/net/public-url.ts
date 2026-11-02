import { lookup as dnsLookup } from 'node:dns/promises';

import { isPrivateHost } from '@/lib/net/private-host';

/**
 * The guard for fetching a URL a person (or a model) supplied: refuse private addresses at the first URL, at every redirect
 * hop, and at every address a host name resolves to. Neutral on purpose: Trial Reels' page fetcher and the shared article
 * extractor (lib/social) both use it, and lib/social must not import Trial Reels code.
 */

/** A fetch was refused because the address (or a redirect hop, or a resolved IP) is private. Never retried. */
export class PrivateAddressError extends Error {
  constructor(readonly url: string, why: string) {
    super(`Refusing to fetch ${url}: ${why}`);
    this.name = 'PrivateAddressError';
  }
}

/** The IP addresses a host name resolves to. Injectable so tests need no network. */
export type HostLookup = (hostname: string) => Promise<string[]>;
const defaultLookup: HostLookup = async (hostname) => (await dnsLookup(hostname, { all: true })).map((a) => a.address);

/** An IPv4-mapped IPv6 address (`::ffff:127.0.0.1`, which URL parsing rewrites to `::ffff:7f00:1`) as its IPv4 form, else null. */
function mappedIpv4(address: string): string | null {
  const h = address.replace(/^\[|\]$/g, '').toLowerCase();
  const dotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1]!;
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const [a, b] = [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16)];
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

const privateAddress = (address: string) => address === '::' || isPrivateHost(mappedIpv4(address) ?? address);

/**
 * Throws PrivateAddressError unless `url` is http(s) to a public address: not a private literal, and (for a host name) no
 * address it resolves to is private. The lookup and the fetch are separate, so a host that changes its answer between them
 * is not caught; this closes the redirect and the name-points-at-localhost cases.
 */
export async function assertPublicUrl(url: string, lookup: HostLookup = defaultLookup): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PrivateAddressError(url, 'not a URL');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new PrivateAddressError(url, 'only http and https');
  const host = parsed.hostname;
  if (isPrivateHost(host) || privateAddress(host)) throw new PrivateAddressError(url, 'private address');
  if (/^[\d.]+$/.test(host) || host.includes(':')) return;
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new PrivateAddressError(url, 'host does not resolve');
  }
  if (addresses.length === 0 || addresses.some(privateAddress)) throw new PrivateAddressError(url, 'resolves to a private address');
}
