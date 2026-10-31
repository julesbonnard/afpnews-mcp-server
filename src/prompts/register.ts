import type { ServerContext } from '../mcp-server.js';
import { PROMPT_DEFINITIONS } from './index.js';

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
