import { TOOL_DEFINITIONS } from './tools/index.js';
import { PROMPT_DEFINITIONS } from './prompts/index.js';
import { RESOURCE_DEFINITIONS } from './resources/index.js';

export const AFP_DEFINITIONS = {
  tools: TOOL_DEFINITIONS,
  prompts: PROMPT_DEFINITIONS,
  resources: RESOURCE_DEFINITIONS,
} as const;

export { TOOL_DEFINITIONS, PROMPT_DEFINITIONS, RESOURCE_DEFINITIONS };
export type { ToolDefinition } from './tools/index.js';
export type { PromptDefinition } from './prompts/index.js';
export type { ResourceDefinition } from './resources/index.js';
export type { ToolResult, TextContent, AnyContent } from './utils/types.js';
