/** Empty means the same origin, which is how the API serves the UI locally. */
export function resolveApiUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (value === '') return '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`VITE_API_URL must be an absolute URL, got "${raw}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`VITE_API_URL must use http or https, got "${raw}"`);
  }
  return value;
}

export function staticSiteHeaders(apiUrl: string): string {
  const api = apiUrl ? ` ${new URL(apiUrl).origin}` : '';
  const csp = [
    "default-src 'self'",
    `connect-src 'self'${api}`,
    "img-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n');
}
