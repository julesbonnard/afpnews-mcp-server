import { PROMPT_DEFINITIONS } from './prompts/index.js';
import { RESOURCE_DEFINITIONS } from './resources/index.js';

export const AFP_DEFINITIONS = {
  prompts: PROMPT_DEFINITIONS,
  resources: RESOURCE_DEFINITIONS,
} as const;

export { PROMPT_DEFINITIONS, RESOURCE_DEFINITIONS };
export type { PromptDefinition } from './prompts/index.js';
export type { ResourceDefinition } from './resources/index.js';
export type { ToolResult, TextContent, AnyContent } from './utils/types.js';
