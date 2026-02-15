import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerNotificationTools } from '../tools/notifications.js';

function createMockApicore() {
  return {
    notificationCenter: {
      registerService: vi.fn().mockResolvedValue('svc-001'),
      listServices: vi.fn().mockResolvedValue([]),
      deleteService: vi.fn().mockResolvedValue('svc-001'),
      addSubscription: vi.fn().mockResolvedValue('sub-001'),
      subscriptionsInService: vi.fn().mockResolvedValue([
        { name: 'breaking-news', identifier: 'sub-001' }
      ]),
      deleteSubscription: vi.fn().mockResolvedValue(undefined),
    },
  };
}

async function setupServer() {
  const server = new McpServer({ name: 'test', version: '0.0.1' });
  const apicore = createMockApicore();
  const ctx = { server, apicore } as any;

  registerNotificationTools(ctx);

  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { server, client, apicore };
}

describe('Notification tools', () => {
  let client: Client;
  let apicore: ReturnType<typeof createMockApicore>;

  beforeEach(async () => {
    const setup = await setupServer();
    client = setup.client;
    apicore = setup.apicore;
  });

  describe('notification-add-subscription', () => {
    it('creates service if it does not exist and adds subscription', async () => {
      const result = await client.callTool({
        name: 'notification-add-subscription',
        arguments: {
          name: 'breaking-news',
          email: 'test@example.com',
          query: 'climate',
          lang: ['fr'],
        }
      });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('breaking-news');
      expect(msg.text).toContain('test@example.com');
      expect(msg.text).toContain('sub-001');

      expect(apicore.notificationCenter.listServices).toHaveBeenCalled();
      expect(apicore.notificationCenter.registerService).toHaveBeenCalledWith({
        name: 'mcp-mail-service',
        type: 'mail',
        datas: { address: 'test@example.com' },
      });
      expect(apicore.notificationCenter.addSubscription).toHaveBeenCalledWith(
        'breaking-news',
        'mcp-mail-service',
        { query: 'climate', langs: ['fr'] }
      );
    });

    it('skips service creation if it already exists', async () => {
      apicore.notificationCenter.listServices.mockResolvedValueOnce([
        { serviceName: 'mcp-mail-service', serviceType: 'mail', serviceIdentifier: 'svc-001' }
      ]);

      await client.callTool({
        name: 'notification-add-subscription',
        arguments: { name: 'test-sub', email: 'test@example.com' }
      });

      expect(apicore.notificationCenter.registerService).not.toHaveBeenCalled();
      expect(apicore.notificationCenter.addSubscription).toHaveBeenCalled();
    });
  });

  describe('notification-list-subscriptions', () => {
    it('lists subscriptions from the mcp-mail-service', async () => {
      const result = await client.callTool({
        name: 'notification-list-subscriptions',
        arguments: {}
      });
      const msg = result.content![0] as { type: string; text: string };
      const parsed = JSON.parse(msg.text);
      expect(parsed[0].name).toBe('breaking-news');
      expect(apicore.notificationCenter.subscriptionsInService).toHaveBeenCalledWith('mcp-mail-service');
    });

    it('returns message when no subscriptions found', async () => {
      apicore.notificationCenter.subscriptionsInService.mockResolvedValueOnce([]);
      const result = await client.callTool({
        name: 'notification-list-subscriptions',
        arguments: {}
      });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toBe('No subscriptions found.');
    });
  });

  describe('notification-delete-subscription', () => {
    it('deletes a subscription and keeps service if others remain', async () => {
      apicore.notificationCenter.subscriptionsInService.mockResolvedValueOnce([
        { name: 'other-sub', identifier: 'sub-002' }
      ]);

      const result = await client.callTool({
        name: 'notification-delete-subscription',
        arguments: { name: 'breaking-news' }
      });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('breaking-news');
      expect(msg.text).toContain('deleted');
      expect(apicore.notificationCenter.deleteSubscription).toHaveBeenCalledWith('mcp-mail-service', 'breaking-news');
      expect(apicore.notificationCenter.deleteService).not.toHaveBeenCalled();
    });

    it('deletes the service when no subscriptions remain', async () => {
      apicore.notificationCenter.subscriptionsInService.mockResolvedValueOnce([]);

      await client.callTool({
        name: 'notification-delete-subscription',
        arguments: { name: 'last-sub' }
      });

      expect(apicore.notificationCenter.deleteService).toHaveBeenCalledWith('mcp-mail-service');
    });
  });
});
