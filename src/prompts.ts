import { z } from 'zod';
import { ServerContext } from './context.js';
import { TOPICS, getTopicLabel, formatTopicList } from './topics.js';

const ALL_TOPIC_VALUES = Object.values(TOPICS).flat().map(t => t.value);
const topicEnum = z.enum(ALL_TOPIC_VALUES as [string, ...string[]]);

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
            text: `Use the AFP search tool to find today's most important news (dateFrom: "${today}", langs: ["${l}"], size: 15, sortOrder: "desc"). Then write a concise daily briefing summarizing the key stories, grouped by theme.`
          }
        }]
      };
    }
  );

  server.registerPrompt("comprehensive-analysis",
    {
      title: "Comprehensive analysis",
      description: "Perform an in-depth analysis on a specific topic",
      argsSchema: {
        query: z.string().describe("The topic or query to analyze (e.g. 'climate change', 'French elections')")
      }
    },
    async ({ query }) => {
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Perform an in-depth analysis on "${query}":
1. Use the AFP search tool to find recent articles about "${query}" (size: 10).
2. Use the "mlt" tool on the most relevant article to find related coverage.
3. Use the "get" tool to retrieve the full text of the most important articles.
4. Synthesize the information from these articles to write a comprehensive analysis covering: key facts, timeline, different angles, and outlook.`
          }
        }]
      };
    }
  );

  server.registerPrompt("factcheck",
    {
      title: "Fact Check",
      description: "Verify facts about a specific topic",
      argsSchema: {
        query: z.string().describe("The topic or query to verify (e.g. 'climate change', 'French elections')")
      }
    },
    async ({ query }) => {
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Factcheck the following query: "${query}":
1. Use the AFP search tool to find recent factchecks related to "${query}" (genreid:"afpattribute:FactcheckInvestigation") (size: 10).
2. For each relevant factcheck, use the "get" tool to retrieve the full text.
3. Summarize the findings, including: what is being claimed, what the factcheck verdict is, and the evidence provided.`
          }
        }]
      };
    }
  );

  server.registerPrompt("topic-summary",
    {
      title: "Topic Summary",
      description: `Summarize the latest articles from an AFP Stories topic.\nAvailable topics:\n${formatTopicList()}`,
      argsSchema: {
        topic: topicEnum.describe("AFP Stories topic identifier")
      }
    },
    async ({ topic }) => {
      const label = getTopicLabel(topic) ?? topic;
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Use the AFP search tool to find the latest articles from the "${label}" topic (product: "${topic}", size: 15, sortOrder: "desc"). Write a concise summary of the main stories.`
          }
        }]
      };
    }
  );

  server.registerPrompt("a-la-une",
    {
      title: "A la une",
      description: "Latest AFP news stories for a general audience in France",
      argsSchema: {}
    },
    async () => {
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Use the AFP search tool to find today's top news stories (langs: ["fr"], slug: ["afp", "actualites"], dateFrom: "now-1d", size: 15, sortOrder: "desc"). Write a concise summary of the main headlines.`
          }
        }]
      };
    }
  );

  server.registerPrompt("agenda",
    {
      title: "Agenda",
      description: "Upcoming scheduled events and press releases from AFP",
      argsSchema: {
        lang: z.string().optional().describe("Language (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang }) => {
      const l = lang || 'fr';
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Use the AFP search tool to find upcoming agenda items (langs: ["${l}"], includeAgendas: true, size: 15, sortOrder: "desc"). Note: to get agenda items specifically, the search query should target genreid "afpattribute:Agenda". Summarize the scheduled events, grouped by date.`
          }
        }]
      };
    }
  );

  server.registerPrompt("previsions",
    {
      title: "Prévisions",
      description: "AFP editorial coverage plans — stories scheduled to be published soon",
      argsSchema: {
        lang: z.string().optional().describe("Language (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang }) => {
      const l = lang || 'fr';
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Use the AFP search tool to find editorial coverage plans (langs: ["${l}"], includeAgendas: true, size: 15, sortOrder: "desc"). Note: previsions use genreid "afpattribute:Program" or "afpedtype:TextProgram". Summarize the planned coverage, grouped by theme.`
          }
        }]
      };
    }
  );

  server.registerPrompt("major-stories",
    {
      title: "Major Stories",
      description: "Latest AFP major news articles",
      argsSchema: {
        lang: z.string().optional().describe("Language (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang }) => {
      const l = lang || 'fr';
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Use the AFP search tool to find the latest major news stories (langs: ["${l}"], size: 15, sortOrder: "desc"). Note: major articles use genreid "afpattribute:Article". Write a summary of the most important stories.`
          }
        }]
      };
    }
  );

  server.registerPrompt("trending-topics",
    {
      title: "Trending Topics",
      description: "Discover the most trending AFP news topics right now",
      argsSchema: {
        lang: z.string().optional().describe("Language (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang }) => {
      const l = lang || 'fr';
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Use the AFP list tool to find the most frequent slugs (facet: "slug", lang: "${l}", size: 20). Then for the top 5 trending topics, use the AFP search tool to find the latest article for each. Write a summary of what's trending right now.`
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
        country: z.string().describe("Country code (e.g. 'fra', 'usa', 'gbr')"),
        lang: z.string().optional().describe("Language (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ country, lang = 'fr' }) => {
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Use the AFP search tool to find recent news for country "${country}" (langs: ["${lang}"], country: ["${country}"], size: 15). Write a news summary for this country covering the main stories of the day.`
          }
        }]
      };
    }
  );
}
