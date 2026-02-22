import { z } from 'zod';

export const comprehensiveAnalysisPrompt = {
  name: 'comprehensive-analysis',
  title: 'Comprehensive analysis',
  description: 'Perform an in-depth analysis on a specific topic',
  argsSchema: {
    query: z.string().describe("The topic or query to analyze (e.g. 'climate change', 'French elections')"),
  },
  handler: async ({ query }: { query: string }) => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `Perform an in-depth analysis on "${query}":
1. Use afp_search_articles to find recent articles about "${query}" (size: 10).
2. Use afp_find_similar on the most relevant article to find related coverage.
3. Use afp_get_article to retrieve the full text of the most important articles.
4. Synthesize the information from these articles to write a comprehensive analysis covering: key facts, timeline, different angles, and outlook.`,
      },
    }],
  }),
};
