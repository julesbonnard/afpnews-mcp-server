import { describe, expect, it, mock } from 'bun:test';
import * as actualApi from 'afpnews-api';

describe('createServer', () => {
  it('authenticates with provided credentials', async () => {
    const authenticateMock = mock().mockResolvedValue(undefined);

    mock.module('afpnews-api', () => ({
      ...actualApi,
      ApiCore: class {
        token?: unknown;
        config?: unknown;
        constructor(config?: unknown) { this.config = config; }
        authenticate = authenticateMock;
      },
    }));

    const { createServer } = await import('../mcp-server.js');
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass' });

    expect(authenticateMock).toHaveBeenCalledWith({ username: 'user', password: 'pass' });
    mock.restore();
  });

  it('passes baseUrl to ApiCore when provided', async () => {
    let capturedConfig: unknown;
    mock.module('afpnews-api', () => ({
      ...actualApi,
      ApiCore: class {
        token?: unknown;
        constructor(config?: unknown) { capturedConfig = config; }
        authenticate = mock().mockResolvedValue(undefined);
      },
    }));

    const { createServer } = await import('../mcp-server.js');
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass', baseUrl: 'https://custom.api.com' });

    expect(capturedConfig).toEqual({ apiKey: 'api-key', baseUrl: 'https://custom.api.com' });
    mock.restore();
  });

  it('does not set baseUrl on ApiCore when omitted', async () => {
    let capturedConfig: unknown;
    mock.module('afpnews-api', () => ({
      ...actualApi,
      ApiCore: class {
        token?: unknown;
        constructor(config?: unknown) { capturedConfig = config; }
        authenticate = mock().mockResolvedValue(undefined);
      },
    }));

    const { createServer } = await import('../mcp-server.js');
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass' });

    expect(capturedConfig).not.toHaveProperty('baseUrl');
    mock.restore();
  });

  it('throws on missing credentials', async () => {
    mock.module('afpnews-api', () => ({
      ...actualApi,
      ApiCore: class {
        token?: unknown;
        constructor() {}
        authenticate = mock().mockResolvedValue(undefined);
      },
    }));

    const { createServer } = await import('../mcp-server.js');
    await expect(
      createServer({ apiKey: 'api-key', username: 'user', password: '' }),
    ).rejects.toThrow('Missing authentication');
    mock.restore();
  });
});
