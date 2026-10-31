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

export type PromptDefinition = (typeof PROMPT_DEFINITIONS)[number];
