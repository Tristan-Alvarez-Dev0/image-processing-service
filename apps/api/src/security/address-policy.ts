import ipaddr from 'ipaddr.js';

/**
 * Allows only public unicast IPs. Blocks loopback, private, link-local (cloud
 * metadata), CGNAT, reserved, and IPv6 forms that embed an IPv4 address.
 */
export class AddressPolicy {
  private readonly exceptions: Set<string>;

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
