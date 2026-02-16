import { describe, expect, it } from 'vitest';
import { resolveStdioAuthConfig } from '../index.js';

describe('resolveStdioAuthConfig', () => {
  it('uses APICORE_AUTH_TOKEN when provided', () => {
    const config = resolveStdioAuthConfig({
      APICORE_AUTH_TOKEN: JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenExpires: 9999999999,
        authType: 'credentials',
      }),
    });

    expect(config).toEqual({
      mode: 'token',
      token: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenExpires: 9999999999,
        authType: 'credentials',
      },
    });
  });

  it('falls back to api key + username + password', () => {
    const config = resolveStdioAuthConfig({
      APICORE_API_KEY: 'api-key',
      APICORE_USERNAME: 'user',
      APICORE_PASSWORD: 'pass',
    });

    expect(config).toEqual({
      mode: 'credentials',
      apiKey: 'api-key',
      username: 'user',
      password: 'pass',
    });
  });

  it('throws when token JSON is invalid', () => {
    expect(() =>
      resolveStdioAuthConfig({
        APICORE_AUTH_TOKEN: 'not-json',
      }),
    ).toThrow('APICORE_AUTH_TOKEN must be a valid JSON object');
  });

  it('throws when no valid stdio auth is configured', () => {
    expect(() => resolveStdioAuthConfig({})).toThrow('Missing stdio auth configuration');
  });
});
