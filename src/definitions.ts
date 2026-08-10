import { TOOL_DEFINITIONS } from './tools/index.js';
import { PROMPT_DEFINITIONS } from './prompts/index.js';
import { RESOURCE_DEFINITIONS } from './resources/index.js';

export const AFP_DEFINITIONS = {
  tools: TOOL_DEFINITIONS,
  prompts: PROMPT_DEFINITIONS,
  resources: RESOURCE_DEFINITIONS,
} as const;

export { TOOL_DEFINITIONS, PROMPT_DEFINITIONS, RESOURCE_DEFINITIONS };
