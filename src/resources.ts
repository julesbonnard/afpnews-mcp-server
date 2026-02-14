import { ServerContext } from './server.js';
import { TOPICS } from './topics.js';

export function registerResources({ server }: ServerContext) {
  server.registerResource("topics",
    "afp://topics",
    {
      description: "AFP Stories topic catalog — available sections by language (fr, en, de, pt, es, ar) with their identifiers",
      mimeType: "application/json"
    },
    async () => {
      return {
        contents: [{
          uri: "afp://topics",
          text: JSON.stringify(TOPICS, null, 2)
        }]
      };
    }
  );
}
