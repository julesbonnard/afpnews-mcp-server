import { z } from 'zod';
import { ServerContext } from './context.js';

export function registerPrompts({ server }: ServerContext) {
  server.registerPrompt("daily-briefing",
    {
      title: "Daily Briefing",
      description: "Generate a news briefing for today",
      argsSchema: {
        lang: z.string().optional().describe("Language (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang }) => {
      const l = lang || 'fr';
      const today = new Date().toISOString().split('T')[0];
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Use the AFP search tool to find today's most important news (dateFrom: "${today}", langs: ["${l}"], size: 15, sortOrder: "desc"). Then write a concise daily briefing summarizing the key stories, grouped by theme. Use the "get" tool to read the full text of the most important articles.`
          }
        }]
      };
    }
  );

  server.registerPrompt("topic-deep-dive",
    {
      title: "Topic Deep Dive",
      description: "In-depth analysis of a specific topic using search and similar articles",
      argsSchema: {
        topic: z.string().describe("The topic to investigate"),
        lang: z.string().optional().describe("Language (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ topic, lang }) => {
      const l = lang || 'fr';
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Perform an in-depth analysis on "${topic}":
1. Use the AFP search tool to find recent articles about "${topic}" (langs: ["${l}"], size: 10).
2. Use the "get" tool to read the full text of the 3 most relevant articles.
3. Use the "mlt" tool on the most relevant article to find related coverage.
4. Write a comprehensive analysis covering: key facts, timeline, different angles, and outlook.`
          }
        }]
      };
    }
  );

  server.registerPrompt("country-news",
    {
      title: "Country News",
      description: "News summary for a specific country",
      argsSchema: {
        country: z.string().describe("Country code (e.g. 'FRA', 'USA', 'GBR')"),
        lang: z.string().optional().describe("Language (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ country, lang }) => {
      const l = lang || 'fr';
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Use the AFP search tool to find recent news for country "${country}" (langs: ["${l}"], country: ["${country}"], size: 15). Then use "get" to read the most important articles in full. Write a news summary for this country covering the main stories of the day.`
          }
        }]
      };
    }
  );
}
