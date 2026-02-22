import { z } from 'zod';

export const countryNewsPrompt = {
  name: 'country-news',
  title: 'Country News',
  description: 'News summary for a specific country',
  argsSchema: {
    country: z.string().describe("Country code (e.g. 'fra', 'usa', 'gbr')"),
    lang: z.string().optional().describe("Language (e.g. 'en', 'fr'). Default: 'fr'"),
  },
  handler: async ({ country, lang = 'fr' }: { country: string; lang?: string }) => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `Use afp_search_articles to find recent news for country "${country}" (facets: { lang: ["${lang}"], country: ["${country}"] }, size: 15). Write a news summary for this country covering the main stories of the day.`,
      },
    }],
  }),
};
