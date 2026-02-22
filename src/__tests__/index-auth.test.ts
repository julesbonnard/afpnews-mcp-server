import { describe, expect, it } from 'vitest';
import { resolveStdioAuthConfig } from '../index.js';

describe('resolveStdioAuthConfig', () => {
  it('returns apiKey, username, password', () => {
    const config = resolveStdioAuthConfig({
      APICORE_API_KEY: 'api-key',
      APICORE_USERNAME: 'user',
      APICORE_PASSWORD: 'pass',
    });

    expect(config).toEqual({
      apiKey: 'api-key',
      username: 'user',
      password: 'pass',
      baseUrl: undefined,
    });
  });

  it('includes baseUrl when APICORE_BASE_URL is set', () => {
    const config = resolveStdioAuthConfig({
      APICORE_API_KEY: 'api-key',
      APICORE_USERNAME: 'user',
      APICORE_PASSWORD: 'pass',
      APICORE_BASE_URL: 'https://custom.api.com',
    });

    expect(config.baseUrl).toBe('https://custom.api.com');
  });

  it('trims whitespace from APICORE_BASE_URL', () => {
    const config = resolveStdioAuthConfig({
      APICORE_API_KEY: 'api-key',
      APICORE_USERNAME: 'user',
      APICORE_PASSWORD: 'pass',
      APICORE_BASE_URL: '  https://custom.api.com  ',
    });

    expect(config.baseUrl).toBe('https://custom.api.com');
  });

  it('throws when no valid stdio auth is configured', () => {
    expect(() => resolveStdioAuthConfig({})).toThrow('Missing stdio auth configuration');
  });
});
