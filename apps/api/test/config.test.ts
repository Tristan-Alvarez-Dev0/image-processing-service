import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults when env is empty', () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      TRUST_PROXY: false,
    });
    expect(config.APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('coerces and parses values from strings', () => {
    const config = loadConfig({ PORT: '8080', TRUST_PROXY: 'true', NODE_ENV: 'production' });

    expect(config.PORT).toBe(8080);
    expect(config.TRUST_PROXY).toBe(true);
    expect(config.NODE_ENV).toBe('production');
  });

  it('throws a readable error listing every invalid variable', () => {
    expect(() => loadConfig({ PORT: 'abc', LOG_LEVEL: 'loud', TRUST_PROXY: 'yes' })).toThrow(
      /Invalid environment configuration:[\s\S]*PORT[\s\S]*LOG_LEVEL[\s\S]*TRUST_PROXY/,
    );
  });

  it('has safe production defaults', () => {
    const config = loadConfig({ NODE_ENV: 'production' });

    expect(config).toMatchObject({
      FETCH_TIMEOUT_MS: 10_000,
      MAX_SOURCE_BYTES: 15 * 1024 * 1024,
      MAX_REDIRECTS: 3,
      ALLOW_PRIVATE_ADDRESSES: [],
      MAX_OUTPUT_DIMENSION: 4000,
      MAX_INPUT_PIXELS: 50_000_000,
      PROCESSING_TIMEOUT_MS: 15_000,
      VIDEO_FETCH_TIMEOUT_MS: 60_000,
    });
    expect(config.ALLOWED_PORTS).toEqual(new Set([80, 443]));
    expect(config.MAX_CONCURRENT_JOBS).toBeGreaterThan(0);
  });

  it('parses ALLOWED_PORTS as a list or *', () => {
    expect(loadConfig({ ALLOWED_PORTS: '80, 8080' }).ALLOWED_PORTS).toEqual(new Set([80, 8080]));
    expect(loadConfig({ ALLOWED_PORTS: '*' }).ALLOWED_PORTS).toBe('*');
    expect(() => loadConfig({ ALLOWED_PORTS: '80,http' })).toThrow(/ALLOWED_PORTS/);
    expect(() => loadConfig({ ALLOWED_PORTS: '70000' })).toThrow(/ALLOWED_PORTS/);
  });

  it('refuses to disable SSRF protection in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', ALLOW_PRIVATE_ADDRESSES: '127.0.0.1' }),
    ).toThrow(/ALLOW_PRIVATE_ADDRESSES: must not be set in production/);
    expect(
      loadConfig({ ALLOW_PRIVATE_ADDRESSES: '127.0.0.1, ::1' }).ALLOW_PRIVATE_ADDRESSES,
    ).toEqual(['127.0.0.1', '::1']);
  });
});
