import type { ServerContext } from '../server.js';
import { dailyBriefingPrompt } from './daily-briefing.js';
import { comprehensiveAnalysisPrompt } from './comprehensive-analysis.js';
import { factcheckPrompt } from './factcheck.js';
import { countryNewsPrompt } from './country-news.js';

export const PROMPT_DEFINITIONS = [
  dailyBriefingPrompt,
  comprehensiveAnalysisPrompt,
  factcheckPrompt,
  countryNewsPrompt,
] as const;

export function registerPrompts({ server }: ServerContext) {
  for (const prompt of PROMPT_DEFINITIONS) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: prompt.argsSchema,
      },
      prompt.handler,
    );
  }
}
