import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerNotificationTools } from '../tools/notifications.js';

function createMockApicore() {
  return {
    notificationCenter: {
      registerService: vi.fn().mockResolvedValue('svc-001'),
      listServices: vi.fn().mockResolvedValue([
        { serviceName: 'my-webhook', serviceType: 'rest', serviceIdentifier: 'svc-001' }
      ]),
      addSubscription: vi.fn().mockResolvedValue('sub-001'),
      listSubscriptions: vi.fn().mockResolvedValue([
        { name: 'breaking-news', identifier: 'sub-001' }
      ]),
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

  describe('notification-register-service', () => {
    it('registers a REST webhook service', async () => {
      const result = await client.callTool({
        name: 'notification-register-service',
        arguments: {
          name: 'my-webhook',
          type: 'rest',
          datas: { href: 'https://example.com/webhook' }
        }
      });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('my-webhook');
      expect(msg.text).toContain('svc-001');
      expect(apicore.notificationCenter.registerService).toHaveBeenCalledWith({
        name: 'my-webhook',
        type: 'rest',
        datas: { href: 'https://example.com/webhook' }
      });
    });

    it('registers an email service', async () => {
      await client.callTool({
        name: 'notification-register-service',
        arguments: {
          name: 'my-email',
          type: 'mail',
          datas: { address: 'test@example.com' }
        }
      });
      expect(apicore.notificationCenter.registerService).toHaveBeenCalledWith({
        name: 'my-email',
        type: 'mail',
        datas: { address: 'test@example.com' }
      });
    });
  });

  describe('notification-list-services', () => {
    it('returns registered services as JSON', async () => {
      const result = await client.callTool({
        name: 'notification-list-services',
        arguments: {}
      });
      const msg = result.content![0] as { type: string; text: string };
      const parsed = JSON.parse(msg.text);
      expect(parsed[0].serviceName).toBe('my-webhook');
    });

    it('returns message when no services exist', async () => {
      apicore.notificationCenter.listServices.mockResolvedValueOnce([]);
      const result = await client.callTool({
        name: 'notification-list-services',
        arguments: {}
      });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toBe('No notification services registered.');
    });
  });

  describe('notification-add-subscription', () => {
    it('adds a subscription with query filters', async () => {
      const result = await client.callTool({
        name: 'notification-add-subscription',
        arguments: {
          name: 'breaking-news',
          service: 'my-webhook',
          query: 'climate',
          lang: ['fr'],
        }
      });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('breaking-news');
      expect(msg.text).toContain('sub-001');
      expect(apicore.notificationCenter.addSubscription).toHaveBeenCalledWith(
        'breaking-news',
        'my-webhook',
        { query: 'climate', langs: ['fr'] }
      );
    });
  });

  describe('notification-list-subscriptions', () => {
    it('lists all subscriptions when no service specified', async () => {
      const result = await client.callTool({
        name: 'notification-list-subscriptions',
        arguments: {}
      });
      const msg = result.content![0] as { type: string; text: string };
      const parsed = JSON.parse(msg.text);
      expect(parsed[0].name).toBe('breaking-news');
      expect(apicore.notificationCenter.listSubscriptions).toHaveBeenCalled();
    });

    it('lists subscriptions for a specific service', async () => {
      const result = await client.callTool({
        name: 'notification-list-subscriptions',
        arguments: { service: 'my-webhook' }
      });
      const msg = result.content![0] as { type: string; text: string };
      const parsed = JSON.parse(msg.text);
      expect(parsed[0].name).toBe('breaking-news');
      expect(apicore.notificationCenter.subscriptionsInService).toHaveBeenCalledWith('my-webhook');
    });

    it('returns message when no subscriptions found', async () => {
      apicore.notificationCenter.listSubscriptions.mockResolvedValueOnce([]);
      const result = await client.callTool({
        name: 'notification-list-subscriptions',
        arguments: {}
      });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toBe('No subscriptions found.');
    });
  });

  describe('notification-delete-subscription', () => {
    it('deletes a subscription', async () => {
      const result = await client.callTool({
        name: 'notification-delete-subscription',
        arguments: { service: 'my-webhook', name: 'breaking-news' }
      });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('breaking-news');
      expect(msg.text).toContain('deleted');
      expect(apicore.notificationCenter.deleteSubscription).toHaveBeenCalledWith('my-webhook', 'breaking-news');
    });
  });
});
