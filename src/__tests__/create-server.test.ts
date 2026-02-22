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

describe('createServer', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    authenticateMock.mockResolvedValue(undefined);
    registerToolsMock.mockReset();
    registerResourcesMock.mockReset();
    registerPromptsMock.mockReset();
    apiCoreInstances.length = 0;
  });

  it('authenticates with provided credentials', async () => {
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass' });

    expect(apiCoreInstances).toHaveLength(1);
    expect(apiCoreInstances[0].config).toEqual({ apiKey: 'api-key' });
    expect(authenticateMock).toHaveBeenCalledWith({ username: 'user', password: 'pass' });
  });

  it('passes baseUrl to ApiCore when provided', async () => {
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass', baseUrl: 'https://custom.api.com' });

    expect(apiCoreInstances[0].config).toEqual({ apiKey: 'api-key', baseUrl: 'https://custom.api.com' });
  });

  it('does not set baseUrl on ApiCore when omitted', async () => {
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass' });

    expect(apiCoreInstances[0].config).not.toHaveProperty('baseUrl');
  });

  it('throws on missing credentials', async () => {
    await expect(
      createServer({ apiKey: 'api-key', username: 'user', password: '' }),
    ).rejects.toThrow('Missing authentication configuration');
  });
});
