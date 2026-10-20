import { describe, expect, it } from 'vitest';
import { resolveApiUrl, staticSiteHeaders } from './api-url';

describe('resolveApiUrl', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['  ', ''],
    ['https://api.example.com', 'https://api.example.com'],
    ['https://api.example.com/', 'https://api.example.com'],
    ['https://example.com/images/api//', 'https://example.com/images/api'],
  ])('%j -> %j', (raw, expected) => {
    expect(resolveApiUrl(raw)).toBe(expected);
  });

  it.each(['api.example.com', 'ftp://api.example.com', 'not a url'])('rejects %j', (raw) => {
    expect(() => resolveApiUrl(raw)).toThrow(/VITE_API_URL/);
  });
});

describe('staticSiteHeaders', () => {
  it('allows the API origin in connect-src and nothing else extra', () => {
    const headers = staticSiteHeaders('https://api.example.com/v1');

    expect(headers).toContain("connect-src 'self' https://api.example.com;");
    expect(headers).toContain("default-src 'self'");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toMatch(/\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
  });

  it('only allows the same origin when no API URL is set', () => {
    expect(staticSiteHeaders('')).toContain("connect-src 'self';");
  });
});
