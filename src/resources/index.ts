import type { ServerContext } from '../server.js';
import { topicsResource } from './topics.js';

export const RESOURCE_DEFINITIONS = [topicsResource] as const;

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
