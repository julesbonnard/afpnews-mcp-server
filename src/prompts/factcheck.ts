import { z } from 'zod';

export const factcheckPrompt = {
  name: 'factcheck',
  title: 'Fact Check',
  description: 'Verify facts about a specific topic',
  argsSchema: {
    query: z.string().describe("The topic or query to verify (e.g. 'climate change', 'French elections')"),
  },
  handler: async ({ query }: any) => {
    return {
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Factcheck the following query: "${query}":
1. Use afp_search_articles to find recent factchecks related to "${query}" (genreid:"afpattribute:FactcheckInvestigation") (size: 10).
2. For each relevant factcheck, use afp_get_article to retrieve the full text.
3. Summarize the findings, including: what is being claimed, what the factcheck verdict is, and the evidence provided.`,
        },
      }],
    };
  },
};
