import { z } from 'zod';

export const dailyBriefingPrompt = {
  name: 'daily-briefing',
  title: 'Daily Briefing',
  description: 'Generate a news briefing for today',
  argsSchema: {
    lang: z.string().optional().describe("Language (e.g. 'en', 'fr'). Default: 'fr'"),
  },
  handler: async ({ lang }: any) => {
    const l = lang || 'fr';
    const today = new Date().toISOString().split('T')[0];
    return {
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use the afp_search_articles tool to find today's most important news (dateFrom: "${today}", lang: ["${l}"], size: 15, sortOrder: "desc"). Then write a concise daily briefing summarizing the key stories, grouped by theme.`,
        },
      }],
    };
  },
};
