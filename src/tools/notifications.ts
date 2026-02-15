import { z } from 'zod';
import { ServerContext } from '../server.js';

export function registerNotificationTools({ server, apicore }: ServerContext) {
  server.registerTool("notification-register-service",
    {
      description: "Register a notification service (webhook, email, SQS, or JMS) to receive AFP news alerts",
      inputSchema: {
        name: z.string().describe("Unique name for this notification service"),
        type: z.enum(['mail', 'rest', 'sqs', 'jms']).describe("Service type: 'mail' for email, 'rest' for HTTP webhook, 'sqs' for AWS SQS, 'jms' for JMS queue"),
        datas: z.object({
          href: z.string().optional().describe("Webhook URL (required for 'rest')"),
          user: z.string().optional().describe("Auth username (optional for 'rest')"),
          password: z.string().optional().describe("Auth password (optional for 'rest')"),
          address: z.string().optional().describe("Email address (required for 'mail')"),
          url: z.string().optional().describe("JMS broker URL (required for 'jms')"),
          queueName: z.string().optional().describe("JMS queue name (required for 'jms')"),
          username: z.string().optional().describe("JMS username (required for 'jms')"),
          accessKey: z.string().optional().describe("AWS access key (required for 'sqs')"),
          secretKey: z.string().optional().describe("AWS secret key (required for 'sqs')"),
          region: z.string().optional().describe("AWS region (required for 'sqs')"),
          queue: z.string().optional().describe("SQS queue name (required for 'sqs')"),
          ownerId: z.string().optional().describe("AWS owner ID (required for 'sqs')"),
        }).describe("Service-specific configuration data")
      }
    },
    async ({ name, type, datas }) => {
      const result = await apicore.notificationCenter.registerService({ name, type, datas: datas as any });
      return {
        content: [{
          type: 'text' as const,
          text: `Service "${name}" registered successfully.\nIdentifier: ${result}`
        }]
      };
    }
  );

  server.registerTool("notification-list-services",
    {
      description: "List all registered notification services for the current user",
      inputSchema: {}
    },
    async () => {
      const services = await apicore.notificationCenter.listServices();
      if (!services || services.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No notification services registered.' }] };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(services, null, 2)
        }]
      };
    }
  );

  server.registerTool("notification-add-subscription",
    {
      description: "Add a subscription to an existing notification service. Defines what news content triggers notifications.",
      inputSchema: {
        name: z.string().describe("Unique name for this subscription"),
        service: z.string().describe("Name of the notification service to subscribe to"),
        query: z.string().optional().describe("Search keywords to filter notifications (e.g. 'climate change')"),
        lang: z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']).array().optional().describe("Language filter (e.g. ['fr', 'en'])"),
        product: z.enum(['news', 'factcheck', 'photo', 'video', 'multimedia', 'graphic', 'videographic']).array().optional().describe("Content type filter"),
        country: z.string().array().optional().describe("Country filter (e.g. ['fra', 'usa'])"),
        slug: z.string().array().optional().describe("Topic/slug filter (e.g. ['economy', 'sports'])")
      }
    },
    async ({ name, service, query, lang, product, country, slug }) => {
      const params: any = {};
      if (query) params.query = query;
      if (lang) params.langs = lang;
      if (product) params.product = product;
      if (country) params.country = country;
      if (slug) params.slug = slug;

      const result = await apicore.notificationCenter.addSubscription(name, service, params);
      return {
        content: [{
          type: 'text' as const,
          text: `Subscription "${name}" added to service "${service}".\nIdentifier: ${result}`
        }]
      };
    }
  );

  server.registerTool("notification-list-subscriptions",
    {
      description: "List notification subscriptions. If service is provided, lists only subscriptions for that service.",
      inputSchema: {
        service: z.string().optional().describe("Service name to filter subscriptions (if omitted, lists all subscriptions)")
      }
    },
    async ({ service }) => {
      const subscriptions = service
        ? await apicore.notificationCenter.subscriptionsInService(service)
        : await apicore.notificationCenter.listSubscriptions();

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
      description: "Delete a subscription from a notification service",
      inputSchema: {
        service: z.string().describe("Name of the notification service"),
        name: z.string().describe("Name of the subscription to delete")
      }
    },
    async ({ service, name }) => {
      await apicore.notificationCenter.deleteSubscription(service, name);
      return {
        content: [{
          type: 'text' as const,
          text: `Subscription "${name}" deleted from service "${service}".`
        }]
      };
    }
  );
}
