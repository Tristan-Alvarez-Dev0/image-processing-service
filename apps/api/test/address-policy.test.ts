import { describe, expect, it } from 'vitest';
import { AddressPolicy } from '../src/security/address-policy.js';

describe('AddressPolicy', () => {
  const policy = new AddressPolicy();

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '151.101.1.69',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('allows public address %s', (ip) => {
    expect(policy.isAllowed(ip)).toBe(true);
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['10.0.0.1', 'RFC 1918'],
    ['172.16.0.1', 'RFC 1918'],
    ['172.31.255.255', 'RFC 1918'],
    ['192.168.1.1', 'RFC 1918'],
    ['169.254.169.254', 'cloud metadata (link-local)'],
    ['0.0.0.0', 'unspecified'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['192.0.2.1', 'documentation'],
    ['198.18.0.1', 'benchmarking'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fe80::1', 'IPv6 link-local'],
    ['fc00::1', 'IPv6 unique-local'],
    ['fd12:3456::1', 'IPv6 unique-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
    ['[::ffff:7f00:1]', 'bracketed IPv4-mapped loopback'],
    ['64:ff9b::7f00:1', 'NAT64-embedded loopback'],
    ['2002:7f00:1::1', '6to4-embedded loopback'],
    ['2001::1', 'Teredo'],
    ['not-an-ip', 'garbage'],
  ])('blocks %s (%s)', (ip) => {
    expect(policy.isAllowed(ip)).toBe(false);
  });

  it('allows explicitly excepted private addresses, in any notation', () => {
    const dev = new AddressPolicy(['127.0.0.1']);

    expect(dev.isAllowed('127.0.0.1')).toBe(true);
    expect(dev.isAllowed('::ffff:127.0.0.1')).toBe(true);
    expect(dev.isAllowed('127.0.0.2')).toBe(false);
    expect(dev.isAllowed('10.0.0.1')).toBe(false);
  });
});
