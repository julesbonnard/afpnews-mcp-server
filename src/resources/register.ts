import type { ServerContext } from '../mcp-server.js';
import { RESOURCE_DEFINITIONS } from './index.js';

export function registerResources({ server }: ServerContext) {
  for (const resource of RESOURCE_DEFINITIONS) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: resource.mimeType,
      },
      resource.handler,
    );
  }
}
