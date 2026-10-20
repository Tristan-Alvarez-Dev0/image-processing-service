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
});
