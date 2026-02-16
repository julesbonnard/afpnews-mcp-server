import { describe, expect, it } from 'vitest';
import { resolveStdioAuthConfig } from '../index.js';

describe('resolveStdioAuthConfig', () => {
  it('uses api key + username + password', () => {
    const config = resolveStdioAuthConfig({
      APICORE_API_KEY: 'api-key',
      APICORE_USERNAME: 'user',
      APICORE_PASSWORD: 'pass',
    });

    expect(config).toEqual({
      apiKey: 'api-key',
      username: 'user',
      password: 'pass',
    });
  });

  it('throws when no valid stdio auth is configured', () => {
    expect(() => resolveStdioAuthConfig({})).toThrow('Missing stdio auth configuration');
  });
});
