import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authenticateMock,
  apiCoreInstances,
  registerToolsMock,
  registerResourcesMock,
  registerPromptsMock,
} = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  apiCoreInstances: [] as Array<{ token?: unknown; config?: unknown }>,
  registerToolsMock: vi.fn(),
  registerResourcesMock: vi.fn(),
  registerPromptsMock: vi.fn(),
}));

vi.mock('afpnews-api', () => {
  class MockApiCore {
    token?: unknown;
    config?: unknown;

    constructor(config?: unknown) {
      this.config = config;
      apiCoreInstances.push(this);
    }

    authenticate = authenticateMock;
  }

  return { ApiCore: MockApiCore };
});

vi.mock('../tools/index.js', () => ({ registerTools: registerToolsMock }));
vi.mock('../resources/index.js', () => ({ registerResources: registerResourcesMock }));
vi.mock('../prompts/index.js', () => ({ registerPrompts: registerPromptsMock }));

import { createServer } from '../server.js';

describe('createServer auth configuration', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    authenticateMock.mockResolvedValue(undefined);
    registerToolsMock.mockReset();
    registerResourcesMock.mockReset();
    registerPromptsMock.mockReset();
    apiCoreInstances.length = 0;
  });

  it('uses a provided AuthToken without authenticate call', async () => {
    const token = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpires: 9999999999,
      authType: 'credentials' as const,
    };

    await createServer(token);

    expect(apiCoreInstances).toHaveLength(1);
    expect(apiCoreInstances[0].token).toEqual(token);
    expect(authenticateMock).not.toHaveBeenCalled();
    expect(registerToolsMock).toHaveBeenCalledTimes(1);
    expect(registerResourcesMock).toHaveBeenCalledTimes(1);
    expect(registerPromptsMock).toHaveBeenCalledTimes(1);
  });

  it('uses credentials and authenticates when apiKey is provided', async () => {
    await createServer('api-key', 'user', 'pass');

    expect(apiCoreInstances).toHaveLength(1);
    expect(apiCoreInstances[0].config).toEqual({ apiKey: 'api-key' });
    expect(authenticateMock).toHaveBeenCalledWith({ username: 'user', password: 'pass' });
  });

  it('throws on missing credentials when token is not provided', async () => {
    await expect(createServer('api-key', 'user')).rejects.toThrow(
      'Missing authentication configuration',
    );
  });
});
