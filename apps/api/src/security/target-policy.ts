import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { AppError } from '../errors/app-error.js';
import { isIpLiteral, type AddressPolicy } from './address-policy.js';

export interface TargetPolicyOptions {
  addresses: AddressPolicy;
  allowedPorts: ReadonlySet<number> | '*';
}

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };

export class BlockedAddressError extends Error {
  constructor(
    readonly hostname: string,
    readonly address: string,
  ) {
    super(`${hostname} resolves to a blocked address (${address})`);
    this.name = 'BlockedAddressError';
  }
}

const forbidden = (message: string) => new AppError('FORBIDDEN_HOST', message);

/** Checks what can be checked without DNS. Runs again on every redirect hop (`hop` > 0). */
export function assertFetchableUrl(url: URL, policy: TargetPolicyOptions, hop = 0): void {
  const subject = hop > 0 ? 'The source URL redirected to a URL that' : 'The url';

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw hop > 0
      ? new AppError('UPSTREAM_ERROR', `${subject} is not http(s) (${url.protocol})`)
      : new AppError('INVALID_URL', 'url must be an absolute http:// or https:// URL', 'url');
  }

  if (url.username || url.password) {
    throw hop > 0
      ? new AppError('UPSTREAM_ERROR', `${subject} contains credentials, which is not allowed`)
      : new AppError('INVALID_URL', 'url must not contain credentials (user:pass@)', 'url');
  }

  const port = url.port ? Number(url.port) : DEFAULT_PORTS[url.protocol]!;
  if (policy.allowedPorts !== '*' && !policy.allowedPorts.has(port)) {
    const allowed = [...policy.allowedPorts].join(', ');
    throw forbidden(`${subject} uses port ${port}; only ports ${allowed} are allowed`);
  }

  // Trailing dots ("localhost.") are valid DNS and must not slip past checks.
  const hostname = url.hostname.replace(/\.+$/, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw forbidden(`${subject} points to localhost, which is not allowed`);
  }

  // IP literals never go through DNS, so they must be checked here.
  if (isIpLiteral(hostname) && !policy.addresses.isAllowed(hostname)) {
    throw forbidden(`${subject} points to a private or reserved IP address, which is not allowed`);
  }
}

export type Resolver = (
  hostname: string,
  family: number,
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

const systemResolver: Resolver = (hostname, family, callback) =>
  dnsLookup(hostname, { all: true, family }, callback);

/**
 * dns.lookup that rejects forbidden addresses. It runs on the connection being
 * opened, so the IP we check is the IP we connect to (no DNS rebinding).
 */
export function createGuardedLookup(
  addresses: AddressPolicy,
  resolve: Resolver = systemResolver,
): LookupFunction {
  return (hostname, options, callback) => {
    const family =
      options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : (options.family ?? 0);
    resolve(hostname, family, (err, results) => {
      if (err) return callback(err, '', 0);

      const blocked = results.find((r) => !addresses.isAllowed(r.address));
      if (blocked) {
        return callback(new BlockedAddressError(hostname, blocked.address), '', 0);
      }

      const first = results[0];
      if (!first)
        return callback(Object.assign(new Error('No addresses'), { code: 'ENOTFOUND' }), '', 0);
      if (options.all) {
        (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, results);
      } else {
        callback(null, first.address, first.family);
      }
    });
  };
}
