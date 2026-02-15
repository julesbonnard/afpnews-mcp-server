import { z } from 'zod';
import { ServerContext } from '../server.js';

const SERVICE_NAME = 'mcp-mail-service';

async function ensureServiceExists(apicore: ServerContext['apicore'], email: string) {
  const services = await apicore.notificationCenter.listServices();
  const exists = services?.some((s: any) => s.serviceName === SERVICE_NAME);
  if (!exists) {
    await apicore.notificationCenter.registerService({
      name: SERVICE_NAME,
      type: 'mail',
      datas: { address: email } as any,
    });
  }
}

async function deleteServiceIfEmpty(apicore: ServerContext['apicore']) {
  const subscriptions = await apicore.notificationCenter.subscriptionsInService(SERVICE_NAME);
  if (!subscriptions || subscriptions.length === 0) {
    await apicore.notificationCenter.deleteService(SERVICE_NAME);
  }
}

export function registerNotificationTools({ server, apicore }: ServerContext) {
  server.registerTool("notification-add-subscription",
    {
      description: "Subscribe to AFP news alerts by email. Automatically creates the mail notification service if needed.",
      inputSchema: {
        name: z.string().describe("Unique name for this subscription"),
        email: z.string().describe("Email address to receive notifications"),
        query: z.string().optional().describe("Search keywords to filter notifications (e.g. 'climate change')"),
        lang: z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']).array().optional().describe("Language filter (e.g. ['fr', 'en'])"),
        product: z.enum(['news', 'factcheck', 'photo', 'video', 'multimedia', 'graphic', 'videographic']).array().optional().describe("Content type filter"),
        country: z.string().array().optional().describe("Country filter (e.g. ['fra', 'usa'])"),
        slug: z.string().array().optional().describe("Topic/slug filter (e.g. ['economy', 'sports'])")
      }
    },
    async ({ name, email, query, lang, product, country, slug }) => {
      await ensureServiceExists(apicore, email);

      const params: any = {};
      if (query) params.query = query;
      if (lang) params.langs = lang;
      if (product) params.product = product;
      if (country) params.country = country;
      if (slug) params.slug = slug;

      const result = await apicore.notificationCenter.addSubscription(name, SERVICE_NAME, params);
      return {
        content: [{
          type: 'text' as const,
          text: `Subscription "${name}" created (notifications sent to ${email}).\nIdentifier: ${result}`
        }]
      };
    }
  );

  server.registerTool("notification-list-subscriptions",
    {
      description: "List all active email notification subscriptions",
      inputSchema: {}
    },
    async () => {
      const subscriptions = await apicore.notificationCenter.subscriptionsInService(SERVICE_NAME);

      if (!subscriptions || subscriptions.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No subscriptions found.' }] };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(subscriptions, null, 2)
        }]
      };
    }
  );

  server.registerTool("notification-delete-subscription",
    {
      description: "Delete an email notification subscription. Automatically removes the mail service if no subscriptions remain.",
      inputSchema: {
        name: z.string().describe("Name of the subscription to delete")
      }
    },
    async ({ name }) => {
      await apicore.notificationCenter.deleteSubscription(SERVICE_NAME, name);
      await deleteServiceIfEmpty(apicore);
      return {
        content: [{
          type: 'text' as const,
          text: `Subscription "${name}" deleted.`
        }]
      };
    }
  );
}
