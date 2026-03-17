import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

// Define shared mock functions at module scope
const authenticateMock = mock();
const apiCoreInstances: Array<{ token?: unknown; config?: unknown }> = [];
const registerToolsMock = mock();
const registerResourcesMock = mock();
const registerPromptsMock = mock();

// mock.module() is hoisted by bun:test before imports are resolved
mock.module('afpnews-api', () => {
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

mock.module('../tools/index.js', () => ({ registerTools: registerToolsMock }));
mock.module('../resources/index.js', () => ({ registerResources: registerResourcesMock }));
mock.module('../prompts/index.js', () => ({ registerPrompts: registerPromptsMock }));

// Restore module mocks after all tests in this file
afterAll(() => mock.restore());

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
    // Dynamic import ensures mock.module() is active when the module is loaded
    const { createServer } = await import('../server.js');
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass' });

    expect(apiCoreInstances).toHaveLength(1);
    expect(apiCoreInstances[0].config).toEqual({ apiKey: 'api-key' });
    expect(authenticateMock).toHaveBeenCalledWith({ username: 'user', password: 'pass' });
  });

  it('passes baseUrl to ApiCore when provided', async () => {
    const { createServer } = await import('../server.js');
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass', baseUrl: 'https://custom.api.com' });

    expect(apiCoreInstances[0].config).toEqual({ apiKey: 'api-key', baseUrl: 'https://custom.api.com' });
  });

  it('does not set baseUrl on ApiCore when omitted', async () => {
    const { createServer } = await import('../server.js');
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass' });

    expect(apiCoreInstances[0].config).not.toHaveProperty('baseUrl');
  });

  it('throws on missing credentials', async () => {
    const { createServer } = await import('../server.js');
    await expect(
      createServer({ apiKey: 'api-key', username: 'user', password: '' }),
    ).rejects.toThrow('Missing authentication');
  });
});
