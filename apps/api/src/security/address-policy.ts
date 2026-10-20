import ipaddr from 'ipaddr.js';

/**
 * Decides which IP addresses the service may connect to.
 *
 * Only globally routable unicast addresses are allowed. This blocks loopback,
 * RFC 1918 private ranges, link-local (incl. the 169.254.169.254 cloud metadata
 * endpoint), CGNAT, multicast, broadcast, reserved/documentation ranges, IPv6
 * unique-local, and IPv6 forms that embed an IPv4 address (mapped, NAT64,
 * 6to4, Teredo) which could otherwise smuggle a private IPv4 through.
 */
export class AddressPolicy {
  private readonly exceptions: Set<string>;

  /** @param exceptions private addresses to allow anyway (dev/test only) */
  constructor(exceptions: readonly string[] = []) {
    this.exceptions = new Set(exceptions.map((ip) => normalize(ip) ?? ip));
  }

  isAllowed(ip: string): boolean {
    const normalized = normalize(ip);
    if (!normalized) return false;
    if (this.exceptions.has(normalized)) return true;
    return ipaddr.parse(normalized).range() === 'unicast';
  }
}

/** Canonical string form; IPv4-mapped IPv6 (::ffff:a.b.c.d) becomes plain IPv4. */
function normalize(ip: string): string | undefined {
  const bare = ip.replace(/^\[|\]$/g, '');
  if (!ipaddr.isValid(bare)) return undefined;
  let addr = ipaddr.parse(bare);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  }
  return addr.toString();
}

export function isIpLiteral(hostname: string): boolean {
  return ipaddr.isValid(hostname.replace(/^\[|\]$/g, ''));
}
